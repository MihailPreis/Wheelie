import { Sim, Status } from '../core/sim';
import type { TrackData } from '../formats/mrg';
import { inputLean, inputThrottle, type Replay } from '../formats/replay';

export interface SimulatedRun {
  /** Hash of the state after the last tick. */
  finalHash: number;
  /** Race time at the finish line in milliseconds, or null if the bike never got there. */
  time: number | null;
}

/** Rides a replay from start to end. Throws if the track cannot be used. */
export function simulate(track: TrackData, replay: Replay): SimulatedRun {
  const sim = new Sim({ track, league: replay.league, demo: false });
  let time: number | null = null;
  for (const code of replay.inputs) {
    const status = sim.step(inputThrottle(code), inputLean(code));
    if (time === null && (status === Status.Finished || status === Status.FinishedLate)) time = sim.raceTime;
  }
  return { finalHash: sim.hash() >>> 0, time };
}

/** Whether riding the replay again on this track ends exactly as the replay says it did. */
export function verifyReplay(track: TrackData, replay: Replay): boolean {
  try {
    const run = simulate(track, replay);
    return run.finalHash === replay.finalHash && (run.time ?? 0) === replay.time;
  } catch {
    return false;
  }
}
