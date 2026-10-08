import { STRINGS as S } from '../ui/strings';

/** Names of keys and gamepad buttons, for showing the controls to the player. */

const [UP, DOWN, LEFT, RIGHT] = S.directions;
const KEY_NAMES: Readonly<Record<string, string>> = {
  ArrowUp: UP ?? '',
  ArrowDown: DOWN ?? '',
  ArrowLeft: LEFT ?? '',
  ArrowRight: RIGHT ?? '',
  Space: 'Space',
  Enter: 'Enter',
  ShiftLeft: 'Left Shift',
  ShiftRight: 'Right Shift',
  ControlLeft: 'Left Ctrl',
  ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt',
  AltRight: 'Right Alt',
};

/** A key by its `KeyboardEvent.code`, as the keyboard labels it. */
export function keyName(code: string): string {
  const named = KEY_NAMES[code];
  if (named) return named;
  const match = /^(?:Key|Digit)(.)$/.exec(code) ?? /^Numpad(.+)$/.exec(code);
  if (match?.[1]) return code.startsWith('Numpad') ? `Num ${match[1]}` : match[1];
  return code;
}

// The standard mapping, in the words each family of controllers prints on its buttons.
const DPAD = S.directions.map((direction) => S.dpad(direction));
const XBOX = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', ...DPAD];
const PLAYSTATION = [
  'Cross',
  'Circle',
  'Square',
  'Triangle',
  'L1',
  'R1',
  'L2',
  'R2',
  'Create',
  'Options',
  'L3',
  'R3',
  ...DPAD,
];

/** A gamepad button by its index in the standard mapping. */
export function buttonName(index: number, playStation: boolean): string {
  return (playStation ? PLAYSTATION : XBOX)[index] ?? `Button ${index}`;
}
