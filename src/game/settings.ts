import { readJson, writeJson } from '../storage/store';

/** The options of the original game, plus the ones the web version adds. */
export interface Settings {
  perspective: boolean;
  shadows: boolean;
  driverSprite: boolean;
  bikeSprite: boolean;
  /** 0–2: which keyset the digit keys and the on-screen keypad use. */
  keyset: number;
  lookAhead: boolean;
  /** 0 the display's resolution, 1 and 2 the classic 240 and 176 pixel screens. */
  screen: number;
  vibrate: boolean;
  /** Keep the on-screen keypad visible in the menus. */
  keypadInMenu: boolean;
  /** Race against the fastest run of one's own on the track. */
  ghost: boolean;
  music: boolean;
  /** Engine and effects. */
  sound: boolean;
  /** Three characters, A–Z or space, entered for the high score tables. */
  name: string;
}

export const DEFAULT_NAME = 'AAA';

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  perspective: true,
  shadows: true,
  driverSprite: true,
  bikeSprite: true,
  keyset: 0,
  lookAhead: true,
  screen: 0,
  vibrate: true,
  keypadInMenu: true,
  ghost: true,
  music: true,
  sound: true,
  name: DEFAULT_NAME,
};

const KEY = 'settings';

/** Three characters from A–Z and space, upper case; anything else becomes the default. */
export function normalizeName(name: unknown): string {
  if (typeof name !== 'string') return DEFAULT_NAME;
  const upper = name.toUpperCase();
  return /^[A-Z ]{3}$/.test(upper) ? upper : DEFAULT_NAME;
}

export function loadSettings(): Settings {
  const stored = readJson<Partial<Settings>>(KEY) ?? {};
  const settings: Settings = { ...DEFAULT_SETTINGS };
  for (const key of [
    'perspective',
    'shadows',
    'driverSprite',
    'bikeSprite',
    'lookAhead',
    'vibrate',
    'keypadInMenu',
    'ghost',
    'music',
    'sound',
  ] as const) {
    if (typeof stored[key] === 'boolean') settings[key] = stored[key];
  }
  if (stored.keyset === 0 || stored.keyset === 1 || stored.keyset === 2) settings.keyset = stored.keyset;
  if (stored.screen === 1 || stored.screen === 2) settings.screen = stored.screen;
  settings.name = normalizeName(stored.name);
  return settings;
}

export function saveSettings(settings: Settings): void {
  writeJson(KEY, settings);
}
