import { afterEach, expect, it } from 'vitest';
import { remove, writeJson } from '../storage/store';
import { initialiseController, loadSettings, rememberControllerOption, saveSettings } from './settings';

afterEach(() => remove('settings'));

it('initialises common gamepad features once and DualSense features on its first connection', () => {
  remove('settings');
  const settings = loadSettings();
  expect(initialiseController(settings)).toBe(true);
  expect(settings).toMatchObject({ analogTriggers: true, vibrate: true });
  settings.analogTriggers = false;
  settings.vibrate = false;
  expect(initialiseController(settings, true)).toBe(true);
  expect(settings).toMatchObject({ analogTriggers: false, vibrate: false, engineHaptics: true, triggerResistance: 1 });
  settings.engineHaptics = false;
  settings.triggerResistance = 0;
  saveSettings(settings);
  const restored = loadSettings();
  expect(initialiseController(restored, true)).toBe(false);
  expect(restored).toMatchObject({ analogTriggers: false, vibrate: false, engineHaptics: false, triggerResistance: 0 });
});

it('preserves choices made before a controller first connects while enabling untouched features', () => {
  remove('settings');
  const settings = loadSettings();
  settings.engineHaptics = false;
  rememberControllerOption(settings, 'engineHaptics');
  saveSettings(settings);
  const restored = loadSettings();
  initialiseController(restored, true);
  expect(restored).toMatchObject({ analogTriggers: true, vibrate: true, engineHaptics: false, triggerResistance: 1 });
});

it('migrates existing controller choices without treating unrelated saved options as controller setup', () => {
  writeJson('settings', { music: true, vibrate: false });
  const old = loadSettings();
  initialiseController(old, true);
  expect(old).toMatchObject({ analogTriggers: true, vibrate: false, engineHaptics: true, triggerResistance: 1 });
  writeJson('settings', { analogTriggers: false, engineHaptics: false, triggerResistance: 0 });
  const configured = loadSettings();
  initialiseController(configured, true);
  expect(configured).toMatchObject({ analogTriggers: false, engineHaptics: false, triggerResistance: 0 });
});

it('discards unknown controller option markers and obsolete menu keypad settings', () => {
  writeJson('settings', { configuredControllerOptions: ['bad', 'analogTriggers'], keypadInMenu: true });
  const settings = loadSettings();
  expect(settings.configuredControllerOptions).toEqual(['analogTriggers']);
  expect(settings).not.toHaveProperty('keypadInMenu');
});

it('starts with music off and preserves a deliberate saved choice', () => {
  remove('settings');
  expect(loadSettings().music).toBe(false);
  writeJson('settings', { music: true });
  expect(loadSettings().music).toBe(true);
});

it('keeps independent audio levels across reloads and supports old saved settings', () => {
  writeJson('settings', { music: false });
  const settings = loadSettings();
  expect(settings.musicVolume).toBe(100);
  expect(settings.sfxVolume).toBe(100);
  settings.musicVolume = 30;
  settings.sfxVolume = 80;
  saveSettings(settings);
  expect(loadSettings()).toMatchObject({ music: false, musicVolume: 30, sfxVolume: 80 });
});

it('normalises invalid volume values without breaking the audio controls', () => {
  writeJson('settings', { musicVolume: -5, sfxVolume: 999 });
  expect(loadSettings()).toMatchObject({ musicVolume: 0, sfxVolume: 100 });
  writeJson('settings', { musicVolume: 'bad', sfxVolume: 33 });
  expect(loadSettings()).toMatchObject({ musicVolume: 100, sfxVolume: 30 });
});
