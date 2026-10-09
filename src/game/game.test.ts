import { expect, it } from 'vitest';
import type { Physics } from '../core/physics';
import type { Sim } from '../core/sim';
import type { TrackData } from '../formats/mrg';
import { Outcome } from '../formats/replay';
import type { Sprites } from '../render/sprites';
import { verifyReplay } from '../replay/simulate';
import { Game, type RecordedRun } from './game';
import type { Input } from './input';

const track: TrackData = {
  truncated: false,
  points: Int32Array.from([0, 0, 10 * 65536, 0, 20 * 65536, 0]),
  pointCount: 3,
  startX: 2 * 65536,
  startY: 5 * 65536,
  finishX: 18 * 65536,
  finishY: 0,
};

it.each([
  [-30, 0],
  [0, -20],
])('freezes a run immediately outside the track (%s, %s) and records a crash', (dx, dy) => {
  const canvas = { getContext: () => ({}), clientWidth: 640, clientHeight: 360 } as unknown as HTMLCanvasElement;
  const game = new Game(canvas, {} as Sprites, { beginRun: () => {}, read: () => ({ throttle: 0, lean: 0 }) } as Input);
  game.load({ name: 'test', data: track }, 0);
  const internal = game as unknown as { sim: Sim; phase: string };
  const physics = (internal.sim as unknown as { physics: Physics }).physics;
  for (const body of physics.bodies) {
    const state = body.slots[physics.current];
    if (!state) throw new Error('Missing body');
    state.x += dx * 65536 * 2;
    state.y += dy * 65536 * 2;
  }
  game.tick();
  expect(internal.phase).toBe('crashed');
  const hash = internal.sim.hash() >>> 0;
  const ticks = internal.sim.ticks;
  game.tick();
  expect(internal.sim.hash() >>> 0).toBe(hash);
  expect(internal.sim.ticks).toBe(ticks);
  const runs: RecordedRun[] = [];
  game.onRun = (run) => runs.push(run);
  game.restart();
  expect(runs).toHaveLength(1);
  expect(runs[0]?.outcome).toBe(Outcome.Crashed);
  expect(runs[0]?.finalHash).toBe(hash);
});

it('keeps an ordinary recorded run reproducible under the original physics', () => {
  const canvas = { getContext: () => ({}), clientWidth: 640, clientHeight: 360 } as unknown as HTMLCanvasElement;
  const game = new Game(canvas, {} as Sprites, { beginRun: () => {}, read: () => ({ throttle: 1, lean: 0 }) } as Input);
  game.load({ name: 'test', data: track }, 0);
  for (let tick = 0; tick < 20; tick++) game.tick();
  const runs: RecordedRun[] = [];
  game.onRun = (run) => runs.push(run);
  game.restart();
  const run = runs[0];
  if (!run) throw new Error('No run was recorded');
  expect(verifyReplay(track, { ...run, league: 0 } as Parameters<typeof verifyReplay>[1])).toBe(true);
});

it('records an outside-track crash that reproduces without modifying simulation state', () => {
  const outside = { ...track, startX: -30 * 65536 };
  const canvas = { getContext: () => ({}), clientWidth: 640, clientHeight: 360 } as unknown as HTMLCanvasElement;
  const game = new Game(canvas, {} as Sprites, { beginRun: () => {}, read: () => ({ throttle: 0, lean: 0 }) } as Input);
  game.load({ name: 'outside', data: outside }, 0);
  game.tick();
  const runs: RecordedRun[] = [];
  game.onRun = (run) => runs.push(run);
  game.restart();
  const run = runs[0];
  if (!run) throw new Error('No run was recorded');
  expect(run.outcome).toBe(Outcome.Crashed);
  expect(run.inputs).toHaveLength(1);
  expect(verifyReplay(outside, { ...run, league: 0 } as Parameters<typeof verifyReplay>[1])).toBe(true);
});
