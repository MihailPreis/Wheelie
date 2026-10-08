import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeDualSenseInput } from './dualsense-input';
import { GamepadNavigator } from './gamepad-nav';
import { gamepads, setEnhancedGamepadSource } from './gamepads';
import { Input } from './input';

afterEach(() => {
  setEnhancedGamepadSource(null);
  vi.unstubAllGlobals();
});

describe('DualSense input reports', () => {
  it.each([
    [1, 9, 0, 4, 7],
    [1, 63, 0, 7, 4],
    [0x31, 77, 1, 8, 5],
  ])('preserves standard controls in report %i with %i bytes', (id, length, offset, face, trigger) => {
    const bytes = new Uint8Array(length);
    bytes.fill(128, offset, offset + 4);
    bytes[face] = 0x22;
    bytes[face + 1] = 0x20;
    bytes[trigger + 1] = 255;
    const pad = decodeDualSenseInput(id, new DataView(bytes.buffer));
    expect(pad?.axes).toEqual([0, 0, 0, 0]);
    expect(pad?.buttons[0]?.pressed).toBe(true);
    expect(pad?.buttons[9]?.pressed).toBe(true);
    expect(pad?.buttons[15]?.pressed).toBe(true);
    expect(pad?.buttons[7]?.value).toBe(1);
    expect(pad?.buttons[6]?.value).toBe(0);
  });

  it('ignores unrelated and truncated reports', () => {
    expect(decodeDualSenseInput(0x32, new DataView(new ArrayBuffer(77)))).toBeNull();
    expect(decodeDualSenseInput(0x31, new DataView(new ArrayBuffer(9)))).toBeNull();
  });

  it('drives the game and menu without Gamepad API and avoids duplicate native input', () => {
    const bytes = new Uint8Array([128, 128, 128, 128, 0x28, 0, 0, 0, 255]);
    const pad = decodeDualSenseInput(1, new DataView(bytes.buffer));
    vi.stubGlobal('navigator', {});
    setEnhancedGamepadSource(() => pad);
    expect(new Input().read().throttle).toBe(1);
    expect(new GamepadNavigator().poll(0)).toContain('fire');
    vi.stubGlobal('navigator', { getGamepads: () => [pad] });
    expect(gamepads()).toHaveLength(1);
    setEnhancedGamepadSource(() => null);
    vi.stubGlobal('navigator', { getGamepads: () => [] });
    expect(new Input().read().throttle).toBe(0);
  });
});
