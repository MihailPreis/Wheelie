import { STRINGS as S } from './strings';
import './fullscreen.css';

const SVG = 'http://www.w3.org/2000/svg';
/** Corner marks pointing outwards (enter) and inwards (leave), on a 20-unit square. */
const ENTER = 'M3 8V3h5M12 3h5v5M17 12v5h-5M8 17H3v-5';
const LEAVE = 'M8 3v5H3M12 3v5h5M17 12h-5v5M8 17v-5H3';

/** Whether the page can go full screen at all; an iPhone, for one, cannot. */
export const fullscreenAvailable = () => document.fullscreenEnabled === true;

export function toggleFullscreen(): void {
  if (!fullscreenAvailable()) return;
  // Refused requests (no user gesture, a frame without permission) leave things as they are.
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  else void document.documentElement.requestFullscreen().catch(() => undefined);
}

/** A button in the corner that takes the game full screen and back. */
export function createFullscreenButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'fullscreen-button';
  const icon = document.createElementNS(SVG, 'svg');
  icon.setAttribute('viewBox', '0 0 20 20');
  const path = document.createElementNS(SVG, 'path');
  icon.append(path);
  button.append(icon);
  const update = () => {
    const on = document.fullscreenElement !== null;
    path.setAttribute('d', on ? LEAVE : ENTER);
    button.setAttribute('aria-label', on ? S.fullscreenLeave : S.fullscreenEnter);
    button.title = on ? S.fullscreenLeave : S.fullscreenEnter;
  };
  update();
  document.addEventListener('fullscreenchange', update);
  button.addEventListener('click', toggleFullscreen);
  button.hidden = !fullscreenAvailable();
  return button;
}
