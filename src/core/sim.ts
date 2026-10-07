import type { TrackData } from '../formats/mrg';
import { Physics, Status } from './physics';
import { Terrain } from './terrain';

export { LEAGUE_COUNT, Status } from './physics';
export { InvalidTrackError } from './terrain';

/** Simulation ticks per second of game time: the original runs two ticks per 30 ms frame. */
export const TICK_MILLISECONDS = 15;

export interface SimOptions {
  track: TrackData;
  /** 0–3: 100cc, 175cc, 220cc, 325cc. */
  league: number;
  /** Let the built-in demo rider drive; input is then ignored. */
  demo?: boolean;
}

/** Number of point bodies the bike is made of. */
export const BODY_COUNT = 6;

/**
 * What drawing needs to know about one moment of the simulation. Coordinates are 16.16 fixed
 * point in body space; the arrays are indexed by `BodyIndex`.
 */
export interface Pose {
  x: Float64Array;
  y: Float64Array;
  /** Wheel rotation; meaningful for the two wheels only. */
  angle: Float64Array;
  /** Velocity of the frame, which drives the look-ahead camera. */
  frameVx: number;
  frameVy: number;
  /** Rider posture: 0 leaning back, 0x10000 leaning forward. */
  riderLean: number;
  broken: boolean;
  /** Progress from start to finish, 16.16 in 0…1. */
  progress: number;
  /** Horizontal extent and height of the bike in track space, for the ground shadow. */
  shadowLeft: number;
  shadowRight: number;
  shadowY: number;
}

export function createPose(): Pose {
  return {
    x: new Float64Array(BODY_COUNT),
    y: new Float64Array(BODY_COUNT),
    angle: new Float64Array(BODY_COUNT),
    frameVx: 0,
    frameVy: 0,
    riderLean: 32768,
    broken: false,
    progress: 0,
    shadowLeft: 0,
    shadowRight: 0,
    shadowY: 0,
  };
}

/** Opaque state captured by {@link Sim.save}. */
export interface SimSnapshot {
  readonly physics: Int32Array;
  readonly ticks: number;
  readonly raceTicks: number;
  readonly racing: boolean;
  readonly status: Status;
}

/**
 * A deterministic run of one track.
 *
 * The same sequence of {@link step} calls always produces the same states, bit for bit, on any
 * machine. Nothing here reads the clock, the DOM or any other outside state.
 */
export class Sim {
  private readonly physics: Physics;
  readonly terrain: Terrain;

  /** Ticks simulated so far. */
  ticks = 0;
  /** Ticks since the bike crossed the start line; the race clock. */
  raceTicks = 0;
  private racing = false;
  /** Result of the latest tick. */
  status: Status = Status.BeforeStart;

  /** Throws {@link InvalidTrackError} if the track geometry cannot be used. */
  constructor(options: SimOptions) {
    this.terrain = new Terrain(options.track);
    this.physics = new Physics(this.terrain, options.league);
    if (options.demo) this.physics.startDemo();
  }

  /**
   * Advances one tick with the given controls. `throttle`: 1 accelerate, -1 brake, 0 neither.
   * `lean`: 1 forward, -1 back, 0 neither.
   */
  step(throttle: number, lean: number): Status {
    this.physics.setInput(throttle, lean);
    const status = this.physics.tick();
    this.ticks++;

    // The clock starts on the first tick past the start line and resets if the bike rolls back behind it.
    if (status === Status.BeforeStart) {
      this.racing = false;
      this.raceTicks = 0;
    } else if (!this.racing) {
      this.racing = true;
      this.raceTicks = 0;
    } else {
      this.raceTicks++;
    }
    this.status = status;
    return status;
  }

  get league(): number {
    return this.physics.league;
  }

  /** Copies the current state of the bike into `pose` for drawing. */
  capture(pose: Pose): void {
    const physics = this.physics;
    for (let i = 0; i < BODY_COUNT; i++) {
      const state = physics.bodies[i]?.slots[physics.current];
      if (!state) continue;
      pose.x[i] = state.x;
      pose.y[i] = state.y;
      pose.angle[i] = state.angle;
    }
    const frame = physics.bodies[0]?.slots[physics.current];
    pose.frameVx = frame?.vx ?? 0;
    pose.frameVy = frame?.vy ?? 0;
    pose.riderLean = physics.riderLean;
    pose.broken = physics.broken;
    // The original follows the leading wheel, or the frame once the bike has broken apart.
    const lead = Math.max(pose.x[1] as number, pose.x[2] as number);
    pose.progress = this.terrain.progress(physics.broken ? (pose.x[0] as number) : lead);
    pose.shadowLeft = this.terrain.shadowLeft;
    pose.shadowRight = this.terrain.shadowRight;
    pose.shadowY = this.terrain.shadowY;
  }

  /** Race time in milliseconds. */
  get raceTime(): number {
    return this.raceTicks * TICK_MILLISECONDS;
  }

  /** True if the front wheel has not touched the ground since the start. */
  get wheelie(): boolean {
    return !this.physics.frontWheelTouched;
  }

  /** 32-bit FNV-1a hash of the simulation state, comparable with the golden traces. */
  hash(): number {
    const words: number[] = [];
    this.physics.writeState(words);
    let hash = 0x811c9dc5 | 0;
    for (const word of words) {
      for (let shift = 0; shift < 32; shift += 8) {
        hash ^= (word >>> shift) & 0xff;
        hash = Math.imul(hash, 16777619);
      }
    }
    return hash;
  }

  save(): SimSnapshot {
    return {
      physics: this.physics.save(),
      ticks: this.ticks,
      raceTicks: this.raceTicks,
      racing: this.racing,
      status: this.status,
    };
  }

  /** Restores a snapshot taken from a simulation of the same track and league. */
  load(snapshot: SimSnapshot): void {
    this.physics.load(snapshot.physics);
    this.ticks = snapshot.ticks;
    this.raceTicks = snapshot.raceTicks;
    this.racing = snapshot.racing;
    this.status = snapshot.status;
  }
}
