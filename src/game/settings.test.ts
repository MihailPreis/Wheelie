import { afterEach, expect, it } from 'vitest';
import { remove, writeJson } from '../storage/store';
import { loadSettings, saveSettings } from './settings';

afterEach(() => remove('settings'));

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
