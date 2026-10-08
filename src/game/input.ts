/**
 * Player input. Every device reduces to the same two axes the simulation takes: throttle
 * (1 accelerate, -1 brake) and lean (1 forward, -1 back). The simulation and replays never learn
 * which device was used.
 */

import { type ControllerPad, gamepads } from './gamepads';

export interface Controls {
  throttle: number;
  lean: number;
}

export type InputDevice = 'keyboard' | 'gamepad' | 'touch';

type Contribution = readonly [throttle: number, lean: number];

const ACCELERATE: Contribution = [1, 0];
const BRAKE: Contribution = [-1, 0];
const LEAN_BACK: Contribution = [0, -1];
const LEAN_FORWARD: Contribution = [0, 1];

/**
 * What the digits 0–9 do in each of the original's three keysets (`GameView.m_maaaB`). The
 * digit keys follow the selected keyset. Dedicated touch buttons use semantic actions instead.
 */
export const KEYSETS: readonly (readonly Contribution[])[] = [
  [
    [0, 0],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, -1],
    [-1, 0],
    [0, 1],
    [-1, -1],
    [-1, 0],
    [-1, 1],
  ],
  [
    [0, 0],
    [1, 0],
    [0, 0],
    [0, 0],
    [-1, 0],
    [0, -1],
    [0, 1],
    [0, 0],
    [0, 0],
    [0, 0],
  ],
  [
    [0, 0],
    [0, 0],
    [0, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, 0],
    [0, 0],
    [0, 0],
    [0, 0],
  ],
];

export const ACTIONS = ['accelerate', 'brake', 'leanBack', 'leanForward'] as const;
export type Action = (typeof ACTIONS)[number];

const CONTRIBUTIONS: Readonly<Record<Action, Contribution>> = {
  accelerate: ACCELERATE,
  brake: BRAKE,
  leanBack: LEAN_BACK,
  leanForward: LEAN_FORWARD,
};

/**
 * Which keys (by `KeyboardEvent.code`) and which gamepad buttons (by their index in the standard
 * mapping) ride the bike. The digit keys follow the keyset instead and are not listed here.
 */
export interface Bindings {
  keys: Record<Action, string[]>;
  buttons: Record<Action, number[]>;
}

export function defaultBindings(): Bindings {
  return {
    keys: {
      accelerate: ['ArrowUp', 'KeyW'],
      brake: ['ArrowDown', 'KeyS'],
      leanBack: ['ArrowLeft', 'KeyA'],
      leanForward: ['ArrowRight', 'KeyD'],
    },
    buttons: {
      accelerate: [PAD.rightTrigger, PAD.faceBottom, PAD.dpadUp],
      brake: [PAD.leftTrigger, PAD.faceLeft, PAD.dpadDown],
      leanBack: [PAD.dpadLeft, PAD.leftBumper],
      leanForward: [PAD.dpadRight, PAD.rightBumper],
    },
  };
}

/** Reads stored bindings, falling back to the defaults for anything that does not make sense. */
export function parseBindings(stored: unknown): Bindings {
  const bindings = defaultBindings();
  const source = stored as Partial<Bindings> | null;
  if (typeof source !== 'object' || source === null) return bindings;
  for (const action of ACTIONS) {
    const keys = source.keys?.[action];
    if (Array.isArray(keys) && keys.length <= 4 && keys.every((key) => typeof key === 'string' && key.length < 32)) {
      bindings.keys[action] = [...keys];
    }
    const buttons = source.buttons?.[action];
    if (
      Array.isArray(buttons) &&
      buttons.length <= 4 &&
      buttons.every((button) => Number.isInteger(button) && button >= 0 && button < 32)
    ) {
      bindings.buttons[action] = [...buttons];
    }
  }
  return bindings;
}

/** Gives a key or a button to one action alone, taking it away from whichever had it. */
export function rebind(bindings: Bindings, device: 'keys' | 'buttons', action: Action, input: string | number): void {
  for (const other of ACTIONS) {
    const list = bindings[device][other] as (string | number)[];
    bindings[device][other] = list.filter((bound) => bound !== input) as never;
  }
  bindings[device][action] = [input] as never;
}

function digitOf(code: string): number | null {
  const match = /^(?:Digit|Numpad)(\d)$/.exec(code);
  return match ? Number(match[1]) : null;
}

// Standard gamepad mapping (https://w3c.github.io/gamepad/#remapping), shared by Xbox,
// DualShock and DualSense controllers.
export const PAD = {
  faceBottom: 0,
  faceLeft: 2,
  leftBumper: 4,
  rightBumper: 5,
  leftTrigger: 6,
  rightTrigger: 7,
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
} as const;
const TRIGGER_THRESHOLD = 0.3;
const STICK_DEAD_ZONE = 0.35;

const buttonDown = (pad: ControllerPad, index: number) =>
  (pad.buttons[index]?.pressed ?? false) || (pad.buttons[index]?.value ?? 0) > TRIGGER_THRESHOLD;

/** The lowest-numbered button held on any gamepad, or null. */
export function heldButton(): number | null {
  const pads = gamepads();
  for (const pad of pads) {
    if (!pad?.connected) continue;
    const index = pad.buttons.findIndex((_, button) => buttonDown(pad, button));
    if (index >= 0) return index;
  }
  return null;
}

/** Whether the gamepad in use names its buttons the PlayStation way. */
export function isPlayStationPad(): boolean {
  const pads = gamepads();
  return [...pads].some(
    (pad) => pad?.connected && /dualsense|dualshock|playstation|054c|wireless controller/i.test(pad.id),
  );
}

