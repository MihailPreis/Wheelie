export const APP_NAME = 'Wheelie!';
export const APP_TAGLINE = 'An unofficial fan-made web port of Gravity Defied';

interface PageLocation {
  origin: string;
  pathname: string;
}

/**
 * Base address for replay share links, always ending with a slash-free path the fragment can follow.
 *
 * The itch.io build runs in an iframe on a foreign origin, so links must point at the configured
 * address rather than at the page the game happens to be running on.
 */
export function resolveShareBaseUrl(configured: string | undefined, location: PageLocation): string {
  const trimmed = configured?.trim();
  if (trimmed) return trimmed;
  return location.origin + location.pathname;
}
