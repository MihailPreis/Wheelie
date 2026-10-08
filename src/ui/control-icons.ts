import type { Action } from '../game/input';

/** Shared pictograms for riding controls and the replay input display. */
export function controlIcon(action: Action): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('control-icon');
  const shapes: Record<Action, string> = {
    accelerate: '<path d="M10 6l16 10-16 10z" fill="currentColor" stroke="none"/>',
    brake: '<path d="M8 8h16v16H8z" fill="currentColor" stroke="none"/>',
    leanBack: '<path d="M25 16H7m9-9-9 9 9 9"/>',
    leanForward: '<path d="M7 16h18m-9-9 9 9-9 9"/>',
  };
  svg.innerHTML = shapes[action];
  return svg;
}
