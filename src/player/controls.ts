import { TICK_MILLISECONDS } from '../core/sim';
import type { Game } from '../game/game';
import { formatTime } from '../render/hud';
import { STRINGS as S } from '../ui/strings';
import './controls.css';

export const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;
const clock = (ticks: number) => formatTime(Math.floor((ticks * TICK_MILLISECONDS) / 10));
const ticksFor = (seconds: number) => Math.round((seconds * 1000) / TICK_MILLISECONDS);
/** Milliseconds without input after which the bar gets out of the way of the picture. */
const HIDE_AFTER = 2500;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

/**
 * The bar under a replay: play and pause, a timeline to drag, the time, the speed. It drives the
 * playback the game is showing and has no state of its own beyond what is on screen.
 */
export class PlayerControls {
  readonly element = el('div', 'player');
  /** Called when the viewer leaves the replay. */
  onClose: (() => void) | null = null;

  private readonly toggleButton = el('button', 'player-button player-toggle');
  private readonly timeline = el('div', 'player-timeline');
  private readonly played = el('div', 'player-played');
  private readonly clock = el('span', 'player-clock');
  private readonly speedButton = el('button', 'player-button player-speed');
  private readonly closeButton = el('button', 'player-button', S.playerClose);
  private frame = 0;
  private lastInput = 0;
  private dragging = false;

  constructor(private readonly game: Game) {
    this.element.hidden = true;
    this.timeline.append(this.played);
    this.timeline.setAttribute('role', 'slider');
    this.timeline.setAttribute('aria-label', S.playerTimeline);
    this.timeline.tabIndex = 0;
    for (const button of [this.toggleButton, this.speedButton, this.closeButton]) button.type = 'button';
    this.element.append(this.toggleButton, this.timeline, this.clock, this.speedButton, this.closeButton);

    this.toggleButton.addEventListener('click', () => this.toggle());
    this.speedButton.addEventListener('click', () => this.changeSpeed(1, true));
    this.closeButton.addEventListener('click', () => this.onClose?.());

    const seekTo = (event: PointerEvent) => {
      const box = this.timeline.getBoundingClientRect();
      this.game.seek(((event.clientX - box.left) / box.width) * this.game.length);
    };
    this.timeline.addEventListener('pointerdown', (event) => {
      this.dragging = true;
      this.timeline.setPointerCapture(event.pointerId);
      seekTo(event);
    });
    this.timeline.addEventListener('pointermove', (event) => {
      if (this.dragging) seekTo(event);
    });
    const release = () => {
      this.dragging = false;
    };
    this.timeline.addEventListener('pointerup', release);
    this.timeline.addEventListener('pointercancel', release);
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  show(): void {
    this.element.hidden = false;
    this.wake();
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(this.update);
  }

  hide(): void {
    this.element.hidden = true;
    cancelAnimationFrame(this.frame);
  }

  /** Any input brings the bar back. */
  wake(): void {
    this.lastInput = performance.now();
    this.element.classList.remove('player-idle');
  }

  /** A tap on the picture: pause or resume. */
  tap(): void {
    this.wake();
    this.toggle();
  }

  private toggle(): void {
    // At the end, play means from the beginning.
    if (this.game.paused && this.game.position >= this.game.length) this.game.seek(0);
    this.game.paused = !this.game.paused;
  }

  private changeSpeed(step: number, wrap = false): void {
    const index = SPEEDS.indexOf(this.game.speed as (typeof SPEEDS)[number]);
    const next = index + step;
    const count = SPEEDS.length;
    this.game.speed = SPEEDS[wrap ? (next + count) % count : Math.max(0, Math.min(count - 1, next))] ?? 1;
  }

  private skip(seconds: number): void {
    this.game.seek(this.game.position + ticksFor(seconds));
  }

  /** Handles a key press. Returns true if the key was used. */
  key(event: KeyboardEvent): boolean {
    this.wake();
    const { game } = this;
    switch (event.key) {
      case ' ':
      case 'k':
      case 'K':
      case 'Enter':
        if (!event.repeat) this.toggle();
        return true;
      case 'ArrowLeft':
        this.skip(-5);
        return true;
      case 'ArrowRight':
        this.skip(5);
        return true;
      case 'j':
      case 'J':
        this.skip(-10);
        return true;
      case 'l':
      case 'L':
        this.skip(10);
        return true;
      // One tick back or forward, for looking at a moment closely.
      case ',':
        game.paused = true;
        game.seek(game.position - 1);
        return true;
      case '.':
        game.paused = true;
        game.seek(game.position + 1);
        return true;
      case '<':
      case 'ArrowDown':
        this.changeSpeed(-1);
        return true;
      case '>':
      case 'ArrowUp':
        this.changeSpeed(1);
        return true;
      case 'Escape':
      case 'Backspace':
        this.onClose?.();
        return true;
      default:
        if (/^[0-9]$/.test(event.key)) {
          game.seek((Number(event.key) / 10) * game.length);
          return true;
        }
        return false;
    }
  }

  /** The same actions from a gamepad. */
  pad(action: 'up' | 'down' | 'left' | 'right' | 'fire' | 'back' | 'pause'): void {
    this.wake();
    if (action === 'fire' || action === 'pause') this.toggle();
    else if (action === 'left') this.skip(-5);
    else if (action === 'right') this.skip(5);
    else if (action === 'up') this.changeSpeed(1);
    else if (action === 'down') this.changeSpeed(-1);
    else this.onClose?.();
  }

  private readonly update = (now: number): void => {
    const { game } = this;
    const length = Math.max(1, game.length);
    this.played.style.width = `${(game.position / length) * 100}%`;
    this.clock.textContent = `${clock(game.position)} / ${clock(game.length)}`;
    this.toggleButton.textContent = game.paused ? S.playerPlay : S.playerPause;
    this.speedButton.textContent = `${game.speed}x`;
    this.timeline.setAttribute('aria-valuenow', String(Math.round((game.position / length) * 100)));
    // While it plays untouched the bar fades; paused, it stays.
    this.element.classList.toggle('player-idle', !game.paused && !this.dragging && now - this.lastInput > HIDE_AFTER);
    this.frame = requestAnimationFrame(this.update);
  };
}
