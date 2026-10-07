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
