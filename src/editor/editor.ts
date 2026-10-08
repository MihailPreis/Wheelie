import type { PadAction } from '../game/gamepad-nav';
import { GAME_FONT } from '../render/hud';
import { STRINGS as S } from '../ui/strings';
import {
  cloneTrack,
  type EditorTrack,
  groundY,
  insertPoint,
  MAX_POINTS,
  movePoint,
  NAME_LENGTH,
  removePoint,
  settle,
} from './model';
import './editor.css';

type Handle = { kind: 'point'; index: number } | { kind: 'start' } | { kind: 'finish' };

/** How close, in CSS pixels, a pointer has to be to grab something. */
const GRAB = 16;
const UNDO_LIMIT = 200;
/** Wheel radius and half the wheelbase of the bike, in track units, for the start marker. */
const WHEEL = 7;
const HALF_BIKE = 14;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

/**
 * The track editor: the ground as a line of points that can be dragged, added and removed, the
 * start and the finish as two markers. It edits one track and reports every change.
 */
export class Editor {
  readonly element = el('div', 'editor');
  /** Called after every change, with the track as it now is. */
  onChange: ((track: EditorTrack) => void) | null = null;
  onTest: ((track: EditorTrack) => void) | null = null;
  onClose: (() => void) | null = null;

  private readonly canvas = el('canvas', 'editor-canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly nameInput = el('input', 'editor-name');
  private readonly status = el('div', 'editor-status');
  private readonly buttons: Record<'add' | 'remove' | 'undo' | 'redo', HTMLButtonElement>;

  private track: EditorTrack | null = null;
  private selected: Handle | null = null;
  private adding = false;
  private undoStack: EditorTrack[] = [];
  private redoStack: EditorTrack[] = [];

  // The view: the track point at the centre of the canvas, and CSS pixels per track unit.
  private centerX = 0;
  private centerY = 0;
  private zoom = 1;

  private readonly pointers = new Map<number, { x: number; y: number }>();
  private dragging: Handle | 'view' | null = null;
  /** The track before the drag in progress, to undo to. */
  private beforeDrag: EditorTrack | null = null;
  private moved = false;
  private pinch = 0;

  constructor() {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.element.hidden = true;

    const bar = el('div', 'editor-bar');
    this.nameInput.maxLength = NAME_LENGTH;
    this.nameInput.setAttribute('aria-label', S.editorName);
    this.nameInput.spellcheck = false;
    const button = (label: string, run: () => void) => {
      const node = el('button', 'editor-button', label);
      node.type = 'button';
      node.addEventListener('click', run);
      bar.append(node);
      return node;
    };
    bar.append(this.nameInput);
    this.buttons = {
      add: button(S.editorAdd, () => this.toggleAdding()),
      remove: button(S.editorRemove, () => this.removeSelected()),
      undo: button(S.editorUndo, () => this.undo()),
      redo: button(S.editorRedo, () => this.redo()),
    };
    button(S.editorTest, () => this.track && this.onTest?.(cloneTrack(this.track)));
    button(S.editorDone, () => this.onClose?.());
    this.element.append(this.canvas, bar, this.status);

    this.nameInput.addEventListener('input', () => {
      if (!this.track) return;
      this.track.name = this.nameInput.value;
      this.onChange?.(cloneTrack(this.track));
    });
    this.canvas.addEventListener('pointerdown', (event) => this.pointerDown(event));
    this.canvas.addEventListener('pointermove', (event) => this.pointerMove(event));
    this.canvas.addEventListener('pointerup', (event) => this.pointerUp(event));
    this.canvas.addEventListener('pointercancel', (event) => this.pointerUp(event));
    this.canvas.addEventListener('dblclick', (event) => this.addAt(event.offsetX, event.offsetY));
    this.canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.zoomAt(event.offsetX, event.offsetY, Math.exp(-event.deltaY * 0.0015));
      },
      { passive: false },
    );
    new ResizeObserver(() => this.draw()).observe(this.canvas);
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  /** Opens a track for editing. */
  open(track: EditorTrack): void {
    this.track = cloneTrack(track);
    this.nameInput.value = track.name;
    this.selected = null;
    this.adding = false;
    this.undoStack = [];
    this.redoStack = [];
    this.element.hidden = false;
    this.fit();
    this.say(S.editorHint);
    this.refresh();
  }

  /** Shows the editor again after a test drive, with a word on how it went. */
  show(message: string): void {
    this.element.hidden = false;
    this.say(message || S.editorHint);
    this.draw();
  }

  hide(): void {
    this.element.hidden = true;
    this.pointers.clear();
    this.dragging = null;
  }

  private say(text: string): void {
    this.status.textContent = text;
  }

  // ---- view ---------------------------------------------------------------------------------

