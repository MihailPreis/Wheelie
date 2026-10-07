import { parsePackHeader, parseTrack } from '../formats/mrg';
import { DivisionByZeroError } from './fpmath';
import { Sim } from './sim';

/**
 * Replays scenarios recorded from the original Java physics (see tools/golden) and reports where
 * this implementation departs from them. Used by the unit tests and, in real browsers, by the
 * cross-engine determinism test.
 */

/** One recorded run. Inputs and statuses are run-length encoded. */
export interface Scenario {
  pack: string;
  level: number;
  track: number;
  league: number;
  kind: string;
  ticks: number;
  inputs: [throttle: number, lean: number, count: number][];
  statuses: [status: number, count: number][];
  /** State hash after every {@link CHECKPOINT_EVERY} ticks. */
  checkpoints: number[];
  /** State hash after the last tick. */
  final: number;
  /** Name of the Java exception that ended the run, if one did. */
  error?: string;
}

export const CHECKPOINT_EVERY = 128;

/** Returns a description of the first difference from the recording, or `null` if there is none. */
export function verifyScenario(pack: Uint8Array, scenario: Scenario): string | null {
  const entry = parsePackHeader(pack).levels[scenario.level]?.[scenario.track];
  if (!entry) return 'track not found in the pack';

  const sim = new Sim({
    track: parseTrack(pack, entry.offset),
    league: scenario.league,
    demo: scenario.kind === 'demo',
  });

  const statuses: number[] = [];
  for (const [status, count] of scenario.statuses) {
    for (let i = 0; i < count; i++) statuses.push(status);
  }

  let checkpoint = 0;
  let error: string | undefined;
  run: for (const [throttle, lean, count] of scenario.inputs) {
    for (let i = 0; i < count; i++) {
      let status: number;
      try {
        status = sim.step(throttle, lean);
      } catch (caught) {
        if (!(caught instanceof DivisionByZeroError)) throw caught;
        error = 'ArithmeticException';
        break run;
      }
      const expected = statuses[sim.ticks - 1];
      if (status !== expected) return `status ${status} at tick ${sim.ticks}, expected ${expected}`;
      if (sim.ticks % CHECKPOINT_EVERY === 0 && sim.hash() !== scenario.checkpoints[checkpoint++]) {
        return `state differs by tick ${sim.ticks}`;
      }
    }
  }

  if (error !== scenario.error) return `ended with ${error ?? 'no error'}, expected ${scenario.error ?? 'no error'}`;
  if (sim.ticks !== scenario.ticks) return `ran ${sim.ticks} ticks, expected ${scenario.ticks}`;
  if (checkpoint !== scenario.checkpoints.length) return 'checkpoint count differs';
  if (sim.hash() !== scenario.final) return 'final state differs';
  return null;
}

/** Verifies many scenarios against one pack; returns one message per failing scenario. */
export function verifyScenarios(pack: Uint8Array, scenarios: Scenario[]): string[] {
  const failures: string[] = [];
  for (const [index, scenario] of scenarios.entries()) {
    const difference = verifyScenario(pack, scenario);
    if (difference) {
      failures.push(
        `#${index} level ${scenario.level} track ${scenario.track} league ${scenario.league} ${scenario.kind}: ${difference}`,
      );
    }
  }
  return failures;
}
