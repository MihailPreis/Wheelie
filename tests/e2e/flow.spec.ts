import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';

// Walks the menus the way a player would. Runs against the dev server, which exposes a handle to
// end a run on demand: riding a track to the finish from a test would depend on real-time input.

const title = (page: Page) => page.locator('.menu-title');
const items = (page: Page) => page.locator('.menu-item .menu-label');
const texts = (page: Page) => page.locator('.menu-text');

/** Chooses a menu item by its label. */
async function pick(page: Page, label: string): Promise<void> {
  await page.locator('.menu-label', { hasText: label }).first().click();
}

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
  await expect(items(page)).toHaveText([
    'Play Menu',
    'Daily track',
    'Mods',
    'My runs',
    'Achievements',
    'Editor',
    'Options',
    'Help',
    'About',
  ]);

  await pick(page, 'Help');
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
  await pick(page, 'Options');
  await expect(title(page)).toHaveText('Options');
  const perspective = page.locator('.menu-item', { hasText: 'Perspective' }).locator('.menu-value');
  await expect(perspective).toHaveText('On');
  await press(page, 'Enter');
  await expect(perspective).toHaveText('Off');

  await page.reload();
  await page.keyboard.press('Enter');
  await expect(title(page)).toHaveText('Main', { timeout: 10_000 });
  await pick(page, 'Options');
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

  await pick(page, 'Mods');
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

  await pick(page, 'Mods');
  await pick(page, 'Installed mods');
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

  await press(page, 'Escape');
  await pick(page, 'My runs');
  await expect(title(page)).toHaveText('My runs');
  await expect(items(page)).toHaveCount(3);
  await expect(items(page).first()).toContainText('100cc');

  // It is still there after a reload, and can be deleted.
  await page.reload();
  await page.keyboard.press('Enter');
  await expect(title(page)).toHaveText('Main', { timeout: 10_000 });
  await pick(page, 'My runs');
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

  // Delete is the fourth action on the screen of a run.
  await press(page, 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter');
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
  await press(page, 'Escape');
  await pick(page, 'My runs');
  await expect(title(page)).toHaveText('My runs');

  // The run → Share → Copy link.
  await press(page, 'Enter', 'ArrowDown', 'ArrowDown', 'Enter');
  await expect(title(page)).toHaveText('Share');
  await press(page, 'Enter');
  await expect(texts(page).nth(1)).toContainText('Link copied');
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/#r=[dp][A-Za-z0-9_-]+$/);
  expect(link.length).toBeLessThan(400);

  // A short link: the replay and its result card go to the link service, its answer to the clipboard.
  let posted: { replay?: string; image?: string } = {};
  await page.route('https://links.test/api/links', async (route) => {
    posted = route.request().postDataJSON() as typeof posted;
    await route.fulfill({ json: { id: 'abcdefghij', url: 'https://links.test/r/abcdefghij' } });
  });
  await pick(page, 'Copy short link');
  await expect(texts(page).nth(1)).toHaveText('Copied: https://links.test/r/abcdefghij');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('https://links.test/r/abcdefghij');
  expect(
    Buffer.from(posted.replay ?? '', 'base64')
      .subarray(0, 3)
      .toString(),
  ).toBe('GDR');
  expect(
    Buffer.from(posted.image ?? '', 'base64')
      .subarray(1, 4)
      .toString(),
  ).toBe('PNG');

  // The same screen exports the run as a picture and as an animation.
  const save = async (label: RegExp, magic: string, extension: string) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.menu-label', { hasText: label }).first().click(),
    ]);
    expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${extension}$`));
    const bytes = readFileSync(await download.path());
    expect(bytes.subarray(0, magic.length).toString('latin1')).toBe(magic);
    return bytes;
  };
  const card = await save(/^Save image$/, '\x89PNG', 'png');
  expect([card.readUInt32BE(16), card.readUInt32BE(20)]).toEqual([1200, 630]);
  const gif = await save(/^Save GIF$/, 'GIF89a', 'gif');
  expect([gif.readUInt16LE(6), gif.readUInt16LE(8)]).toEqual([480, 270]);
  await expect(texts(page).nth(1)).toContainText('GIF saved');

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
  await pick(visitor, 'My runs');
  await expect(visitor.locator('.menu-item .menu-label')).toHaveCount(3);
  await other.close();
});

test('a track is made in the editor, test-driven and played as a pack', async ({ page }) => {
  const editor = page.locator('.editor');
  const canvas = page.locator('.editor-canvas');
  const click = (label: string | RegExp) => page.locator('.menu-label', { hasText: label }).first().click();
  const button = (label: string) => page.locator('.editor-button', { hasText: label });

  await click('Editor');
  await expect(title(page)).toHaveText('Editor');
  await click('New track');
  await expect(editor).toBeVisible();
  await expect(page.locator('.editor-name')).toHaveValue('My track 1');

  // Add a point, undo it, redo it.
  await expect(button('Undo')).toBeDisabled();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('The editor canvas is not laid out');
  await canvas.dblclick({ position: { x: box.width / 2 + 3, y: box.height / 2 + 60 } });
  await expect(button('Undo')).toBeEnabled();
  await expect(button('Delete')).toBeEnabled();
  await button('Undo').click();
  await expect(button('Redo')).toBeEnabled();
  await button('Redo').click();

  await page.locator('.editor-name').fill('Bumpy road');
  await page.keyboard.press('Enter');

  // A test drive runs the real game on the track and returns to the editor.
  await button('Test').click();
  await expect(editor).toBeHidden();
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(1500);
  await page.keyboard.up('ArrowUp');
  await page.keyboard.press('Escape');
  await expect(editor).toBeVisible();

  // The draft was saved as it was edited.
  await button('Done').click();
  await expect(items(page).nth(2)).toHaveText('Bumpy road');
  await page.reload();
  await page.keyboard.press('Enter');
  await expect(title(page)).toHaveText('Main', { timeout: 10_000 });
  await click('Editor');
  await click('Bumpy road');
  await expect(texts(page).nth(1)).toHaveText('14 points');
  await press(page, 'Escape');

  // The drafts download as a pack the original game reads…
  const [download] = await Promise.all([page.waitForEvent('download'), click('Save levels.mrg')]);
  expect(download.suggestedFilename()).toBe('levels.mrg');
  const pack = readFileSync(await download.path());
  expect(pack.readInt32BE(0)).toBe(1);
  expect(pack.subarray(8, 18).toString('latin1')).toBe('Bumpy_road');

  // …and can be played here as a pack of their own.
  await click('Play my tracks');
  await expect(title(page)).toHaveText('Play');
  await expect(page.locator('.menu-item', { hasText: 'Track' }).locator('.menu-value')).toHaveText('Bumpy road');
});

test('the fastest run on a track comes back as a ghost', async ({ page }) => {
  const click = (label: string | RegExp) => page.locator('.menu-label', { hasText: label }).first().click();
  const hasGhost = () =>
    page.evaluate(() => (window as unknown as { wheelie: { game: { ghost: unknown } } }).wheelie.game.ghost !== null);

  // The first run has nothing to race.
  await press(page, 'Enter', 'Enter');
  await expect(page.locator('.menu')).toBeHidden();
  expect(await hasGhost()).toBe(false);
  await page.keyboard.down('ArrowUp');
  await expect(title(page)).toHaveText('Finished!', { timeout: 20_000 });
  await page.keyboard.up('ArrowUp');
  await click(/^Ok$/);

  // The second one races the first.
  await click(/^Restart/);
  await expect(page.locator('.menu')).toBeHidden();
  expect(await hasGhost()).toBe(true);

  // With the option off there is no ghost…
  await press(page, 'Escape');
  await click('Options');
  await page.locator('.menu-item', { hasText: 'Ghost' }).click();
  await press(page, 'Escape');
  await click(/^Restart/);
  await expect(page.locator('.menu')).toBeHidden();
  expect(await hasGhost()).toBe(false);

  // …unless a run is picked to race against.
  await press(page, 'Escape');
  await click(/^Play Menu$/);
  await click('Go to Main');
  await click('My runs');
  await page.locator('.menu-label', { hasText: 'Intro' }).last().click();
  await click('Race this run');
  await expect(page.locator('.menu')).toBeHidden();
  expect(await hasGhost()).toBe(true);
});

test('the daily track is offered, ridden and remembered apart from the packs', async ({ page }) => {
  await pick(page, 'Daily track');
  await expect(items(page).first()).toHaveText('Start>', { timeout: 15_000 });
  await expect(texts(page).nth(4)).toContainText('not finished yet');
  const name = await texts(page).first().textContent();
  expect(name?.length).toBeGreaterThan(0);

  await pick(page, 'Start>');
  await expect(page.locator('.menu')).toBeHidden();
  await finishRun(page, 12_340);
  await expect(title(page)).toHaveText('Finished!');
  await expect(texts(page).first()).toHaveText('00:12.34');
  await expect(texts(page).nth(1)).toHaveText('Your best today!');
  await expect(texts(page).nth(2)).toContainText('1');

  // Back on its screen the result shows, and the original tracks are untouched by it.
  await pick(page, 'Daily track');
  await expect(texts(page).first()).toHaveText(name ?? '');
  await expect(texts(page).nth(4)).toContainText('00:12.34');
  await expect(texts(page).nth(5)).toContainText('1');
  await press(page, 'Escape');
  await pick(page, 'Play Menu');
  await expect(page.locator('.menu-item', { hasText: 'Track' }).locator('.menu-value')).toHaveText('Intro');
});

test('the language is switched in the options and remembered', async ({ page }) => {
  await pick(page, 'Options');
  const language = page.locator('.menu-item', { hasText: 'Language' });
  await expect(language.locator('.menu-value')).toHaveText('English');
  await language.click();
  await page.locator('.menu-item', { hasText: 'Русский' }).click();

  // The game starts over in Russian.
  await page.keyboard.press('Enter');
  await expect(title(page)).toHaveText('Главное меню', { timeout: 10_000 });
  await expect(items(page).first()).toHaveText('Игра');
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('ru');
  await pick(page, 'Настройки');
  await expect(page.locator('.menu-item', { hasText: 'Язык' }).locator('.menu-value')).toHaveText('Русский');
});

test('a browser set to Russian gets the game in Russian', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'ru-RU' });
  const page = await context.newPage();
  await page.goto('/');
  await page.keyboard.press('Enter');
  await expect(title(page)).toHaveText('Главное меню', { timeout: 10_000 });
  await context.close();
});

test('achievements are secret until earned, and are announced at the end of the run', async ({ page }) => {
  await pick(page, 'Achievements');
  await expect(texts(page).first()).toHaveText('0 of 17 earned.');
  await expect(page.locator('.menu-text', { hasText: '???' })).toHaveCount(17);
  await press(page, 'Escape');

  // Full throttle to the finish of the first track: no brakes were used.
  await pick(page, 'Play Menu');
  await pick(page, 'Start');
  await expect(page.locator('.menu')).toBeHidden();
  await page.keyboard.down('ArrowUp');
  await expect(title(page)).toHaveText('Finished!', { timeout: 20_000 });
  await page.keyboard.up('ArrowUp');
  await expect(page.locator('.toast')).toHaveText('Achievement: Who needs brakes');
  await pick(page, 'Ok');
  await expect(page.locator('.menu-text', { hasText: 'Achievement: Who needs brakes' })).toContainText(
    'Finish a track without braking.',
  );

  await pick(page, 'Play Menu');
  await pick(page, 'Go to Main');
  await pick(page, 'Achievements');
  await expect(texts(page).first()).toHaveText('1 of 17 earned.');
  await expect(page.locator('.menu-text', { hasText: '???' })).toHaveCount(16);
  await expect(page.locator('.menu-text', { hasText: 'Who needs brakes' })).toContainText(
    'Finish a track without braking.',
  );
});
