/** Common inputs from the browser and an authorised DualSense HID connection. */
export type ControllerPad = Pick<Gamepad, 'id' | 'connected' | 'buttons' | 'axes'>;
let enhanced: (() => ControllerPad | null) | null = null;

export function setEnhancedGamepadSource(source: (() => ControllerPad | null) | null): void {
  enhanced = source;
}

export function gamepads(): ControllerPad[] {
  const standard = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  const direct = enhanced?.() ?? null;
  const pads = [...standard].filter((pad): pad is Gamepad => Boolean(pad?.connected));
  if (!direct) return pads;
  // Opening WebHID can change Bluetooth report mode. Prefer its input and avoid counting it twice.
  return [...pads.filter((pad) => !/dualsense|054c|wireless controller/i.test(pad.id)), direct];
}
