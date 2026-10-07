import { createPose, type Pose, Sim, Status, TICK_MILLISECONDS } from '../core/sim';
import type { TrackData } from '../formats/mrg';
import { Animator } from '../render/animator';
import { drawHud } from '../render/hud';
import { type SceneOptions, SceneRenderer, type Viewport } from '../render/scene';
import type { Sprites } from '../render/sprites';
import type { Input } from './input';

/** Width in dp that the smaller side of the view is scaled to, roughly a phone in portrait. */
const BASE_VIEW_SIZE = 360;
/** Longest stretch of real time simulated in one frame; beyond it the game slows down instead. */
const MAX_FRAME_MILLISECONDS = 250;

const ticksFor = (milliseconds: number) => Math.ceil(milliseconds / TICK_MILLISECONDS);
const CRASH_RESTART_TICKS = ticksFor(3000);
const HARD_CRASH_RESTART_TICKS = ticksFor(1000);
const FINISH_TICKS = ticksFor(1000);
const TRACK_NAME_TICKS = ticksFor(3000);

type Phase =
  /** The simulation is running. */
  | 'riding'
  /** The rider is down; the scene is frozen until the restart. */
  | 'crashed'
  /** The finish line has been crossed; the bike rolls on for a moment. */
  | 'finished';

export interface Track {
  name: string;
  data: TrackData;
}

export interface RunResult {
  /** Race time in milliseconds. */
  time: number;
  /** The front wheel never touched the ground. */
  wheelie: boolean;
}

function copyPose(from: Pose, to: Pose): void {
  to.x.set(from.x);
  to.y.set(from.y);
  to.angle.set(from.angle);
  to.frameVx = from.frameVx;
  to.frameVy = from.frameVy;
  to.riderLean = from.riderLean;
  to.broken = from.broken;
  to.progress = from.progress;
  to.shadowLeft = from.shadowLeft;
  to.shadowRight = from.shadowRight;
  to.shadowY = from.shadowY;
}

/**
 * Runs one track: steps the simulation at a fixed rate, follows the flow of the original main
 * loop (`GDActivity.run`, `goalLoop`, `restart`) and draws.
 */
export class Game {
  options: SceneOptions = {
    perspective: true,
    shadows: true,
    driverSprite: true,
    bikeSprite: true,
    dimmed: false,
  };
  lookAhead = true;
  /** Height of the on-screen keypad in CSS pixels; the scene is lifted by half of it. */
  keypadHeight = 0;
  /** Called when a run reaches the finish, after the bike has rolled out. */
  onFinish: ((result: RunResult) => void) | null = null;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly renderer: SceneRenderer;
  private readonly animator = new Animator();

  private sim: Sim | null = null;
  private track: Track | null = null;
  private league = 0;

  private phase: Phase = 'riding';
  private phaseTicks = 0;
  /** Ticks until a broken bike is put back on the start; 0 while it is whole. */
  private brokenTicks = 0;
  private result: RunResult | null = null;

  private message: string | null = null;
  private messageTicks = 0;

  private readonly previous = createPose();
  private readonly current = createPose();
  private readonly blended = createPose();
  private previousLookX = 0;
  private previousLookY = 0;

