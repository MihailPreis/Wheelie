import type { Viewport } from './scene';

/** The heads-up display: progress bar, race clock and the centred message (`GameView.drawGame`). */

export const GAME_FONT = '"Roboto Condensed", "Arial Narrow", sans-serif';

/** Formats centiseconds the way the original does: `m:ss:cc`. */
export function formatTime(centiseconds: number): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const minutes = Math.floor(centiseconds / 6000);
  return `${minutes}:${pad(Math.floor(centiseconds / 100) % 60)}:${pad(centiseconds % 100)}`;
}

export interface HudState {
  /** Progress along the track, 0…1. */
  progress: number;
  /** Race time in milliseconds, or `null` to hide the clock. */
  time: number | null;
  message: string | null;
}

export function drawHud(ctx: CanvasRenderingContext2D, viewport: Viewport, hud: HudState): void {
  ctx.fillStyle = '#c4c4c4';
  ctx.fillRect(0, 0, viewport.width, 3);
  ctx.fillStyle = '#29aa27';
  ctx.fillRect(0, 0, Math.round(viewport.width * Math.min(Math.max(hud.progress, 0), 1)), 3);

  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';
  if (hud.time !== null) {
    ctx.font = `18px ${GAME_FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText(formatTime(Math.floor(hud.time / 10)), 18, 36);
  }
  if (hud.message) {
    ctx.font = `20px ${GAME_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(hud.message, viewport.width / 2, Math.floor((viewport.height - viewport.lift * 2) / 5));
  }
}
