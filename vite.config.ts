import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths: the same build runs under a GitHub Pages subpath and inside the itch.io iframe.
  base: './',
  build: {
    target: 'es2022',
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
