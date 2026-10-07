import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Link previews (Telegram, iMessage, Discord) need absolute addresses, which a build with relative
 * paths does not know. They come from the same variable as the replay share links.
 */
function siteUrl(): Plugin {
  const configured = process.env.VITE_SHARE_BASE_URL?.trim() ?? '';
  const url = configured && !configured.endsWith('/') ? `${configured}/` : configured;
  return {
    name: 'site-url',
    transformIndexHtml: (html) =>
      url
        ? html.replaceAll('%SITE_URL%', url)
        : html.replace(/^.*property="og:url".*\n/m, '').replaceAll('%SITE_URL%', ''),
  };
}

/**
 * Not downloaded up front: sprite sets the game does not load, and the level pack catalogue, which is
 * fetched (and then kept) only when the player opens it.
 */
const NOT_CACHED = /^assets\/sprites\/(1x|1\.5x|2x)\/|^assets\/mods\/|^sw\.js$/;

/** Writes `sw.js` with the list of built files, so the game starts and plays without a network. */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    async closeBundle() {
      const entries = await readdir(outDir, { recursive: true, withFileTypes: true });
      const files = entries
        .filter((entry) => entry.isFile())
        .map((entry) => relative(outDir, join(entry.parentPath, entry.name)).split(sep).join('/'))
        .filter((file) => !NOT_CACHED.test(file))
        .sort();
      const hash = createHash('sha256');
      for (const file of files) hash.update(file).update(await readFile(join(outDir, file)));
      const urls = files.map((file) => (file === 'index.html' ? './' : file));
      const template = await readFile(new URL('./tools/service-worker.js', import.meta.url), 'utf8');
      await writeFile(
        join(outDir, 'sw.js'),
        template.replace('__VERSION__', hash.digest('hex').slice(0, 12)).replace('__FILES__', JSON.stringify(urls)),
      );
    },
  };
}

export default defineConfig({
  plugins: [siteUrl(), serviceWorker()],
  // Relative asset paths: the same build runs under a GitHub Pages subpath and inside the itch.io iframe.
  base: './',
  build: {
    target: 'es2022',
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
