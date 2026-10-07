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
