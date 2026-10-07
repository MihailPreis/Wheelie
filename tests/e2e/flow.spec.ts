import { expect, type Page, test } from '@playwright/test';

// Walks the menus the way a player would. Runs against the dev server, which exposes a handle to
// end a run on demand: riding a track to the finish from a test would depend on real-time input.

const title = (page: Page) => page.locator('.menu-title');
const items = (page: Page) => page.locator('.menu-item .menu-label');
const texts = (page: Page) => page.locator('.menu-text');

async function press(page: Page, ...keys: string[]): Promise<void> {
  for (const key of keys) await page.keyboard.press(key);
}

async function finishRun(page: Page, milliseconds: number): Promise<void> {
  await page.evaluate((time) => {
    const { game } = (window as unknown as { wheelie: { game: { onFinish: (r: object) => void } } }).wheelie;
    game.onFinish({ time, wheelie: false });
  }, milliseconds);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // Any key skips the opening screens once loading is done.
  await page.keyboard.press('Enter');
  await expect(title(page)).toHaveText('Main', { timeout: 10_000 });
});

test('main menu leads to every section and back', async ({ page }) => {
  await expect(items(page)).toHaveText(['Play Menu', 'Options', 'Help', 'About']);

  await press(page, 'ArrowDown', 'ArrowDown', 'Enter');
  await expect(title(page)).toHaveText('Help');
  await press(page, 'ArrowDown', 'Enter');
  await expect(title(page)).toHaveText('Keys');
  await expect(texts(page).first()).toContainText('Keyset 1');
  await press(page, 'Escape', 'Escape');
  await expect(title(page)).toHaveText('Main');

  await press(page, 'ArrowDown', 'Enter');
  await expect(title(page)).toHaveText('About');
  await expect(texts(page).first()).toContainText('not affiliated');
});

test('options are toggled and remembered', async ({ page }) => {
  await press(page, 'ArrowDown', 'Enter');
  await expect(title(page)).toHaveText('Options');
  const perspective = page.locator('.menu-item', { hasText: 'Perspective' }).locator('.menu-value');
  await expect(perspective).toHaveText('On');
  await press(page, 'Enter');
  await expect(perspective).toHaveText('Off');

  await page.reload();
  await page.keyboard.press('Enter');
  await expect(title(page)).toHaveText('Main', { timeout: 10_000 });
  await press(page, 'ArrowDown', 'Enter');
  await expect(perspective).toHaveText('Off');
});

test('locked tracks cannot be started', async ({ page }) => {
  await press(page, 'Enter');
  await expect(title(page)).toHaveText('Play');
  const track = page.locator('.menu-item', { hasText: 'Track' });
  await press(page, 'ArrowDown', 'ArrowDown', 'ArrowRight');
  await expect(track.locator('.menu-lock')).toBeVisible();
  await press(page, 'ArrowUp', 'ArrowUp', 'Enter');
  await expect(texts(page).first()).toContainText('Complete more tracks');
  await press(page, 'Enter');
  await expect(title(page)).toHaveText('Play');
});

test('a finished run records a score, unlocks the next track and offers it', async ({ page }) => {
  await press(page, 'Enter', 'Enter');
  await expect(page.locator('.menu')).toBeHidden();

  // Pausing and resuming.
  await press(page, 'Escape');
  await expect(title(page)).toHaveText('Ingame');
  await expect(items(page).first()).toHaveText('Continue');
  await press(page, 'Enter');
  await expect(page.locator('.menu')).toBeHidden();

  await finishRun(page, 12_340);
  await expect(title(page)).toHaveText('Finished!');
  await expect(texts(page).first()).toContainText('First place!');
  await expect(texts(page).nth(1)).toHaveText('00:12.34');

  // Enter a name, typing over the default.
  await press(page, 'ArrowDown', 'Enter');
  await expect(title(page)).toHaveText('Enter Name');
  await page.keyboard.type('mik');
  await press(page, 'Enter');
  await expect(items(page).nth(1)).toHaveText('Name - MIK');

  // Back from the name screen the highlight is on Ok again.
  await press(page, 'Enter');
  await expect(texts(page)).toContainText(['Time: 00:12.34', '1. MIK 00:12.34', '1 of 10 tracks in Easy completed.']);
  const next = items(page).first();
  await expect(next).toContainText('Next: ');
  await next.click();
  await expect(page.locator('.menu')).toBeHidden();

  // A slower run on the first track takes second place and needs no name screen change.
  await press(page, 'Escape', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter');
  await expect(title(page)).toHaveText('Play');
  const track = page.locator('.menu-item', { hasText: 'Track' });
  await expect(track.locator('.menu-lock')).toHaveCount(0);
  await press(page, 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowDown', 'ArrowDown', 'Enter');
  await expect(title(page)).toHaveText('High Scores');
  await expect(texts(page)).toContainText(['1. MIK 00:12.34']);
});
