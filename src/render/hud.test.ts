import { describe, expect, it } from 'vitest';
import { formatTime } from './hud';

describe('formatTime', () => {
  it('formats centiseconds as m:ss:cc', () => {
    expect(formatTime(0)).toBe('0:00:00');
    expect(formatTime(5)).toBe('0:00:05');
    expect(formatTime(1234)).toBe('0:12:34');
    expect(formatTime(6000)).toBe('1:00:00');
    expect(formatTime(75999)).toBe('12:39:99');
  });
});
