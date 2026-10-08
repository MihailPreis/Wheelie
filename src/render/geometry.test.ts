import { describe, expect, it } from 'vitest';
import { angleOf } from './geometry';

describe('bike and rider angles', () => {
  it('follows a full rotation independently of vector scale', () => {
    for (let degrees = -179; degrees <= 180; degrees++) {
      const radians = (degrees * Math.PI) / 180;
      for (const length of [1, 65536, 500000]) {
        expect(angleOf(Math.sin(radians) * length, Math.cos(radians) * length)).toBeCloseTo(radians, 10);
      }
    }
  });

  it('has a finite angle for coincident joints', () => {
    expect(angleOf(0, 0)).toBe(0);
  });
});