  private lastFrame: number | null = null;
  private pending = 0;
  private running = false;
  private frameRequest = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    sprites: Sprites,
    private readonly input: Input,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.renderer = new SceneRenderer(sprites);
  }

  /** dp per CSS pixel. */
  get scale(): number {
    return Math.max(1, Math.min(this.canvas.clientWidth, this.canvas.clientHeight) / BASE_VIEW_SIZE);
  }

  private get viewport(): Viewport {
    const scale = this.scale;
    return {
      width: this.canvas.clientWidth / scale,
      height: this.canvas.clientHeight / scale,
      lift: this.keypadHeight / scale / 2,
    };
  }

  /** Puts the bike on the start of a track. Throws if the track cannot be used. */
  load(track: Track, league: number): void {
    // Constructed first so an invalid track leaves the current run untouched.
    const sim = new Sim({ track: track.data, league });
    this.sim = sim;
    this.track = track;
    this.league = league;
    this.begin(true);
  }

  /** Starts the current track over (`GDActivity.restart`). */
  restart(): void {
    if (!this.track) return;
    this.sim = new Sim({ track: this.track.data, league: this.league });
    this.begin(true);
  }

  private begin(showName: boolean): void {
    if (!this.sim || !this.track) return;
    this.phase = 'riding';
    this.phaseTicks = 0;
    this.brokenTicks = 0;
    this.result = null;
    this.animator.reset();
    this.sim.capture(this.current);
    copyPose(this.current, this.previous);
    this.previousLookX = this.previousLookY = 0;
    this.pending = 0;
    if (showName) this.showMessage(this.track.name, TRACK_NAME_TICKS);
  }

  private showMessage(text: string, ticks: number): void {
    this.message = text;
    this.messageTicks = ticks;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = null;
    this.frameRequest = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameRequest);
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    const elapsed = this.lastFrame === null ? 0 : Math.min(now - this.lastFrame, MAX_FRAME_MILLISECONDS);
    this.lastFrame = now;
    this.pending += elapsed;
    while (this.pending >= TICK_MILLISECONDS) {
      this.pending -= TICK_MILLISECONDS;
      this.tick();
    }
    this.draw(this.pending / TICK_MILLISECONDS);
    this.frameRequest = requestAnimationFrame(this.frame);
  };

  /** Advances the game by one simulation tick. Public so tests can drive it without a clock. */
  tick(): void {
    const sim = this.sim;
    if (!sim) return;
    if (this.messageTicks > 0 && --this.messageTicks === 0) this.message = null;

    if (this.phase === 'crashed') {
      if (--this.phaseTicks <= 0) this.restart();
      return;
    }
    if (this.brokenTicks > 0 && --this.brokenTicks === 0) {
      this.restart();
      return;
    }

    const controls = this.input.read();
    const status = sim.step(controls.throttle, controls.lean);
    copyPose(this.current, this.previous);
    this.previousLookX = this.animator.lookX;
    this.previousLookY = this.animator.lookY;
    sim.capture(this.current);
    const viewport = this.viewport;
    this.animator.step(this.current, sim.terrain, this.lookAhead, Math.min(viewport.width, viewport.height));

    if (this.phase === 'finished') {
      if (status === Status.Crashed || --this.phaseTicks <= 0) this.finish();
      return;
    }

    if (status === Status.Broken && this.brokenTicks === 0) {
      this.brokenTicks = CRASH_RESTART_TICKS;
      this.showMessage('Crashed', CRASH_RESTART_TICKS);
    } else if (status === Status.Crashed) {
      this.phase = 'crashed';
      this.phaseTicks =
        this.brokenTicks > 0 ? Math.min(this.brokenTicks, HARD_CRASH_RESTART_TICKS) : HARD_CRASH_RESTART_TICKS;
      this.showMessage('Crashed', CRASH_RESTART_TICKS);
    } else if (status === Status.Finished || status === Status.FinishedLate) {
      this.phase = 'finished';
      this.phaseTicks = FINISH_TICKS;
      this.result = { time: sim.raceTime, wheelie: sim.wheelie };
      this.showMessage(sim.wheelie ? 'Wheelie!' : 'Finished', FINISH_TICKS);
    }
  }

  private finish(): void {
    const result = this.result;
    this.restart();
    if (result) this.onFinish?.(result);
  }

  private draw(alpha: number): void {
    const sim = this.sim;
    if (!sim) return;
    const canvas = this.canvas;
    const scale = this.scale;
    const ratio = canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1;
    const ctx = this.ctx;
    ctx.setTransform(ratio * scale, 0, 0, ratio * scale, 0, 0);

    // Blend the last two ticks so motion stays smooth at any display rate.
    const blended = this.blended;
    const a = this.phase === 'crashed' ? 1 : alpha;
    const mix = (from: number, to: number) => from + (to - from) * a;
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

    const viewport = this.viewport;
    this.renderer.draw(ctx, viewport, sim.terrain, blended, this.animator, sim.league, this.options);
    this.animator.lookX = lookX;
    this.animator.lookY = lookY;

    drawHud(ctx, viewport, {
      progress: blended.progress / 65536,
      time: this.result ? this.result.time : sim.raceTime,
      message: this.message,
    });
  }
}
