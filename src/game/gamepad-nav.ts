/** Menu navigation from a gamepad. Gamepads have no events, so this is polled once a frame. */

export type PadAction = 'up' | 'down' | 'left' | 'right' | 'fire' | 'back' | 'pause';

const STICK_THRESHOLD = 0.5;
const REPEAT_DELAY = 350;
const REPEAT_INTERVAL = 120;

// Standard mapping: 0 bottom face button, 1 right face button, 9 start, 12–15 d-pad.
const BUTTONS: readonly (readonly [number, PadAction])[] = [
  [0, 'fire'],
  [1, 'back'],
  [9, 'pause'],
  [12, 'up'],
  [13, 'down'],
  [14, 'left'],
  [15, 'right'],
];
const REPEATING = new Set<PadAction>(['up', 'down', 'left', 'right']);

export class GamepadNavigator {
  /** When each held action fires next. */
  private readonly held = new Map<PadAction, number>();

  /** Returns the actions that fire on this frame. */
  poll(now: number): PadAction[] {
    const down = new Set<PadAction>();
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad?.connected) continue;
      for (const [index, action] of BUTTONS) {
        if (pad.buttons[index]?.pressed) down.add(action);
      }
      const x = pad.axes[0] ?? 0;
      const y = pad.axes[1] ?? 0;
      if (y < -STICK_THRESHOLD) down.add('up');
      if (y > STICK_THRESHOLD) down.add('down');
      if (x < -STICK_THRESHOLD) down.add('left');
      if (x > STICK_THRESHOLD) down.add('right');
    }

    const fired: PadAction[] = [];
    for (const action of down) {
      const next = this.held.get(action);
      if (next === undefined) {
        fired.push(action);
        this.held.set(action, now + REPEAT_DELAY);
      } else if (REPEATING.has(action) && now >= next) {
        fired.push(action);
        this.held.set(action, now + REPEAT_INTERVAL);
      }
    }
    for (const action of [...this.held.keys()]) {
      if (!down.has(action)) this.held.delete(action);
    }
    return fired;
  }
}
