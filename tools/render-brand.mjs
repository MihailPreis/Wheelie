// Renders the raster brand images (link preview, touch icon) from the SVG sources in public/.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const data = async (path, type) => `data:${type};base64,${(await readFile(root + path)).toString('base64')}`;
const wordmark = await data('assets/brand/wordmark.svg', 'image/svg+xml');
const badge = await data('favicon.svg', 'image/svg+xml');
const font = await data('assets/fonts/RobotoCondensed-Regular.ttf', 'font/ttf');

const preview = `<style>
  @font-face { font-family: game; src: url(${font}); }
  body { margin: 0; width: 1200px; height: 630px; background: #fff; display: flex; flex-direction: column;
    align-items: center; justify-content: center; font-family: game; }
  img { width: 760px; }
  p { margin: 28px 0 0; font-size: 40px; color: #555; }
  div { position: absolute; left: 0; top: 0; width: 100%; height: 12px; background: #29aa27; }
</style><div></div><img src="${wordmark}"><p>An unofficial fan-made web port of Gravity Defied</p>`;
const iconPage = (padding) =>
  `<style>body { margin: 0; background: #fff; } img { display: block; width: 100vw; padding: ${padding}vw; box-sizing: border-box; }</style><img src="${badge}">`;
const icon = iconPage(8);

const browser = await chromium.launch();
const shoot = async (html, width, height, path) => {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: root + path });
  await page.close();
};
await shoot(preview, 1200, 630, 'assets/brand/preview.png');
await shoot(icon, 180, 180, 'apple-touch-icon.png');
await shoot(icon, 192, 192, 'assets/brand/icon-192.png');
await shoot(icon, 512, 512, 'assets/brand/icon-512.png');
// Launchers crop maskable icons to a circle that covers the middle 80%.
await shoot(iconPage(18), 512, 512, 'assets/brand/icon-maskable-512.png');
await browser.close();
