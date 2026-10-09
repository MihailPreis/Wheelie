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

it('retains the preceding slope at shared vertices and supports long tracks', () => {
  expect(shadowGround(terrain, 8)).toEqual({ y: 8, slope: 1 });
  const points = new Int32Array(40000);
  for (let i = 0; i < 20000; i++) {
    points[i * 2] = i * 1024;
    points[i * 2 + 1] = i * 512;
  }
  expect(shadowGround({ points, pointCount: 20000 } as Terrain, 2400)).toEqual({ y: 1200, slope: 0.5 });
});
