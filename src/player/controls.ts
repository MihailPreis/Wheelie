import { TICK_MILLISECONDS } from '../core/sim';
import { inputLean, inputThrottle } from '../formats/replay';
import type { Game } from '../game/game';
import { formatTime } from '../render/hud';
import { readJson, writeJson } from '../storage/store';
import { controlIcon } from '../ui/control-icons';
import { STRINGS as S } from '../ui/strings';
import './controls.css';

export const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;
const ticksFor = (seconds: number) => Math.round((seconds * 1000) / TICK_MILLISECONDS);
/** Milliseconds without input after which the bar gets out of the way of the picture. */
const HIDE_AFTER = 2500;
const KEYS_SHOWN_KEY = 'playerKeys';

/** A moment of a replay worth pointing out on the timeline. */
export interface TimelineMark {
  tick: number;
  kind: 'crash' | 'finish' | 'flip';
}

/** What the bar offers besides playback itself. */
export interface PlayerOptions {
  marks: readonly TimelineMark[];
  /** Starts the track with the replay as the ghost; null if that cannot be done. */
  race: (() => void) | null;
  /** Address of the full game, when the replay is shown on somebody else's page. */
  embedded: string | null;
}

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
  private readonly keysButton = el('button', 'player-button', S.playerKeys);
  private readonly raceButton = el('button', 'player-button', S.playerRace);
  private readonly siteLink = el('a', 'player-button', S.playerOpenGame);
  /** The four controls of the bike, lit while they are held in the replay. */
  private readonly keys = el('div', 'player-keys');
  private readonly keyLights = ['up', 'left', 'right', 'down'].map((name) =>
    el('span', `player-key player-key-${name}`),
  );
  private readonly marks = el('div', 'player-marks');
  private race: (() => void) | null = null;
  private embedded = false;
  private frame = 0;
  private lastInput = 0;
  private dragging = false;

  constructor(private readonly game: Game) {
    this.element.hidden = true;
    this.element.addEventListener('pointerdown', () => this.wake());
    this.element.addEventListener('focusin', () => this.wake());
    this.timeline.append(this.played, this.marks);
    for (const indexes of [
      [1, 2],
      [0, 3],
    ]) {
      const group = el('div', 'player-key-group');
      for (const index of indexes) group.append(this.keyLights[index] as HTMLElement);
      this.keys.append(group);
    }
    const actions = ['accelerate', 'leanBack', 'leanForward', 'brake'] as const;
    const labels = [S.actions[0], S.actions[2], S.actions[3], S.actions[1]];
    this.keyLights.forEach((light, index) => {
      light.append(controlIcon(actions[index] as (typeof actions)[number]));
      light.setAttribute('aria-label', labels[index] ?? '');
      light.setAttribute('role', 'img');
    });
    this.keys.hidden = readJson<unknown>(KEYS_SHOWN_KEY) !== true;
    this.siteLink.target = '_blank';
    this.siteLink.rel = 'noopener';
    this.timeline.setAttribute('role', 'slider');
    this.timeline.setAttribute('aria-label', S.playerTimeline);
    this.timeline.tabIndex = 0;
    const buttons = [this.toggleButton, this.speedButton, this.keysButton, this.raceButton, this.closeButton];
    for (const button of buttons) button.type = 'button';
    this.element.append(
      this.keys,
      this.toggleButton,
      this.timeline,
      this.clock,
      this.speedButton,
      this.keysButton,
      this.raceButton,
      this.siteLink,
      this.closeButton,
    );
    this.keysButton.addEventListener('click', () => this.toggleKeys());
    this.raceButton.addEventListener('click', () => this.race?.());

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

  show(options: PlayerOptions): void {
    const length = Math.max(1, this.game.length);
    this.marks.replaceChildren(
      ...options.marks.map((mark) => {
        const node = el('span', `player-mark player-mark-${mark.kind}`);
        node.style.left = `${(Math.min(mark.tick, length) / length) * 100}%`;
        return node;
      }),
    );
    this.race = options.race;
    this.embedded = options.embedded !== null;
    this.raceButton.hidden = !options.race;
    this.closeButton.hidden = this.embedded;
    this.siteLink.hidden = !this.embedded;
    this.siteLink.href = options.embedded ?? '';
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

  private toggleKeys(): void {
    this.keys.hidden = !this.keys.hidden;
    writeJson(KEYS_SHOWN_KEY, !this.keys.hidden);
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
      case 'i':
      case 'I':
        if (!event.repeat) this.toggleKeys();
        return true;
      case 'r':
      case 'R':
        if (!event.repeat) this.race?.();
        return true;
      case 'Escape':
      case 'Backspace':
        if (!this.embedded) this.onClose?.();
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
    else if (!this.embedded) this.onClose?.();
  }

  private readonly update = (now: number): void => {
    const { game } = this;
    const length = Math.max(1, game.length);
    this.played.style.width = `${(game.position / length) * 100}%`;
    this.clock.textContent = formatTime(Math.floor(game.raceTime / 10));
    this.toggleButton.textContent = game.paused ? S.playerPlay : S.playerPause;
    this.speedButton.textContent = `${game.speed}x`;
    if (!this.keys.hidden) {
      const code = game.playbackInput;
      const throttle = code === null ? 0 : inputThrottle(code);
      const lean = code === null ? 0 : inputLean(code);
      const held = [throttle > 0, lean < 0, lean > 0, throttle < 0];
      this.keyLights.forEach((light, index) => {
        light.classList.toggle('held', held[index] === true);
      });
    }
    this.timeline.setAttribute('aria-valuenow', String(Math.round((game.position / length) * 100)));
    // While it plays untouched the bar fades; paused, it stays.
    this.element.classList.toggle(
      'player-idle',
      !game.paused &&
        !this.dragging &&
        !this.element.contains(document.activeElement) &&
        now - this.lastInput > HIDE_AFTER,
    );
    this.frame = requestAnimationFrame(this.update);
  };
}
