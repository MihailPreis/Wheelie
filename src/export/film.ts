import { createPose, Sim, Status, TICK_MILLISECONDS } from '../core/sim';
import type { TrackData } from '../formats/mrg';
import { inputLean, inputThrottle } from '../formats/replay';
import { copyPose } from '../game/game';
import { Animator } from '../render/animator';
import { drawHud } from '../render/hud';
import { type SceneOptions, SceneRenderer } from '../render/scene';
import type { Sprites } from '../render/sprites';

export interface FilmSource {
  track: TrackData;
  league: number;
  /** One input code per tick. */
  inputs: Uint8Array;
  /** Race time shown once the bike has finished, in milliseconds. */
  finishTime: number;
}

/**
 * A replay as a sequence of pictures: any moment of it can be drawn on any canvas, independently
 * of the game on screen and of real time. Moments must be asked for in order.
 */
export class Film {
  private readonly sim: Sim;
  private readonly animator = new Animator();
  private readonly renderer: SceneRenderer;
  private readonly previous = createPose();
  private readonly current = createPose();
  private readonly blended = createPose();
  private previousLookX = 0;
  private previousLookY = 0;
  private finished = false;

  /**
   * @param viewSize smaller side of the picture in dp; it sets how far the camera looks ahead
   */
  constructor(
    sprites: Sprites,
    private readonly source: FilmSource,
    private readonly options: SceneOptions,
    private readonly viewSize: number,
  ) {
    this.sim = new Sim({ track: source.track, league: source.league, demo: false });
    this.renderer = new SceneRenderer(sprites);
    this.sim.capture(this.current);
    copyPose(this.current, this.previous);
  }

  /** Length in ticks. */
  get length(): number {
    return this.source.inputs.length;
  }

  /** Length in milliseconds of race time. */
  get duration(): number {
    return this.length * TICK_MILLISECONDS;
  }

  private step(): void {
    const code = this.source.inputs[this.sim.ticks] ?? 4;
    const status = this.sim.step(inputThrottle(code), inputLean(code));
    if (status === Status.Finished || status === Status.FinishedLate) this.finished = true;
    copyPose(this.current, this.previous);
    this.previousLookX = this.animator.lookX;
    this.previousLookY = this.animator.lookY;
    this.sim.capture(this.current);
    this.animator.step(this.current, this.sim.terrain, true, this.viewSize);
  }

  /** Runs on to the tick the bike crosses the finish line at, or to the end. Returns that tick. */
  seekFinish(): number {
    while (!this.finished && this.sim.ticks < this.length) this.step();
    return this.sim.ticks;
  }

  /**
   * Draws the moment `tick` (which may fall between two ticks) to fill a canvas of the given size
   * in pixels, at `scale` pixels per dp.
   */
  draw(ctx: CanvasRenderingContext2D, width: number, height: number, scale: number, tick: number, hud = true): void {
    const target = Math.max(0, Math.min(this.length, tick));
    while (this.sim.ticks < Math.ceil(target)) this.step();
    // How far the moment lies between the tick before and the latest one.
    const alpha = Math.max(0, Math.min(1, target - (this.sim.ticks - 1)));
    const mix = (from: number, to: number) => from + (to - from) * alpha;
    const blended = this.blended;
    copyPose(this.current, blended);
    for (let i = 0; i < blended.x.length; i++) {
      blended.x[i] = mix(this.previous.x[i] as number, this.current.x[i] as number);
      blended.y[i] = mix(this.previous.y[i] as number, this.current.y[i] as number);
      blended.angle[i] = mix(this.previous.angle[i] as number, this.current.angle[i] as number);
    }
    blended.riderLean = mix(this.previous.riderLean, this.current.riderLean);
    blended.progress = mix(this.previous.progress, this.current.progress);
    const lookX = this.animator.lookX;
    const lookY = this.animator.lookY;
    this.animator.lookX = mix(this.previousLookX, lookX);
    this.animator.lookY = mix(this.previousLookY, lookY);

    const viewport = { width: width / scale, height: height / scale, lift: 0 };
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    this.renderer.draw(ctx, viewport, this.sim.terrain, blended, this.animator, this.sim.league, this.options);
    this.animator.lookX = lookX;
    this.animator.lookY = lookY;
    if (hud) {
      drawHud(ctx, viewport, {
        progress: blended.progress / 65536,
        time: this.finished ? this.source.finishTime : this.sim.raceTime,
        message: null,
      });
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}