  /** Shows the whole track. */
  private fit(): void {
    const points = this.track?.points ?? [];
    const first = points[0];
    const last = points[points.length - 1];
    if (!first || !last) return;
    let low = Infinity;
    let high = -Infinity;
    for (const point of points) {
      low = Math.min(low, point.y);
      high = Math.max(high, point.y);
    }
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.centerX = (first.x + last.x) / 2;
    this.centerY = (low + high) / 2 + 20;
    this.zoom = Math.max(0.05, Math.min(4, (width * 0.9) / (last.x - first.x), (height * 0.5) / (high - low + 120)));
  }

  private toScreen(x: number, y: number): [number, number] {
    return [
      this.canvas.clientWidth / 2 + (x - this.centerX) * this.zoom,
      this.canvas.clientHeight / 2 - (y - this.centerY) * this.zoom,
    ];
  }

  private toTrack(sx: number, sy: number): [number, number] {
    return [
      this.centerX + (sx - this.canvas.clientWidth / 2) / this.zoom,
      this.centerY - (sy - this.canvas.clientHeight / 2) / this.zoom,
    ];
  }

  private zoomAt(sx: number, sy: number, factor: number): void {
    const [x, y] = this.toTrack(sx, sy);
    this.zoom = Math.max(0.05, Math.min(8, this.zoom * factor));
    // Keep the point under the pointer where it is.
    this.centerX = x - (sx - this.canvas.clientWidth / 2) / this.zoom;
    this.centerY = y + (sy - this.canvas.clientHeight / 2) / this.zoom;
    this.draw();
  }

  // ---- editing ------------------------------------------------------------------------------

