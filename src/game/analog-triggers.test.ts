import { afterEach, describe, expect, it, vi } from 'vitest';
import { Input } from './input';

function pad(throttle: number, brake = 0): Gamepad {
  return {
    connected: true,
    axes: [0],
    buttons: Array.from({ length: 16 }, (_, index) => {
      const value = index === 7 ? throttle : index === 6 ? brake : 0;
      return { value, pressed: value > 0.3, touched: value > 0 };
    }),
  } as unknown as Gamepad;
}

afterEach(() => vi.unstubAllGlobals());

describe('smooth gamepad triggers', () => {
  it('meters half pressure as half of the simulation ticks', () => {
    vi.stubGlobal('navigator', { getGamepads: () => [pad(0.525)] });
    const input = new Input();
    input.analogTriggers = true;
    const ticks = Array.from({ length: 100 }, () => input.read().throttle);
    expect(ticks.filter((tick) => tick === 1)).toHaveLength(50);
    expect(ticks.every((tick) => tick === 0 || tick === 1)).toBe(true);
  });

  it('supports full drive, braking, cancellation and the dead zone', () => {
    let current = pad(1);
    vi.stubGlobal('navigator', { getGamepads: () => [current] });
    const input = new Input();
    input.analogTriggers = true;
    expect(input.read().throttle).toBe(1);
    current = pad(0, 1);
    expect(input.read().throttle).toBe(-1);
    current = pad(1, 1);
    expect(input.read().throttle).toBe(0);
    current = pad(0.04);
    expect(input.read().throttle).toBe(0);
  });

  it('keeps threshold control as the default and detects connected pads', () => {
    vi.stubGlobal('navigator', { getGamepads: () => [pad(0.525)] });
    const input = new Input();
    input.gamepadConnected();
    expect(input.device).toBe('gamepad');
    expect(input.read().throttle).toBe(1);
  });

  it('discards the remainder when released or changing direction', () => {
    let current = pad(0.7625);
    vi.stubGlobal('navigator', { getGamepads: () => [current] });
    const input = new Input();
    input.analogTriggers = true;
    expect(input.read().throttle).toBe(0);
    input.release();
    expect(input.read().throttle).toBe(0);
    current = pad(0, 0.525);
    expect(input.read().throttle).toBe(0);
    expect(input.read().throttle).toBe(-1);
  });
});
