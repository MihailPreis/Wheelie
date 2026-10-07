/**
 * Player input. Every device reduces to the same two axes the simulation takes: throttle
 * (1 accelerate, -1 brake) and lean (1 forward, -1 back). The simulation and replays never learn
 * which device was used.
 */

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
 * on-screen keypad presses the digits 1–9, so it follows the selected keyset too.
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

/** Keys that work regardless of the keyset, by `KeyboardEvent.code`. */
const DIRECT_KEYS: Readonly<Record<string, Contribution>> = {
  ArrowUp: ACCELERATE,
  ArrowDown: BRAKE,
  ArrowLeft: LEAN_BACK,
  ArrowRight: LEAN_FORWARD,
  KeyW: ACCELERATE,
  KeyS: BRAKE,
  KeyA: LEAN_BACK,
  KeyD: LEAN_FORWARD,
};

function digitOf(code: string): number | null {
  const match = /^(?:Digit|Numpad)(\d)$/.exec(code);
  return match ? Number(match[1]) : null;
}

// Standard gamepad mapping (https://w3c.github.io/gamepad/#remapping), shared by Xbox,
// DualShock and DualSense controllers.
const PAD = {
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

export class Input {
  /** 0–2: which of the original keysets the digit keys and the on-screen keypad use. */
  keyset = 0;
  /** The device that was used last; decides whether the on-screen keypad is shown. */
  device: InputDevice = 'keyboard';
  onDeviceChange: ((device: InputDevice) => void) | null = null;

  private readonly keys = new Set<string>();
  private readonly touchDigits = new Map<number, number>();
  private padActive = false;

  private use(device: InputDevice): void {
    if (this.device === device) return;
    this.device = device;
    this.onDeviceChange?.(device);
  }

  /** Returns true if the key is one of the riding controls. */
  keyDown(code: string): boolean {
    if (!(code in DIRECT_KEYS) && digitOf(code) === null) return false;
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
  }

  /** Digits currently held on the keypad, for highlighting. */
  get pressedDigits(): ReadonlySet<number> {
    return new Set(this.touchDigits.values());
  }

  /** Forgets everything held, for when the page loses focus. */
  release(): void {
    this.keys.clear();
    this.touchDigits.clear();
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
      add(digit === null ? DIRECT_KEYS[code] : keyset[digit]);
    }
    for (const digit of this.touchDigits.values()) add(keyset[digit]);

    const pad = this.readGamepads();
    throttle += pad.throttle;
    lean += pad.lean;
    return { throttle: Math.sign(throttle), lean: Math.sign(lean) };
  }

  private readGamepads(): Controls {
    let throttle = 0;
    let lean = 0;
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad?.connected) continue;
      const value = (index: number) => pad.buttons[index]?.value ?? 0;
      const pressed = (index: number) => pad.buttons[index]?.pressed ?? false;
      // Triggers and sticks are analogue; the game is not, so they act past a threshold.
      if (value(PAD.rightTrigger) > TRIGGER_THRESHOLD || pressed(PAD.faceBottom) || pressed(PAD.dpadUp)) throttle++;
      if (value(PAD.leftTrigger) > TRIGGER_THRESHOLD || pressed(PAD.faceLeft) || pressed(PAD.dpadDown)) throttle--;
      const stick = pad.axes[0] ?? 0;
      if (stick > STICK_DEAD_ZONE || pressed(PAD.dpadRight) || pressed(PAD.rightBumper)) lean++;
      if (stick < -STICK_DEAD_ZONE || pressed(PAD.dpadLeft) || pressed(PAD.leftBumper)) lean--;
    }
    const active = throttle !== 0 || lean !== 0;
    if (active && !this.padActive) this.use('gamepad');
    this.padActive = active;
    return { throttle, lean };
  }
}
