import { describe, expect, it } from 'vitest';
import { resolveShareBaseUrl } from './config';

const page = { origin: 'http://localhost:5173', pathname: '/' };

describe('resolveShareBaseUrl', () => {
  it('uses the configured address when set', () => {
    expect(resolveShareBaseUrl('https://example.github.io/Wheelie/', page)).toBe('https://example.github.io/Wheelie/');
  });

  it('falls back to the current page when unset or blank', () => {
    expect(resolveShareBaseUrl(undefined, page)).toBe('http://localhost:5173/');
    expect(resolveShareBaseUrl('  ', page)).toBe('http://localhost:5173/');
  });

  it('keeps the subpath of the current page', () => {
    expect(resolveShareBaseUrl('', { origin: 'https://example.github.io', pathname: '/Wheelie/' })).toBe(
      'https://example.github.io/Wheelie/',
    );
  });
});
