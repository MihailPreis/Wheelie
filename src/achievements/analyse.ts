import { createPose, Sim, Status } from '../core/sim';
import type { TrackData } from '../formats/mrg';
import { inputLean, inputThrottle } from '../formats/replay';

/** What happened in a run, as far as achievements care. */
export interface RunFacts {
  finished: boolean;
  /** The brake was used between the start line and the finish. */
  braked: boolean;
  /** The throttle was let go of between the start line and the finish. */
  coasted: boolean;
  /** The rider leaned between the start line and the finish. */
  leaned: boolean;
  /** How far the bike turned over in the course of the run, in full turns. */
  turns: number;
  /** Tick at which the rider went down, or null. */
  crashedAt: number | null;
  /** Tick at which the finish line was crossed, or null. */
  finishedAt: number | null;
  /** Ticks at which the bike completed a full turn. */
  flips: number[];
}

/**
 * Rides a recorded run again and notes what happened in it. Achievements are judged from the
 * recording rather than from live counters, so they cannot be earned by anything but the run itself.
 */
export function analyseRun(track: TrackData, league: number, inputs: Uint8Array): RunFacts {
  const sim = new Sim({ track, league, demo: false });
  const pose = createPose();
  const facts: RunFacts = {
    finished: false,
    braked: false,
    coasted: false,
    leaned: false,
    turns: 0,
    crashedAt: null,
    finishedAt: null,
    flips: [],
  };
  let flipFrom = 0;
  let angle: number | null = null;
  let turned = 0;
  let least = 0;
  let most = 0;
  for (const code of inputs) {
    const throttle = inputThrottle(code);
    const lean = inputLean(code);
    const status = sim.step(throttle, lean);
    if (status === Status.Finished || status === Status.FinishedLate) {
      facts.finished = true;
      facts.finishedAt = sim.ticks;
      break;
    }
    if (status === Status.Broken || status === Status.Crashed) {
      facts.crashedAt ??= sim.ticks;
      continue;
    }
    if (status !== Status.Riding) continue;
    if (throttle < 0) facts.braked = true;
    if (throttle <= 0) facts.coasted = true;
    if (lean !== 0) facts.leaned = true;

    // The frame's direction, followed tick by tick so that it can pass a full turn.
    sim.capture(pose);
    const now = Math.atan2(
      (pose.y[3] as number) - (pose.y[4] as number),
      (pose.x[3] as number) - (pose.x[4] as number),
    );
    if (angle !== null) {
      let step = now - angle;
      if (step > Math.PI) step -= 2 * Math.PI;
      if (step < -Math.PI) step += 2 * Math.PI;
      turned += step;
      least = Math.min(least, turned);
      most = Math.max(most, turned);
      if (Math.abs(turned - flipFrom) >= 2 * Math.PI) {
        facts.flips.push(sim.ticks);
        flipFrom = turned;
      }
    }
    angle = now;
  }
  // Slopes tilt the bike a fraction of a turn; only going right over covers a whole one.
  facts.turns = (most - least) / (2 * Math.PI);
  return facts;
}