  private remember(before: EditorTrack): void {
    this.undoStack.push(before);
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  /** After a change: redraw, update the buttons, tell the owner. */
  private refresh(changed = false): void {
    const track = this.track;
    if (!track) return;
    this.buttons.add.classList.toggle('editor-button-on', this.adding);
    this.buttons.add.disabled = track.points.length >= MAX_POINTS;
    this.buttons.remove.disabled = this.selected?.kind !== 'point';
    this.buttons.undo.disabled = this.undoStack.length === 0;
    this.buttons.redo.disabled = this.redoStack.length === 0;
    this.draw();
    if (changed) this.onChange?.(cloneTrack(track));
  }

  private toggleAdding(): void {
    this.adding = !this.adding;
    this.say(this.adding ? S.editorAddHint : S.editorHint);
    this.refresh();
  }

  private addAt(sx: number, sy: number): void {
    const track = this.track;
    if (!track) return;
    const before = cloneTrack(track);
    const [x, y] = this.toTrack(sx, sy);
    const index = insertPoint(track, x, y);
    if (index < 0) return;
    this.remember(before);
    this.selected = { kind: 'point', index };
    this.refresh(true);
  }

  private removeSelected(): void {
    const track = this.track;
    if (!track || this.selected?.kind !== 'point') return;
    const before = cloneTrack(track);
    if (!removePoint(track, this.selected.index)) {
      this.say(S.editorTooFew);
      return;
    }
    this.remember(before);
    this.selected = null;
    this.refresh(true);
  }

  private restore(from: EditorTrack[], to: EditorTrack[]): void {
    const state = from.pop();
    if (!state || !this.track) return;
    to.push(cloneTrack(this.track));
    // The name is edited in its own field, with its own undo.
    this.track = { ...state, name: this.track.name };
    this.selected = null;
    this.refresh(true);
  }

  private undo(): void {
    this.restore(this.undoStack, this.redoStack);
  }

  private redo(): void {
    this.restore(this.redoStack, this.undoStack);
  }

  private moveHandle(handle: Handle, x: number, y: number): void {
    const track = this.track;
    if (!track) return;
    if (handle.kind === 'point') {
      movePoint(track, handle.index, x, y);
    } else if (handle.kind === 'start') {
      track.start = { x: Math.round(x), y: Math.round(y) };
      settle(track);
    } else {
      track.finishX = Math.round(x);
      settle(track);
    }
  }

  private position(handle: Handle): [number, number] {
    const track = this.track;
    if (!track) return [0, 0];
    if (handle.kind === 'start') return [track.start.x, track.start.y];
    if (handle.kind === 'finish') return [track.finishX, groundY(track, track.finishX) + 40];
    const point = track.points[handle.index];
    return [point?.x ?? 0, point?.y ?? 0];
  }

  /** What is under a pointer, the nearest thing first. */
  private handleAt(sx: number, sy: number): Handle | null {
    return this.nearest(sx, sy, GRAB);
  }

  private nearest(sx: number, sy: number, reach: number): Handle | null {
    const track = this.track;
    if (!track) return null;
    const handles: Handle[] = [{ kind: 'start' }, { kind: 'finish' }];
    for (let index = 0; index < track.points.length; index++) handles.push({ kind: 'point', index });
    let best: Handle | null = null;
    let nearest = reach;
    for (const handle of handles) {
      const [x, y] = this.toScreen(...this.position(handle));
      const distance = Math.hypot(x - sx, y - sy);
      if (distance < nearest) {
        nearest = distance;
        best = handle;
      }
    }
    return best;
  }

  // ---- pointer ------------------------------------------------------------------------------

  private pointerDown(event: PointerEvent): void {
    this.nameInput.blur();
    this.canvas.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.offsetX, y: event.offsetY });
    if (this.pointers.size === 2) {
      // A second finger turns whatever was going on into a pinch.
      const [a, b] = [...this.pointers.values()];
      this.pinch = a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
      this.dragging = 'view';
      return;
    }
    this.moved = false;
    if (this.adding) {
      this.addAt(event.offsetX, event.offsetY);
      this.dragging = this.selected;
    } else {
      this.dragging = this.handleAt(event.offsetX, event.offsetY) ?? 'view';
      this.selected = this.dragging === 'view' ? null : this.dragging;
    }
    this.beforeDrag = this.track && this.dragging !== 'view' && !this.adding ? cloneTrack(this.track) : null;
    this.refresh();
  }

  private pointerMove(event: PointerEvent): void {
    const last = this.pointers.get(event.pointerId);
    if (!last) return;
    const dx = event.offsetX - last.x;
    const dy = event.offsetY - last.y;
    this.pointers.set(event.pointerId, { x: event.offsetX, y: event.offsetY });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      if (!a || !b) return;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinch > 0) this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, distance / this.pinch);
      this.pinch = distance;
      return;
    }
    if (this.dragging === 'view') {
      this.centerX -= dx / this.zoom;
      this.centerY += dy / this.zoom;
      this.draw();
    } else if (this.dragging) {
      this.moved = true;
      this.moveHandle(this.dragging, ...this.toTrack(event.offsetX, event.offsetY));
      this.draw();
    }
  }

  private pointerUp(event: PointerEvent): void {
    if (!this.pointers.delete(event.pointerId)) return;
    if (this.pointers.size > 0) return;
    if (this.moved && this.dragging && this.dragging !== 'view') {
      if (this.beforeDrag) this.remember(this.beforeDrag);
      this.refresh(true);
    }
    this.dragging = null;
    this.beforeDrag = null;
  }

  /** Handles a key press. Returns true if the key was used. */
  key(event: KeyboardEvent): boolean {
    if (document.activeElement === this.nameInput) {
      if (event.key !== 'Enter' && event.key !== 'Escape') return false;
      this.nameInput.blur();
      return true;
    }
    const track = this.track;
    if (!track) return false;
    const step = event.shiftKey ? 10 : 1;
    const nudge = (dx: number, dy: number) => {
      const handle = this.selected;
      if (!handle) {
        // Nothing selected: the arrows move the view.
        this.centerX += (dx * 40) / this.zoom;
        this.centerY += (dy * 40) / this.zoom;
        this.draw();
        return;
      }
      const before = cloneTrack(track);
      const [x, y] = this.position(handle);
      this.moveHandle(handle, x + dx * step, (handle.kind === 'finish' ? 0 : y) + dy * step);
      this.remember(before);
      this.refresh(true);
    };
    const select = (direction: number) => {
      const current = this.selected?.kind === 'point' ? this.selected.index : direction > 0 ? -1 : track.points.length;
      const index = Math.max(0, Math.min(track.points.length - 1, current + direction));
      this.selected = { kind: 'point', index };
      const point = track.points[index];
      if (point) [this.centerX, this.centerY] = [point.x, point.y];
      this.refresh();
    };
    const modifier = event.ctrlKey || event.metaKey;
    switch (event.key) {
      case 'ArrowLeft':
        nudge(-1, 0);
        return true;
      case 'ArrowRight':
        nudge(1, 0);
        return true;
      case 'ArrowUp':
        nudge(0, 1);
        return true;
      case 'ArrowDown':
        nudge(0, -1);
        return true;
      case 'Tab':
        select(event.shiftKey ? -1 : 1);
        return true;
      case 'Delete':
      case 'Backspace':
        this.removeSelected();
        return true;
      case 'Insert':
      case 'a':
      case 'A':
        if (modifier) return false;
        this.toggleAdding();
        return true;
      case 'z':
      case 'Z':
        if (!modifier) return false;
        if (event.shiftKey) this.redo();
        else this.undo();
        return true;
      case 'y':
      case 'Y':
        if (!modifier) return false;
        this.redo();
        return true;
      case '+':
      case '=':
        this.zoomAt(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2, 1.25);
        return true;
      case '-':
        this.zoomAt(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2, 0.8);
        return true;
      case '0':
        this.fit();
        this.draw();
        return true;
      case 't':
      case 'T':
      case 'Enter':
        this.onTest?.(cloneTrack(track));
        return true;
      case 'Escape':
        if (this.adding) this.toggleAdding();
        else if (this.selected) {
          this.selected = null;
          this.refresh();
        } else this.onClose?.();
        return true;
      default:
        return false;
    }
  }

  /** The same from a gamepad: the stick moves, the buttons pick up, add, delete and zoom. */
  pad(action: PadAction): void {
    const track = this.track;
    if (!track) return;
    const key = (name: string, shiftKey = false) =>
      this.key({ key: name, shiftKey, ctrlKey: false, metaKey: false } as KeyboardEvent);
    switch (action) {
      case 'up':
        key('ArrowUp', true);
        break;
      case 'down':
        key('ArrowDown', true);
        break;
      case 'left':
        key('ArrowLeft', true);
        break;
      case 'right':
        key('ArrowRight', true);
        break;
      case 'fire': {
        // Picks up whatever is nearest the middle of the view, or puts down what is held.
        if (this.selected) this.selected = null;
        else this.selected = this.nearest(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2, Infinity);
        this.refresh();
        break;
      }
      case 'previous':
        key('Tab', true);
        break;
      case 'next':
        key('Tab');
        break;
      case 'add':
        this.addAt(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2);
        break;
      case 'remove':
        this.removeSelected();
        break;
      case 'zoomIn':
        key('+');
        break;
      case 'zoomOut':
        key('-');
        break;
      case 'pause':
        this.onTest?.(cloneTrack(track));
        break;
      case 'back':
        key('Escape');
        break;
    }
    this.say(S.editorPadHint);
  }

  // ---- drawing ------------------------------------------------------------------------------

  private draw(): void {
    const track = this.track;
    const canvas = this.canvas;
    if (!track || this.element.hidden) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    const ctx = this.ctx;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);

    // A grid of 100 units, so distances can be judged.
    const [left, top] = this.toTrack(0, 0);
    const [right, bottom] = this.toTrack(width, height);
    const gap = this.zoom < 0.3 ? 1000 : 100;
    ctx.strokeStyle = '#ececec';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.ceil(left / gap) * gap; x <= right; x += gap) {
      const [sx] = this.toScreen(x, 0);
      ctx.moveTo(Math.round(sx) + 0.5, 0);
      ctx.lineTo(Math.round(sx) + 0.5, height);
    }
    for (let y = Math.ceil(bottom / gap) * gap; y <= top; y += gap) {
      const [, sy] = this.toScreen(0, y);
      ctx.moveTo(0, Math.round(sy) + 0.5);
      ctx.lineTo(width, Math.round(sy) + 0.5);
    }
    ctx.stroke();

    // The ground.
    ctx.strokeStyle = '#29aa27';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    track.points.forEach((point, index) => {
      const [x, y] = this.toScreen(point.x, point.y);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // The finish: a pole on the ground with a flag.
    const finishGround = groundY(track, track.finishX);
    const [fx, fy] = this.toScreen(track.finishX, finishGround);
    const [, flagY] = this.toScreen(track.finishX, finishGround + 40);
    const finishSelected = this.selected?.kind === 'finish';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = finishSelected ? 3 : 1.5;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(fx, flagY);
    ctx.stroke();
    ctx.fillStyle = finishSelected ? '#29aa27' : '#000';
    ctx.fillRect(fx, flagY, 14, 10);
    ctx.font = `13px ${GAME_FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(S.editorFinish, fx + 4, flagY - 5);

    // The start: the bike's two wheels, at their real size.
    const startSelected = this.selected?.kind === 'start';
    ctx.strokeStyle = startSelected ? '#29aa27' : '#000';
    ctx.lineWidth = startSelected ? 3 : 1.5;
    for (const side of [-1, 1]) {
      const [wx, wy] = this.toScreen(track.start.x + side * HALF_BIKE, track.start.y - WHEEL);
      ctx.beginPath();
      ctx.arc(wx, wy, Math.max(2, WHEEL * this.zoom), 0, Math.PI * 2);
      ctx.stroke();
    }
    const [sx, sy] = this.toScreen(track.start.x, track.start.y);
    ctx.fillStyle = startSelected ? '#29aa27' : '#000';
    ctx.fillRect(sx - 3, sy - 3, 6, 6);
    ctx.fillText(S.editorStart, sx + 6, sy - 6);

    // The points.
    track.points.forEach((point, index) => {
      const [x, y] = this.toScreen(point.x, point.y);
      const selected = this.selected?.kind === 'point' && this.selected.index === index;
      const size = selected ? 6 : 3;
      ctx.fillStyle = selected ? '#29aa27' : '#000';
      ctx.fillRect(x - size, y - size, size * 2, size * 2);
    });
  }
}
