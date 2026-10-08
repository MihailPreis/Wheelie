import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Sim, Status } from '../core/sim';
import { parsePackHeader, parseTrack } from '../formats/mrg';
import { inputCode } from '../formats/replay';
import type { Sprites } from '../render/sprites';
import { Game } from './game';
import { Input } from './input';

const pack = new Uint8Array(readFileSync('public/assets/levels/levels.mrg'));
const data = parseTrack(pack, parsePackHeader(pack).levels[0]?.[0]?.offset ?? 0);
type GhostHarness = { sim: Sim; ghost: { sim: Sim; startTick: number } | null; stepGhost(): void };

function race(wait: number): { game: Game; state: GhostHarness } {
  const canvas = { getContext: () => ({}) } as unknown as HTMLCanvasElement;
  vi.stubGlobal('document', { createElement: () => canvas });
  const game = new Game(canvas, {} as Sprites, new Input());
  const recording = Uint8Array.from([...Array(wait).fill(inputCode(0, 0)), ...Array(600).fill(inputCode(1, 0))]);
  game.load({ name: 'Ghost regression', data }, 0, false, recording);
  return { game, state: game as unknown as GhostHarness };
}

afterEach(() => vi.unstubAllGlobals());

describe('ghost race clock', () => {
  it.each([0, 60])('aligns recorded pre-start waiting (%i ticks) with the player start', (wait) => {
    const { state } = race(wait);
    const prepared = state.ghost?.sim.ticks;
    expect(prepared).toBeGreaterThan(wait);
    for (let i = 0; i < 30; i++) {
      state.sim.step(0, 0);
      state.stepGhost();
    }
    expect(state.sim.status).toBe(Status.BeforeStart);
    expect(state.ghost?.sim.ticks).toBe(prepared);
    for (let i = 0; i < 300 && state.sim.status === Status.BeforeStart; i++) state.sim.step(1, 0);
    expect(state.sim.status).toBe(Status.Riding);
    state.stepGhost();
    expect(state.ghost?.sim.raceTime).toBe(0);
    for (let i = 0; i < 8; i++) {
      state.sim.step(1, 0);
      state.stepGhost();
      expect(state.ghost?.sim.raceTime).toBe(state.sim.raceTime);
    }
  });

  it('prepares a fresh ghost after restarting and ignores recordings that never start', () => {
    const { game, state } = race(60);
    const first = state.ghost;
    game.restart();
    expect(state.ghost).not.toBe(first);
    expect(state.ghost?.sim.raceTime).toBe(0);
    game.load({ name: 'No start', data }, 0, false, new Uint8Array(20).fill(inputCode(0, 0)));
    expect(state.ghost).toBeNull();
  });
});
