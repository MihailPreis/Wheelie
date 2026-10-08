import { describe, expect, it } from 'vitest';
import type { Terrain } from '../core/terrain';
import { shadowDepth, shadowGround } from './shadow';

const terrain = { points: new Int32Array([0, 0, 65536, 65536, 131072, 65536]), pointCount: 3 } as Terrain;

describe('shadow surface', () => {
  it('follows slopes and flat sections without extending beyond the track', () => {
    expect(shadowGround(terrain, 4)).toEqual({ y: 4, slope: 1 });
    expect(shadowGround(terrain, 12)).toEqual({ y: 8, slope: 0 });
    expect(shadowGround(terrain, -0.01)).toBeNull();
    expect(shadowGround(terrain, 16.01)).toBeNull();
  });

  it('uses the same depth direction as the track ribbon and handles coincident points', () => {
    expect(shadowDepth(0, 0, 0, 400)[0]).toBe(0);
    expect(shadowDepth(0, 0, 0, 400)[1]).toBeGreaterThan(32);
    expect(shadowDepth(0, 0, 0, 0)).toEqual([0, 0]);
  });
});
