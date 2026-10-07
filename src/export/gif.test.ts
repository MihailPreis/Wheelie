import { describe, expect, it } from 'vitest';
import { gifFrameCount, gifSpeed } from './gif';

describe('GIF pacing', () => {
  it('speeds long runs up, within limits', () => {
    expect(gifSpeed(5_000)).toBe(2);
    expect(gifSpeed(40_000)).toBe(2);
    expect(gifSpeed(55_000)).toBe(3);
    expect(gifSpeed(600_000)).toBe(4);
  });

  it('spaces frames 40 ms apart in playback time', () => {
    // 8 seconds at double speed play in 4 seconds: 100 frames and the closing one.
    expect(gifFrameCount(8_000, 2)).toBe(101);
    expect(gifFrameCount(0, 2)).toBe(2);
  });
});
