import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAnalyticsSender, trackEvent } from '../services/events';
import { cleanAnalyticsUrl, initialiseAnalytics, resolveAnalyticsId } from './google';

afterEach(() => {
  setAnalyticsSender(null);
  vi.unstubAllGlobals();
});

describe('game analytics', () => {
  it('removes replay payloads and query parameters from URLs', () => {
    expect(cleanAnalyticsUrl('https://example.com/game/?name=Alice#r=private')).toBe('https://example.com/game/');
    expect(cleanAnalyticsUrl('')).toBe('');
  });

  it('does not load tags in development', () => {
    initialiseAnalytics('G-EXAMPLE', false);
  });

  it('queues one startup and explicitly addressed events without a pageview', () => {
    const host = {} as Window;
    const append = vi.fn();
    vi.stubGlobal('window', host);
    vi.stubGlobal('location', {
      hostname: 'example.com',
      href: 'https://example.com/?secret=yes#r=payload',
      hash: '#r=payload',
    });
    vi.stubGlobal('document', { referrer: 'https://itch.io/?secret=yes', head: { append }, createElement: () => ({}) });
    vi.stubGlobal('__APP_VERSION__', 'test');
    initialiseAnalytics('G-EXAMPLE', true);
    initialiseAnalytics('G-EXAMPLE', true);
    trackEvent('game_pause', {});
    const queue = (host as Window & { wheelieDataLayer: ArrayLike<unknown>[] }).wheelieDataLayer.map((command) =>
      Array.from(command),
    );
    expect(append).toHaveBeenCalledOnce();
    expect(queue).toHaveLength(4);
    expect(queue[1]).toEqual([
      'config',
      'G-EXAMPLE',
      expect.objectContaining({ send_page_view: false, page_location: 'https://example.com/' }),
    ]);
    expect(queue[2]).toEqual([
      'event',
      'game_open',
      expect.objectContaining({ entry: 'replay', send_to: 'G-EXAMPLE' }),
    ]);
    expect(JSON.stringify(queue)).not.toContain('payload');
    expect(JSON.stringify(queue)).not.toContain('secret');
  });

  it('isolates failures of the analytics transport', () => {
    setAnalyticsSender(() => {
      throw new Error('blocked');
    });
    expect(() => trackEvent('game_resume', {})).not.toThrow();
  });
});

describe('analytics destination', () => {
  it('selects Pages for direct visits, including visits referred from itch', () => {
    expect(
      resolveAnalyticsId(
        'https://mihailpreis.github.io/Wheelie/?embed=1#r=private',
        'https://mprice.itch.io/wheelie',
        false,
        'G-FALLBACK',
      ),
    ).toBe('G-6SWYV1V5K3');
    expect(resolveAnalyticsId('https://mihailpreis.github.io/Wheelie', '', false)).toBe('G-6SWYV1V5K3');
    expect(resolveAnalyticsId('https://mihailpreis.github.io/Wheelie-other/', '', false)).toBeUndefined();
  });

  it('selects itch for its project page and cross-origin iframe even with an origin-only referrer', () => {
    expect(resolveAnalyticsId('https://mprice.itch.io/wheelie', '', false)).toBe('G-5XMH4C66VL');
    expect(
      resolveAnalyticsId('https://cdn.example.com/game/index.html', 'https://mprice.itch.io/', true, 'G-6SWYV1V5K3'),
    ).toBe('G-5XMH4C66VL');
    expect(resolveAnalyticsId('https://mihailpreis.github.io/Wheelie/', 'https://mprice.itch.io/wheelie', true)).toBe(
      'G-5XMH4C66VL',
    );
  });

  it('uses the itch CDN when the referrer is unavailable', () => {
    for (const host of ['html.itch.zone', 'html-classic.itch.zone', 'v6p9d9t4.ssl.hwcdn.net']) {
      expect(resolveAnalyticsId(`https://${host}/html/123/index.html`, '', true)).toBe('G-5XMH4C66VL');
    }
  });

  it('does not match lookalike hosts and leaves unknown deployments untracked unless configured', () => {
    expect(resolveAnalyticsId('https://mprice.itch.io.evil.com/wheelie', '', false)).toBeUndefined();
    expect(resolveAnalyticsId('https://other.example/game', 'https://mprice.itch.io.evil.com/', true)).toBeUndefined();
    expect(resolveAnalyticsId('https://other.example/game', '', false, 'G-CUSTOM')).toBe('G-CUSTOM');
  });

  it('keeps local play and explicit opt-out untracked', () => {
    expect(resolveAnalyticsId('http://localhost:4173', 'https://mprice.itch.io/', true, 'G-CUSTOM')).toBeUndefined();
    expect(resolveAnalyticsId('https://mihailpreis.github.io/Wheelie/', '', false, 'disabled')).toBeUndefined();
    expect(resolveAnalyticsId('https://mprice.itch.io/wheelie', '', false, '')).toBeUndefined();
  });
});
