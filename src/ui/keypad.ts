import type { Input } from '../game/input';
import './keypad.css';

/**
 * The on-screen keypad of the Android port: a 3×3 grid standing in for the digits 1–9 of a phone
 * keypad (`KeyboardController`). Shown only while touch is the device in use.
 */
export class Keypad {
  readonly element: HTMLDivElement;
  private readonly buttons: HTMLDivElement[] = [];
  private readonly grid: HTMLDivElement;
  vibrate = true;
  /** Called with the digit (1–9) each time a button is pressed. */
  onPress: ((digit: number) => void) | null = null;

  constructor(private readonly input: Input) {
    this.element = document.createElement('div');
    this.element.className = 'keypad';
    this.element.hidden = true;
    this.grid = document.createElement('div');
    this.grid.className = 'keypad-grid';
    for (let i = 0; i < 9; i++) {
      const button = document.createElement('div');
      button.className = 'keypad-button';
      this.buttons.push(button);
      this.grid.append(button);
    }
    this.element.append(this.grid);

    this.element.addEventListener('pointerdown', (event) => {
      this.element.setPointerCapture(event.pointerId);
      const digit = this.digitAt(event);
      this.input.touch(event.pointerId, digit);
      this.onPress?.(digit);
      // Browsers reject vibration before the first completed tap.
      if (this.vibrate && navigator.userActivation?.hasBeenActive) navigator.vibrate?.(10);
      this.refresh();
      event.preventDefault();
    });
    this.element.addEventListener('pointermove', (event) => {
      if (!this.element.hasPointerCapture(event.pointerId)) return;
      this.input.touch(event.pointerId, this.digitAt(event));
      this.refresh();
    });
    const end = (event: PointerEvent) => {
      this.input.touchEnd(event.pointerId);
      this.refresh();
    };
    this.element.addEventListener('pointerup', end);
    this.element.addEventListener('pointercancel', end);
    this.element.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  /** The digit under a pointer; positions in the padding count as the nearest button. */
  private digitAt(event: PointerEvent): number {
    const rect = this.grid.getBoundingClientRect();
    const cell = (position: number, size: number) => Math.max(0, Math.min(2, Math.floor((position / size) * 3)));
    const column = cell(event.clientX - rect.left, rect.width);
    const row = cell(event.clientY - rect.top, rect.height);
    return row * 3 + column + 1;
  }

  private refresh(): void {
    const pressed = this.input.pressedDigits;
    this.buttons.forEach((button, index) => {
      button.classList.toggle('pressed', pressed.has(index + 1));
    });
  }

  set visible(visible: boolean) {
    this.element.hidden = !visible;
    if (!visible) this.refresh();
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  /** Height in CSS pixels while shown, 0 otherwise. */
  get height(): number {
    return this.element.hidden ? 0 : this.element.getBoundingClientRect().height;
  }
}
