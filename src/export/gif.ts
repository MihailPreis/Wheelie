import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { TICK_MILLISECONDS } from '../core/sim';
import { GAME_FONT } from '../render/hud';
import type { Film } from './film';

export interface GifOptions {
  width: number;
  height: number;
  /** How many times faster than the run the animation plays. */
  speed: number;
  /** Line of text along the bottom edge. */
  caption: string;
  /**
   * A second film of the same run. Its finish is looked at when the colours are chosen, so that
   * what only shows up there — the finish flag, a broken bike — is not left without its colours.
   */
  paletteSample?: Film;
  /** The part of the run to show, in ticks; the whole run if left out. */
  from?: number;
  to?: number;
  onProgress?: (done: number) => void;
  signal?: AbortSignal;
}

/**
 * Milliseconds per frame. GIF delays are whole hundredths of a second and players do not honour
 * very short ones, so 25 frames a second is the smooth rate that plays the same everywhere.
 */
const FRAME_MILLISECONDS = 40;
/** How long the last frame is held, so the result can be read before the loop restarts. */
const LAST_FRAME_MILLISECONDS = 2000;
/** Frames rendered between yields to the browser. */
const BATCH = 8;

/** A speed that keeps the animation of a run of `duration` milliseconds around twenty seconds or less. */
export function gifSpeed(duration: number): number {
  return Math.max(2, Math.min(4, Math.ceil(duration / 20_000)));
}

/** Number of frames an animation of a run will have. */
export function gifFrameCount(duration: number, speed: number): number {
  return Math.max(1, Math.ceil(duration / speed / FRAME_MILLISECONDS)) + 1;
}

/**
 * Renders a run as an animated GIF. Frames are spaced evenly in time and drawn between simulation
 * ticks where they fall, so the motion is smooth at any speed rather than skipping ticks.
 */
export async function renderGif(film: Film, options: GifOptions): Promise<Blob> {
  const { width, height, speed, caption, signal } = options;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is not available');

  const scale = height / 270;
  const from = Math.max(0, options.from ?? 0);
  const to = Math.min(film.length, options.to ?? film.length);
  const frames = gifFrameCount((to - from) * TICK_MILLISECONDS, speed);
  /** What the animation shows so far, as palette indices. */
  let shown: Uint8Array | null = null;
  const ticksPerFrame = (FRAME_MILLISECONDS * speed) / TICK_MILLISECONDS;
  const encoder = GIFEncoder();
  let palette: number[][] | null = null;
  let sample: Uint8ClampedArray | null = null;
  if (options.paletteSample) {
    options.paletteSample.draw(ctx, width, height, scale, options.paletteSample.seekFinish());
    sample = ctx.getImageData(0, 0, width, height).data;
  }

  for (let frame = 0; frame < frames; frame++) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    film.draw(ctx, width, height, scale, Math.min(to, from + frame * ticksPerFrame));
    if (caption) {
      ctx.font = `${Math.round(13 * scale)}px ${GAME_FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#000';
      ctx.fillText(caption, 8 * scale, height - 8 * scale);
    }
    const pixels = ctx.getImageData(0, 0, width, height).data;
    // The game draws with a handful of colours, so one palette taken from the start and the end
    // of the run serves every frame, and no dithering is needed.
    if (!palette) {
      const both = new Uint8ClampedArray(pixels.length + (sample?.length ?? 0));
      both.set(pixels);
      if (sample) both.set(sample, pixels.length);
      palette = quantize(both, 255);
      // One more entry, never used as a colour: it stands for "same as the frame before".
      palette.push([0, 0, 0]);
    }
    const last = frame === frames - 1;
    const delay = last ? LAST_FRAME_MILLISECONDS : FRAME_MILLISECONDS;
    const index = applyPalette(pixels, palette);
    if (!shown) {
      encoder.writeFrame(index, width, height, { palette, delay, dispose: 1 });
      shown = index;
    } else {
      // Most of the picture is the same from frame to frame; long runs of "unchanged" pack well.
      const unchanged = palette.length - 1;
      const changes = new Uint8Array(index.length);
      for (let i = 0; i < index.length; i++) changes[i] = index[i] === shown[i] ? unchanged : (index[i] as number);
      encoder.writeFrame(changes, width, height, { delay, transparent: true, transparentIndex: unchanged, dispose: 1 });
      shown = index;
    }
    if (frame % BATCH === BATCH - 1) {
      options.onProgress?.((frame + 1) / frames);
      await new Promise((resolve) => setTimeout(resolve));
    }
  }
  encoder.finish();
  return new Blob([Uint8Array.from(encoder.bytes())], { type: 'image/gif' });
}
