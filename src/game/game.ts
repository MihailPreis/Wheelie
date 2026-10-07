import { createPose, type Pose, Sim, type SimSnapshot, Status, TICK_MILLISECONDS } from '../core/sim';
import type { TrackData } from '../formats/mrg';
import { inputCode, inputLean, inputThrottle, Outcome } from '../formats/replay';
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

/** Frame speed, in the simulation's units per tick, at which the engine sound tops out. */
const ENGINE_TOP_SPEED = 2_200_000;

/** Replays keep a snapshot of the simulation this often, so seeking never re-rides more than this. */
const SNAPSHOT_EVERY = 256;
/** Most ticks simulated in one frame of fast playback; beyond it playback slows instead of stalling. */
const MAX_TICKS_PER_FRAME = 400;

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

/** A run as it was ridden, from the start line to wherever it ended. */
export interface RecordedRun {
  /** One input code per simulation tick. */
  inputs: Uint8Array;
  outcome: Outcome;
  wheelie: boolean;
  /** Race time in milliseconds; 0 unless finished. */
  time: number;
  /** Hash of the simulation state after the last tick. */
  finalHash: number;
}

/** A recorded run to watch instead of ride. */
export interface Playback {
  /** One input code per tick. */
  inputs: Uint8Array;
  /** Race time shown once the bike has finished, in milliseconds. */
  finishTime: number;
}

const isDown = (status: Status) => status === Status.Broken || status === Status.Crashed;
const isFinished = (status: Status) => status === Status.Finished || status === Status.FinishedLate;

/** Sounds of a run. Nothing here feeds back into the simulation. */
export interface GameAudio {
  /** Called every frame while the player is riding; `speed` is 0…1. */
  engine(speed: number, throttle: boolean): void;
  engineOff(): void;
  crash(): void;
  finish(wheelie: boolean): void;
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
  audio: GameAudio | null = null;
  /** Called once for every run of the player's, however it ended. */
  onRun: ((run: RecordedRun) => void) | null = null;
  /** Playback speed of a replay; 1 is real time. */
  speed = 1;
  /** Called when a replay has played to its last tick. */
  onPlaybackEnd: (() => void) | null = null;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly renderer: SceneRenderer;
  private readonly animator = new Animator();

  private sim: Sim | null = null;
  private track: Track | null = null;
  private currentLeague = 0;
  private demo = false;

