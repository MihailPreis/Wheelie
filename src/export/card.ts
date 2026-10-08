import { GAME_FONT } from '../render/hud';
import type { Film } from './film';
import type { QrCode } from './qr';

/** What a result card says about a run. */
export interface CardInfo {
  /** The result as text: a time, or how the run ended. */
  result: string;
  track: string;
  /** Level and league, e.g. "Easy - 100cc". */
  category: string;
  /** Pack and its author. */
  pack: string;
  player: string;
  date: string;
  wheelie: boolean;
  /** Address of the game, printed small. */
  site: string;
  /** Set for a run on the daily track: the day, as text. */
  daily: string | null;
  /** A code leading to the replay or to the game, drawn in a corner of the picture. */
  qr: QrCode | null;
}

export const CARD_SIZES = {
  wide: [1200, 630],
  square: [1080, 1080],
} as const;
export type CardSize = keyof typeof CARD_SIZES;

/** Shortens text with an ellipsis until it fits `width`. */
function shorten(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/**
 * A picture of a run to post somewhere: the moment at the finish line (or where the run ended)
 * above a panel with the result. Laid out with the game's own font and colours.
 */
export function drawCard(film: Film, logo: CanvasImageSource, info: CardInfo, size: CardSize): HTMLCanvasElement {
  const [width, height] = CARD_SIZES[size];
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');

  const unit = width / 1200;
  const panel = Math.round((size === 'wide' ? 210 : 330) * unit);
  const sceneHeight = height - panel;

  // The scene, as large as on a phone held sideways.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, sceneHeight);
  ctx.clip();
  film.draw(ctx, width, sceneHeight, sceneHeight / 300, film.seekFinish(), false);
  ctx.restore();

  if (info.qr) {
    // No finer than three pixels a module, or cameras stop reading it off a screen.
    const quiet = 3;
    const module = Math.max(3, Math.floor((230 * unit) / (info.qr.size + quiet * 2)));
    const side = (info.qr.size + quiet * 2) * module;
    const left = width - side - Math.round(24 * unit);
    const upper = Math.round(24 * unit);
    ctx.fillStyle = '#fff';
    ctx.fillRect(left, upper, side, side);
    ctx.fillStyle = '#000';
    for (let y = 0; y < info.qr.size; y++) {
      for (let x = 0; x < info.qr.size; x++) {
        if (info.qr.modules[y * info.qr.size + x]) {
          ctx.fillRect(left + (x + quiet) * module, upper + (y + quiet) * module, module, module);
        }
      }
    }
  }

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, sceneHeight, width, panel);
  ctx.fillStyle = '#29aa27';
  ctx.fillRect(0, sceneHeight, width, Math.round(6 * unit));

  const margin = 48 * unit;
  const top = sceneHeight + 6 * unit;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#000';

  // Left: the result, large, and the track under it.
  ctx.textAlign = 'left';
  ctx.font = `${Math.round(96 * unit)}px ${GAME_FONT}`;
  ctx.fillText(info.result, margin, top + 100 * unit);
  const resultWidth = ctx.measureText(info.result).width;
  if (info.wheelie) {
    ctx.fillStyle = '#29aa27';
    ctx.font = `${Math.round(40 * unit)}px ${GAME_FONT}`;
    ctx.fillText('Wheelie!', margin + resultWidth + 24 * unit, top + 100 * unit);
    ctx.fillStyle = '#000';
  }
  const column = size === 'wide' ? width * 0.62 - margin : width - margin * 2;
  ctx.font = `${Math.round(40 * unit)}px ${GAME_FONT}`;
  ctx.fillText(shorten(ctx, info.track, column), margin, top + 156 * unit);
  ctx.fillStyle = '#666';
  ctx.font = `${Math.round(26 * unit)}px ${GAME_FONT}`;
  const details = `${info.category} - ${info.pack}`;
  if (info.daily) {
    const label = `Daily track ${info.daily} - `;
    ctx.fillStyle = '#29aa27';
    ctx.fillText(label, margin, top + 192 * unit);
    const used = ctx.measureText(label).width;
    ctx.fillStyle = '#666';
    ctx.fillText(shorten(ctx, details, column - used), margin + used, top + 192 * unit);
  } else {
    ctx.fillText(shorten(ctx, details, column), margin, top + 192 * unit);
  }

  // Right (or below, on the square card): who, when, and where to play.
  const logoWidth = 250 * unit;
  const logoHeight = (logoWidth * 170) / 446;
  if (size === 'wide') {
    ctx.drawImage(logo, width - margin - logoWidth, top + 22 * unit, logoWidth, logoHeight);
    ctx.textAlign = 'right';
    ctx.fillText(shorten(ctx, `${info.player} - ${info.date}`, width * 0.36), width - margin, top + 156 * unit);
    ctx.fillText(shorten(ctx, info.site, width * 0.36), width - margin, top + 192 * unit);
  } else {
    ctx.fillText(shorten(ctx, `${info.player} - ${info.date}`, column), margin, top + 228 * unit);
    ctx.drawImage(logo, margin, top + 244 * unit, logoWidth * 0.7, logoHeight * 0.7);
    ctx.textAlign = 'right';
    ctx.fillText(shorten(ctx, info.site, width * 0.6), width - margin, top + 300 * unit);
  }
  return canvas;
}

export function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The picture could not be encoded'))),
      'image/png',
    );
  });
}
