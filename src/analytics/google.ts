import { setAnalyticsSender, trackEvent } from '../services/events';

export function cleanAnalyticsUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '';
  }
}

const PAGES_ID = 'G-6SWYV1V5K3';
const ITCH_ID = 'G-5XMH4C66VL';

/** Cross-origin iframe referrers may contain only the parent origin. */
export function resolveAnalyticsId(
  address: string,
  referrer: string,
  embedded: boolean,
  fallback?: string,
): string | undefined {
  if (fallback === '' || fallback === 'disabled') return undefined;
  const parse = (value: string): URL | null => {
    try {
      return new URL(value);
    } catch {
      return null;
    }
  };
  const url = parse(address);
  if (!url || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return undefined;
  const parent = embedded ? parse(referrer) : null;
  if (parent?.origin === 'https://mprice.itch.io') return ITCH_ID;
  if (url.origin === 'https://mprice.itch.io' && /^\/wheelie(?:\/|$)/.test(url.pathname)) return ITCH_ID;
  // The same Wheelie archive is served by itch's CDN, including when referrers are suppressed.
  if (
    url.protocol === 'https:' &&
    ['html.itch.zone', 'html-classic.itch.zone', 'v6p9d9t4.ssl.hwcdn.net'].includes(url.hostname)
  )
    return ITCH_ID;
  if (url.origin === 'https://mihailpreis.github.io' && /^\/Wheelie(?:\/|$)/.test(url.pathname)) return PAGES_ID;
  return fallback;
}

/** A separate queue keeps the game's tracker independent from a host page's tags. */
export function initialiseAnalytics(id: string | undefined, production: boolean): void {
  if (!production) return;
  id = resolveAnalyticsId(location.href, document.referrer, window.top !== window, id);
  if (!id || !/^G-[A-Z0-9]+$/.test(id)) return;
  const host = window as Window & { wheelieDataLayer?: unknown[] };
  if (host.wheelieDataLayer) return;
  const queue: unknown[] = [];
  host.wheelieDataLayer = queue;
  function tag(..._args: unknown[]): void {
    // biome-ignore lint/complexity/noArguments: Google tag commands use the gtag arguments queue.
    queue.push(arguments);
  }
  const context = {
    page_location: cleanAnalyticsUrl(location.href),
    page_referrer: cleanAnalyticsUrl(document.referrer),
    page_title: 'Wheelie!',
    app_version: __APP_VERSION__,
    telemetry_source: 'game',
  };
  tag('js', new Date());
  tag('config', id, {
    ...context,
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  setAnalyticsSender((name, parameters) => tag('event', name, { ...context, ...parameters, send_to: id }));
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${id}&l=wheelieDataLayer`;
  document.head.append(script);
  trackEvent('game_open', {
    entry: location.hash.startsWith('#r=') ? 'replay' : location.hash.startsWith('#t=') ? 'track' : 'menu',
    embedded: window.top !== window,
  });
}