export class Input {
  /** 0–2: which of the original keysets the digit keys use. */
  keyset = 0;
  analogTriggers = false;
  /** Continuous gas demand for engine audio, before quantisation into replay ticks. */
  throttlePressure = 0;
  private throttleRemainder = 0;
  private throttleDirection = 0;
  private bound = defaultBindings();
  private keyActions = new Map<string, Contribution>();

  constructor() {
    this.bindings = this.bound;
  }

  get bindings(): Bindings {
    return this.bound;
  }

  set bindings(bindings: Bindings) {
    this.bound = bindings;
    this.keyActions = new Map();
    for (const action of ACTIONS) {
      for (const key of bindings.keys[action]) this.keyActions.set(key, CONTRIBUTIONS[action]);
    }
  }
  /** The device that was used last; decides whether the on-screen keypad is shown. */
  device: InputDevice = 'keyboard';
  onDeviceChange: ((device: InputDevice) => void) | null = null;

  private readonly keys = new Set<string>();
  private readonly touchDigits = new Map<number, number>();
  private readonly touchActions = new Map<number, Action>();
  private padActive = false;

  private use(device: InputDevice): void {
    if (this.device === device) return;
    this.device = device;
    this.onDeviceChange?.(device);
  }

  /** Returns true if the key is one of the riding controls. */
  keyDown(code: string): boolean {
    if (!this.keyActions.has(code) && digitOf(code) === null) return false;
    this.keys.add(code);
    this.use('keyboard');
    return true;
  }

  keyUp(code: string): void {
    this.keys.delete(code);
  }

  /** A finger went down on, or slid onto, a keypad button (1–9); `null` when it is on none. */
  touch(pointerId: number, digit: number | null): void {
    if (digit === null) this.touchDigits.delete(pointerId);
    else this.touchDigits.set(pointerId, digit);
    this.use('touch');
  }

  touchEnd(pointerId: number): void {
    this.touchDigits.delete(pointerId);
    this.touchActions.delete(pointerId);
  }

  /** Semantic touch buttons are independent of the digit keyset. */
  touchAction(pointerId: number, action: Action | null): void {
    if (action === null) this.touchActions.delete(pointerId);
    else this.touchActions.set(pointerId, action);
    this.use('touch');
  }

  get pressedTouchActions(): ReadonlySet<Action> {
    return new Set(this.touchActions.values());
  }

  /** Digits currently held on the keypad, for highlighting. */
  get pressedDigits(): ReadonlySet<number> {
    return new Set(this.touchDigits.values());
  }

  /** Forgets everything held, for when the page loses focus. */
  release(): void {
    this.keys.clear();
    this.touchDigits.clear();
    this.touchActions.clear();
    this.throttleRemainder = 0;
    this.throttleDirection = 0;
    this.throttlePressure = 0;
  }

  gamepadConnected(): void {
    if (gamepads().some((pad) => pad.connected)) this.use('gamepad');
  }

  /** Reads the controls for the coming tick. Gamepads have no events, so they are polled here. */
  read(): Controls {
    let throttle = 0;
    let lean = 0;
    const add = (contribution: Contribution | undefined) => {
      if (!contribution) return;
      throttle += contribution[0];
      lean += contribution[1];
    };

    const keyset = KEYSETS[this.keyset] ?? (KEYSETS[0] as readonly Contribution[]);
    for (const code of this.keys) {
      const digit = digitOf(code);
      // A digit given an action of its own no longer follows the keyset.
      add(this.keyActions.get(code) ?? (digit === null ? undefined : keyset[digit]));
    }
    for (const digit of this.touchDigits.values()) add(keyset[digit]);
    for (const action of this.touchActions.values()) add(CONTRIBUTIONS[action]);

    const pad = this.readGamepads();
    throttle += pad.throttle;
    lean += pad.lean;
    this.throttlePressure = Math.max(0, Math.min(1, throttle));
    if (!this.analogTriggers) return { throttle: Math.sign(throttle), lean: Math.sign(lean) };
    // Pulse density gives proportional drive without changing integer physics or replay inputs.
    const direction = Math.sign(throttle);
    if (direction !== this.throttleDirection) this.throttleRemainder = 0;
    this.throttleDirection = direction;
    this.throttleRemainder += Math.min(1, Math.abs(throttle));
    const pulse = this.throttleRemainder >= 1 - 1e-9;
    if (pulse) this.throttleRemainder = Math.max(0, this.throttleRemainder - 1);
    return { throttle: pulse ? direction : 0, lean: Math.sign(lean) };
  }

  private readGamepads(): Controls {
    let throttle = 0;
    let lean = 0;
    const pads = gamepads();
    for (const pad of pads) {
      if (!pad?.connected) continue;
      // Triggers and sticks are analogue; the game is not, so they act past a threshold.
      const held = (action: Action) => this.bound.buttons[action].some((index) => buttonDown(pad, index));
      const pressure = (action: Action) =>
        Math.max(
          0,
          ...this.bound.buttons[action].map((index) => {
            if (!this.analogTriggers || (index !== PAD.leftTrigger && index !== PAD.rightTrigger))
              return buttonDown(pad, index) ? 1 : 0;
            const value = pad.buttons[index]?.value ?? 0;
            return Number.isFinite(value) ? Math.max(0, Math.min(1, (value - 0.05) / 0.95)) : 0;
          }),
        );
      throttle += pressure('accelerate') - pressure('brake');
      const stick = pad.axes[0] ?? 0;
      if (stick > STICK_DEAD_ZONE || held('leanForward')) lean++;
      if (stick < -STICK_DEAD_ZONE || held('leanBack')) lean--;
    }
    const active = throttle !== 0 || lean !== 0;
    if (active && !this.padActive) this.use('gamepad');
    this.padActive = active;
    return { throttle, lean };
  }
}