  private phase: Phase = 'riding';
  private phaseTicks = 0;
  /** Ticks until a broken bike is put back on the start; 0 while it is whole. */
  private brokenTicks = 0;
  private result: RunResult | null = null;
  private throttle = false;
  private recorded: number[] = [];
  private playback: (Playback & { snapshots: SimSnapshot[] }) | null = null;

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
    this.endRun();
    this.playback = null;
    this.sim = sim;
    this.track = track;
    this.currentLeague = league;
    this.demo = demo;
    this.begin(!demo);
  }

  /** Shows a recorded run on its track. Throws if the track cannot be used. */
  watch(track: Track, league: number, playback: Playback): void {
    const sim = new Sim({ track: track.data, league, demo: false });
    this.endRun();
    this.sim = sim;
    this.track = track;
    this.currentLeague = league;
    this.demo = false;
    this.playback = { ...playback, snapshots: [sim.save()] };
    this.speed = 1;
    this.begin(true);
  }

  /** Tick the replay being watched stands at. */
  get position(): number {
    return this.playback && this.sim ? this.sim.ticks : 0;
  }

  /** Length of the replay being watched, in ticks. */
  get length(): number {
    return this.playback?.inputs.length ?? 0;
  }

  /** Jumps to a tick of the replay being watched. */
  seek(tick: number): void {
    const playback = this.playback;
    const sim = this.sim;
    if (!playback || !sim) return;
    const target = Math.max(0, Math.min(playback.inputs.length, Math.round(tick)));
    const index = Math.min(Math.floor(target / SNAPSHOT_EVERY), playback.snapshots.length - 1);
    const snapshot = playback.snapshots[index];
    if (!snapshot) return;
    sim.load(snapshot);
    this.animator.reset();
    this.message = null;
    this.messageTicks = 0;
    sim.capture(this.current);
    // Riding up to the target also brings the camera to where it would have been.
    while (sim.ticks < target) this.playbackStep(false);
    copyPose(this.current, this.previous);
    this.previousLookX = this.animator.lookX;
    this.previousLookY = this.animator.lookY;
    this.pending = 0;
  }

  /** One tick of a replay. `live` is false while seeking, when nothing should sound or flash up. */
  private playbackStep(live: boolean): void {
    const playback = this.playback;
    const sim = this.sim;
    if (!playback || !sim) return;
    const code = playback.inputs[sim.ticks] ?? inputCode(0, 0);
    const before = sim.status;
    const status = sim.step(inputThrottle(code), inputLean(code));
    this.throttle = inputThrottle(code) > 0;
    if (sim.ticks % SNAPSHOT_EVERY === 0) playback.snapshots[sim.ticks / SNAPSHOT_EVERY] ??= sim.save();
    copyPose(this.current, this.previous);
    this.previousLookX = this.animator.lookX;
    this.previousLookY = this.animator.lookY;
    sim.capture(this.current);
    const viewport = this.viewport;
    this.animator.step(this.current, sim.terrain, this.lookAhead, Math.min(viewport.width, viewport.height));
    if (!live) return;
    if (isDown(status) && !isDown(before)) {
      this.audio?.crash();
      this.showMessage('Crashed', CRASH_RESTART_TICKS);
    } else if (isFinished(status) && !isFinished(before)) {
      this.audio?.finish(sim.wheelie);
      this.showMessage(sim.wheelie ? 'Wheelie!' : 'Finished', FINISH_TICKS);
    }
  }

  /** Starts the current track over (`GDActivity.restart`). */
  restart(): void {
    if (!this.track || this.playback) return;
    this.endRun();
    this.sim = new Sim({ track: this.track.data, league: this.currentLeague, demo: this.demo });
    this.begin(!this.demo);
  }

  /** League of the track that is loaded. */
  get league(): number {
    return this.currentLeague;
  }

  /** Whether a run is under way that pausing would interrupt. */
  get riding(): boolean {
    return !this.demo && !this.playback && this.sim !== null && this.phase !== 'done';
  }

  /** Hands the run that is ending to whoever keeps replays. */
  private endRun(): void {
    const sim = this.sim;
    if (!sim || this.demo || this.playback || this.recorded.length === 0) return;
    const crashed = this.brokenTicks > 0 || this.phase === 'crashed' || sim.status === Status.Crashed;
    const run: RecordedRun = {
      inputs: Uint8Array.from(this.recorded),
      outcome: this.result ? Outcome.Finished : crashed ? Outcome.Crashed : Outcome.Abandoned,
      wheelie: this.result?.wheelie ?? false,
      time: this.result?.time ?? 0,
      finalHash: sim.hash() >>> 0,
    };
    this.recorded = [];
    this.onRun?.(run);
  }

  private begin(showName: boolean): void {
    if (!this.sim || !this.track) return;
    this.phase = 'riding';
    this.phaseTicks = 0;
    this.brokenTicks = 0;
    this.result = null;
    this.recorded = [];
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
    this.audio?.engineOff();
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
      this.pending += elapsed * (this.playback ? this.speed : 1);
      for (let ticks = 0; this.pending >= interval && !this.paused; ticks++) {
        this.pending -= interval;
        if (ticks < MAX_TICKS_PER_FRAME) this.tick();
      }
    }
    this.draw(this.paused ? 1 : this.pending / interval);
    this.updateEngineSound();
    this.frameRequest = requestAnimationFrame(this.frame);
  };

  private updateEngineSound(): void {
    const audio = this.audio;
    if (!audio) return;
    const down = this.playback !== null && this.sim !== null && isDown(this.sim.status);
    const riding =
      !down &&
      !this.demo &&
      !this.paused &&
      this.brokenTicks === 0 &&
      (this.phase === 'riding' || this.phase === 'finished');
    if (!riding) {
      audio.engineOff();
      return;
    }
    const speed = Math.hypot(this.current.frameVx, this.current.frameVy) / ENGINE_TOP_SPEED;
    audio.engine(Math.min(1, speed), this.throttle && this.phase === 'riding');
  }

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

    if (this.playback) {
      if (sim.ticks >= this.playback.inputs.length) {
        this.paused = true;
        this.onPlaybackEnd?.();
      } else {
        this.playbackStep(true);
      }
      return;
    }

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
    this.throttle = controls.throttle > 0;
    if (!this.demo) this.recorded.push(inputCode(controls.throttle, controls.lean));
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
      this.audio?.crash();
      this.showMessage('Crashed', CRASH_RESTART_TICKS);
    } else if (status === Status.Crashed) {
      if (this.brokenTicks === 0) this.audio?.crash();
      this.phase = 'crashed';
      this.phaseTicks =
        this.brokenTicks > 0 ? Math.min(this.brokenTicks, HARD_CRASH_RESTART_TICKS) : HARD_CRASH_RESTART_TICKS;
      this.showMessage('Crashed', CRASH_RESTART_TICKS);
    } else if (status === Status.Finished || status === Status.FinishedLate) {
      this.phase = 'finished';
      this.phaseTicks = FINISH_TICKS;
      this.result = { time: sim.raceTime, wheelie: sim.wheelie };
      this.audio?.finish(sim.wheelie);
      this.showMessage(sim.wheelie ? 'Wheelie!' : 'Finished', FINISH_TICKS);
    }
  }

  private finish(): void {
    this.phase = 'done';
    this.message = null;
    this.endRun();
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
      time: this.result
        ? this.result.time
        : this.playback && isFinished(sim.status)
          ? this.playback.finishTime
          : sim.raceTime,
      message: this.message,
    });
  }
}
