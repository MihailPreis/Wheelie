import { describe, expect, it } from 'vitest';
import { defaultBindings, Input, parseBindings, rebind } from './input';

describe('Input', () => {
  it('combines dedicated touch buttons independently of the digit keyset', () => {
    const input = new Input();
    for (const keyset of [0, 1, 2]) {
      input.keyset = keyset;
      input.touchAction(1, 'accelerate');
      input.touchAction(2, 'leanForward');
      expect(input.read()).toEqual({ throttle: 1, lean: 1 });
      input.touchAction(2, null);
      expect(input.read()).toEqual({ throttle: 1, lean: 0 });
      input.release();
      expect(input.read()).toEqual({ throttle: 0, lean: 0 });
    }
  });
  it('maps arrows and WASD', () => {
    const input = new Input();
    input.keyDown('ArrowUp');
    input.keyDown('KeyD');
    expect(input.read()).toEqual({ throttle: 1, lean: 1 });
    input.keyUp('ArrowUp');
    input.keyDown('KeyS');
    expect(input.read()).toEqual({ throttle: -1, lean: 1 });
  });

  it('cancels opposite keys and never exceeds one', () => {
    const input = new Input();
    input.keyDown('ArrowUp');
    input.keyDown('ArrowDown');
    input.keyDown('ArrowLeft');
    input.keyDown('KeyA');
    expect(input.read()).toEqual({ throttle: 0, lean: -1 });
  });

  it('follows the original keysets for digits', () => {
    const input = new Input();
    input.keyDown('Digit1');
    expect(input.read()).toEqual({ throttle: 1, lean: -1 });
    input.keyset = 1;
    expect(input.read()).toEqual({ throttle: 1, lean: 0 });
    input.keyset = 2;
    expect(input.read()).toEqual({ throttle: 0, lean: 0 });
    input.keyUp('Digit1');
    input.keyDown('Numpad6');
    expect(input.read()).toEqual({ throttle: -1, lean: 0 });
  });

  it('ignores keys that are not controls', () => {
    const input = new Input();
    expect(input.keyDown('KeyQ')).toBe(false);
    expect(input.keyDown('ArrowUp')).toBe(true);
  });

  it('tracks fingers on the keypad separately', () => {
    const input = new Input();
    input.touch(1, 2);
    input.touch(2, 6);
    expect(input.read()).toEqual({ throttle: 1, lean: 1 });
    input.touch(2, 4);
    expect(input.read()).toEqual({ throttle: 1, lean: -1 });
    input.touchEnd(1);
    expect(input.read()).toEqual({ throttle: 0, lean: -1 });
    expect([...input.pressedDigits]).toEqual([4]);
  });

  it('reports the device used last', () => {
    const input = new Input();
    const seen: string[] = [];
    input.onDeviceChange = (device) => seen.push(device);
    input.touch(1, 5);
    input.keyDown('ArrowUp');
    input.keyDown('ArrowDown');
    expect(seen).toEqual(['touch', 'keyboard']);
  });

  it('releases everything on demand', () => {
    const input = new Input();
    input.keyDown('ArrowUp');
    input.touch(1, 3);
    input.release();
    expect(input.read()).toEqual({ throttle: 0, lean: 0 });
  });

  it('rides with rebound keys and leaves the rest alone', () => {
    const input = new Input();
    const bindings = defaultBindings();
    rebind(bindings, 'keys', 'accelerate', 'Space');
    // A key given to another action leaves the one it had.
    rebind(bindings, 'keys', 'brake', 'KeyA');
    input.bindings = bindings;
    expect(input.keyDown('ArrowUp')).toBe(false);
    input.keyDown('Space');
    expect(input.read()).toEqual({ throttle: 1, lean: 0 });
    input.keyDown('KeyA');
    expect(input.read()).toEqual({ throttle: 0, lean: 0 });
    expect(bindings.keys.leanBack).toEqual(['ArrowLeft']);
  });

  it('falls back to the defaults for stored bindings that make no sense', () => {
    expect(parseBindings(null)).toEqual(defaultBindings());
    const parsed = parseBindings({ keys: { accelerate: ['KeyQ'], brake: 'x' }, buttons: { brake: [99] } });
    expect(parsed.keys.accelerate).toEqual(['KeyQ']);
    expect(parsed.keys.brake).toEqual(defaultBindings().keys.brake);
    expect(parsed.buttons.brake).toEqual(defaultBindings().buttons.brake);
  });
});
