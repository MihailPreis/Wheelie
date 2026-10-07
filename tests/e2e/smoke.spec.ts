import { expect, test } from '@playwright/test';

test('page loads and the game canvas fills the viewport', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await expect(page).toHaveTitle('Wheelie!');

  const canvas = page.locator('#game');
  await expect(canvas).toBeVisible();

  const viewport = page.viewportSize();
  const box = await canvas.boundingBox();
  expect(box?.width).toBe(viewport?.width);
  expect(box?.height).toBe(viewport?.height);
  expect(await canvas.evaluate((el: HTMLCanvasElement) => el.width)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('the track is drawn and the bike moves under throttle', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('#game');

  // Skip the opening screens, then Main → Play Menu → Start.
  await page.keyboard.press('Enter');
  await expect(page.locator('.menu-title')).toHaveText('Main', { timeout: 10_000 });
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page.locator('.menu')).toBeHidden();

  // Counts pixels of the track's near edge, which is pure green.
  const greenPixels = () =>
    canvas.evaluate((el: HTMLCanvasElement) => {
      const data = el.getContext('2d')?.getImageData(0, 0, el.width, el.height).data ?? [];
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] === 0 && data[i + 1] === 255 && data[i + 2] === 0) count++;
      }
      return count;
    });
  await expect.poll(greenPixels).toBeGreaterThan(100);

  // The progress bar fills from the left in its own shade of green as the bike advances.
  const progressPixels = () =>
    canvas.evaluate((el: HTMLCanvasElement) => {
      const data = el.getContext('2d')?.getImageData(0, 0, el.width, 1).data ?? [];
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] === 0x29 && data[i + 1] === 0xaa && data[i + 2] === 0x27) count++;
      }
      return count;
    });
  expect(await progressPixels()).toBe(0);
  await page.keyboard.down('ArrowUp');
  await expect.poll(progressPixels, { timeout: 10_000 }).toBeGreaterThan(20);
  await page.keyboard.up('ArrowUp');
});
