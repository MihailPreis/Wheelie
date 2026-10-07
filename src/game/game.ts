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

// Adaptive resolution: if the display cannot keep up, the canvas is rendered at fewer pixels.
/** Frames slower than this on average count as struggling. */
const SLOW_FRAME_MILLISECONDS = 25;
const QUALITY_WINDOW_FRAMES = 60;
const QUALITY_STEP = 0.75;

const ticksFor = (milliseconds: number) => Math.ceil(milliseconds / TICK_MILLISECONDS);
const CRASH_RESTART_TICKS = ticksFor(3000);
const HARD_CRASH_RESTART_TICKS = ticksFor(1000);
const FINISH_TICKS = ticksFor(1000);
const TRACK_NAME_TICKS = ticksFor(3000);
/** The demo behind the menus runs in slow motion, as in the original. */
const DEMO_TICK_MILLISECONDS = 50;

type Phase =
  /** The simulation is running. */
  | 'riding'
  /** The rider is down; the scene is frozen until the restart. */
  | 'crashed'
  /** The finish line has been crossed; the bike rolls on for a moment. */
  | 'finished'
  /** The run is over and the scene stands still until something else is loaded. */
  | 'done';

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
  /** Draw the clock, the progress bar and messages. Off while a menu covers the scene. */
  hud = true;
  /** While set, time stands still. */
  paused = false;
  /** Called when a run reaches the finish, after the bike has rolled out. The scene then stands still. */
  onFinish: ((result: RunResult) => void) | null = null;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly renderer: SceneRenderer;
  private readonly animator = new Animator();

  private sim: Sim | null = null;
  private track: Track | null = null;
  private league = 0;
  private demo = false;

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

  /** Fraction of the device's pixel density the canvas is rendered at; lowered if frames run slow. */
  private quality = 1;
  private windowFrames = 0;
  private windowTime = 0;

  private lastFrame: number | null = null;
  private pending = 0;
  private running = false;
  private frameRequest = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    sprites: Sprites,
    private readonly input: Input,
  ) {
    // An opaque canvas is cheaper for the browser to composite.
    const ctx = canvas.getContext('2d', { alpha: false });
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

  /**
   * Puts the bike on the start of a track. With `demo` the built-in rider drives, for the scene
   * behind the menus. Throws if the track cannot be used.
   */
  load(track: Track, league: number, demo = false): void {
    // Constructed first so an invalid track leaves the current run untouched.
    const sim = new Sim({ track: track.data, league, demo });
    this.sim = sim;
    this.track = track;
    this.league = league;
    this.demo = demo;
    this.begin(!demo);
  }

  /** Starts the current track over (`GDActivity.restart`). */
  restart(): void {
    if (!this.track) return;
    this.sim = new Sim({ track: this.track.data, league: this.league, demo: this.demo });
    this.begin(!this.demo);
  }

  /** Whether a run is under way that pausing would interrupt. */
  get riding(): boolean {
    return !this.demo && this.sim !== null && this.phase !== 'done';
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
    this.message = null;
    this.messageTicks = 0;
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
    const gap = this.lastFrame === null ? 0 : now - this.lastFrame;
    const elapsed = Math.min(gap, MAX_FRAME_MILLISECONDS);
    this.lastFrame = now;
    if (gap > 0 && gap < MAX_FRAME_MILLISECONDS) this.watchFrameRate(gap);
    const interval = this.demo ? DEMO_TICK_MILLISECONDS : TICK_MILLISECONDS;
    if (this.paused) {
      this.pending = 0;
    } else {
      this.pending += elapsed;
      while (this.pending >= interval) {
        this.pending -= interval;
        this.tick();
      }
    }
    this.draw(this.paused ? 1 : this.pending / interval);
    this.frameRequest = requestAnimationFrame(this.frame);
  };

  /** Lowers the rendering resolution when frames have been slow for a whole window. */
  private watchFrameRate(gap: number): void {
    this.windowFrames++;
    this.windowTime += gap;
    if (this.windowFrames < QUALITY_WINDOW_FRAMES) return;
    const average = this.windowTime / this.windowFrames;
    this.windowFrames = 0;
    this.windowTime = 0;
    // Never below one canvas pixel per CSS pixel.
    const floor = 1 / (window.devicePixelRatio || 1);
    if (average > SLOW_FRAME_MILLISECONDS && this.quality > floor) {
      this.quality = Math.max(floor, this.quality * QUALITY_STEP);
    }
  }

  /** Keeps the canvas backing store matched to its size on screen, the pixel density and the quality level. */
  private fitCanvas(): number {
    const canvas = this.canvas;
    const ratio = (window.devicePixelRatio || 1) * this.quality;
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return canvas.clientWidth > 0 ? width / canvas.clientWidth : ratio;
  }

  /** Advances the game by one simulation tick. Public so tests can drive it without a clock. */
  tick(): void {
    const sim = this.sim;
    if (!sim || this.phase === 'done') return;
    if (this.messageTicks > 0 && --this.messageTicks === 0) this.message = null;

    if (this.phase === 'crashed') {
      if (--this.phaseTicks <= 0) this.restart();
      return;
    }
    if (this.brokenTicks > 0 && --this.brokenTicks === 0) {
      this.restart();
      return;
    }

    const controls = this.demo ? { throttle: 0, lean: 0 } : this.input.read();
    const status = sim.step(controls.throttle, controls.lean);
    copyPose(this.current, this.previous);
    this.previousLookX = this.animator.lookX;
    this.previousLookY = this.animator.lookY;
    sim.capture(this.current);
    const viewport = this.viewport;
    this.animator.step(this.current, sim.terrain, this.lookAhead, Math.min(viewport.width, viewport.height));

    if (this.demo) {
      // Menu.showMenu: the demo rider starts over as soon as the run ends in any way.
      if (status !== Status.Riding && status !== Status.BeforeStart) this.restart();
      return;
    }

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
    this.phase = 'done';
    this.message = null;
    if (this.result) this.onFinish?.(this.result);
  }

  private draw(alpha: number): void {
    const sim = this.sim;
    if (!sim) return;
    const scale = this.scale;
    const ratio = this.fitCanvas();
    const ctx = this.ctx;
    ctx.setTransform(ratio * scale, 0, 0, ratio * scale, 0, 0);

    // Blend the last two ticks so motion stays smooth at any display rate.
    const blended = this.blended;
    const a = this.phase === 'crashed' || this.phase === 'done' ? 1 : alpha;
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

    if (!this.hud) return;
    drawHud(ctx, viewport, {
      progress: blended.progress / 65536,
      time: this.result ? this.result.time : sim.raceTime,
      message: this.message,
    });
  }
}
