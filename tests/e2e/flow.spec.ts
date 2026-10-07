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
  await expect(items(page)).toHaveText(['Play Menu', 'Mods', 'My runs', 'Options', 'Help', 'About']);

  await press(page, 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter');
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
  await press(page, 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter');
  await expect(title(page)).toHaveText('Options');
  const perspective = page.locator('.menu-item', { hasText: 'Perspective' }).locator('.menu-value');
  await expect(perspective).toHaveText('On');
  await press(page, 'Enter');
  await expect(perspective).toHaveText('Off');

  await page.reload();
  await page.keyboard.press('Enter');
  await expect(title(page)).toHaveText('Main', { timeout: 10_000 });
  await press(page, 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter');
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

test('a level pack is installed from the catalogue, played and deleted', async ({ page }) => {
  const activePack = () => page.evaluate(() => localStorage.getItem('wheelie.activePack'));

  await press(page, 'ArrowDown', 'Enter');
  await expect(title(page)).toHaveText('Mods');
  await press(page, 'Enter');
  await expect(items(page).first()).toContainText('Sort by', { timeout: 10_000 });
  expect(await items(page).count()).toBeGreaterThan(50);

  // The first pack of the list.
  await press(page, 'ArrowDown', 'Enter');
  await expect(items(page).first()).toContainText('Install (');
  await press(page, 'Enter');
  await expect(texts(page).first()).toHaveText('Levels successfully installed.', { timeout: 10_000 });
  await press(page, 'Enter');
  await expect(items(page).first()).toHaveText('Open installed');
  await press(page, 'Enter');
  await expect(items(page).first()).toHaveText('Play these levels');
  await press(page, 'Enter');
  await expect(title(page)).toHaveText('Play');
  expect(await activePack()).toMatch(/^"gdtr-\d+"$/);

  // The choice and the pack itself survive a reload.
  await page.reload();
  await page.keyboard.press('Enter');
  await expect(title(page)).toHaveText('Main', { timeout: 10_000 });
  expect(await activePack()).toMatch(/^"gdtr-\d+"$/);

  await press(page, 'ArrowDown', 'Enter', 'ArrowDown', 'Enter');
  await expect(title(page)).toHaveText('Installed mods');
  await expect(items(page).nth(1)).toContainText('active');
  await press(page, 'ArrowDown', 'Enter');
  await expect(items(page).first()).toHaveText('Delete');
  await press(page, 'Enter', 'ArrowDown', 'Enter');
  await expect(title(page)).toHaveText('Play');
  expect(await activePack()).toBe('"original"');
});

test('a run is recorded and listed under My runs', async ({ page }) => {
  // Ride for real: the recording is made of the inputs the simulation was given.
  await press(page, 'Enter', 'Enter');
  await expect(page.locator('.menu')).toBeHidden();
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(4000);
  await page.keyboard.up('ArrowUp');
  await press(page, 'Escape');
  await expect(title(page)).toHaveText('Ingame');
  await press(page, 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter');
  await expect(title(page)).toHaveText('Play');

  await press(page, 'Escape', 'ArrowDown', 'ArrowDown', 'Enter');
  await expect(title(page)).toHaveText('My runs');
  await expect(items(page)).toHaveCount(3);
  await expect(items(page).first()).toContainText('100cc');

  // It is still there after a reload, and can be deleted.
  await page.reload();
  await page.keyboard.press('Enter');
  await expect(title(page)).toHaveText('Main', { timeout: 10_000 });
  await press(page, 'ArrowDown', 'ArrowDown', 'Enter');
  await expect(items(page)).toHaveCount(3);
  await press(page, 'Enter');
  await expect(texts(page).nth(1)).toContainText('Result');

  // Watch it: the replay plays, can be paused, sought and left.
  const position = () =>
    page.evaluate(() => (window as unknown as { wheelie: { game: { position: number } } }).wheelie.game.position);
  await press(page, 'Enter');
  await expect(page.locator('.player')).toBeVisible();
  await expect.poll(position).toBeGreaterThan(30);
  await press(page, 'Space');
  await expect(page.locator('.player-toggle')).toHaveText('Play');
  const paused = await position();
  await page.waitForTimeout(200);
  expect(await position()).toBe(paused);
  await press(page, '5');
  const middle = await position();
  expect(middle).toBeGreaterThan(100);
  await press(page, ',');
  expect(await position()).toBe(middle - 1);
  await press(page, '0');
  expect(await position()).toBe(0);
  // Played to the end at four times the speed, it stops there.
  await press(page, 'ArrowUp', 'ArrowUp', 'Space');
  await expect(page.locator('.player-speed')).toHaveText('4x');
  await expect(page.locator('.player-toggle')).toHaveText('Pause');
  await expect(page.locator('.player-toggle')).toHaveText('Play', { timeout: 10_000 });
  expect(await position()).toBeGreaterThan(middle);
  await press(page, 'Escape');
  await expect(page.locator('.player')).toBeHidden();
  await expect(texts(page).nth(1)).toContainText('Result');

  // Delete is the third action on the screen of a run.
  await press(page, 'ArrowDown', 'ArrowDown', 'Enter');
  await expect(texts(page).first()).toContainText('No runs yet');
});

test('a run shared as a link opens as a replay in a fresh browser', async ({ page, context, browser }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await press(page, 'Enter', 'Enter');
  await expect(page.locator('.menu')).toBeHidden();
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(4000);
  await page.keyboard.up('ArrowUp');
  await press(page, 'Escape', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter');
  await press(page, 'Escape', 'ArrowDown', 'ArrowDown', 'Enter');
  await expect(title(page)).toHaveText('My runs');

  // The run → Share → Copy link.
  await press(page, 'Enter', 'ArrowDown', 'Enter');
  await expect(title(page)).toHaveText('Share');
  await press(page, 'Enter');
  await expect(texts(page).nth(1)).toContainText('Link copied');
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/#r=[dp][A-Za-z0-9_-]+$/);
  expect(link.length).toBeLessThan(400);

  // Someone else opens it: no splash to sit through, no menu, the replay itself.
  const other = await browser.newContext();
  const visitor = await other.newPage();
  await visitor.goto(link);
  await expect(visitor.locator('.player')).toBeVisible({ timeout: 10_000 });
  const length = () =>
    visitor.evaluate(() => (window as unknown as { wheelie: { game: { length: number } } }).wheelie.game.length);
  expect(await length()).toBeGreaterThan(200);
  expect(new URL(visitor.url()).hash).toBe('');

  // Leaving the replay leads to the menu, and the run is now among the visitor's own.
  await visitor.keyboard.press('Escape');
  await expect(visitor.locator('.menu-title')).toHaveText('Main');
  await visitor.keyboard.press('ArrowDown');
  await visitor.keyboard.press('ArrowDown');
  await visitor.keyboard.press('Enter');
  await expect(visitor.locator('.menu-item .menu-label')).toHaveCount(3);
  await other.close();
});
