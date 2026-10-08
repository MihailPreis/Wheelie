import { ACTIONS, type Action, type Input } from '../game/input';
import { controlIcon } from './control-icons';
import { STRINGS as S } from './strings';
import './keypad.css';

/** Four riding buttons: lean on the left, throttle and brake on the right. */
export class Keypad {
  readonly element = document.createElement('div');
  private readonly buttons = new Map<Action, HTMLButtonElement>();
  private readonly pointers = new Set<number>();
  vibrate = true;
  onPress: ((action: Action) => void) | null = null;

  constructor(private readonly input: Input) {
    this.element.className = 'keypad';
    this.element.hidden = true;
    for (const actions of [
      ['leanBack', 'leanForward'],
      ['accelerate', 'brake'],
    ] as const) {
      const group = document.createElement('div');
      group.className = 'keypad-group';
      for (const action of actions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'keypad-button';
        button.setAttribute('aria-label', S.actions[ACTIONS.indexOf(action)] ?? action);
        button.append(controlIcon(action));
        this.buttons.set(action, button);
        group.append(button);
      }
      this.element.append(group);
    }
    this.element.addEventListener('pointerdown', (event) => {
      const action = this.actionAt(event);
      if (!action) return;
      this.pointers.add(event.pointerId);
      this.element.setPointerCapture(event.pointerId);
      this.input.touchAction(event.pointerId, action);
      this.onPress?.(action);
      if (this.vibrate && navigator.userActivation?.hasBeenActive) navigator.vibrate?.(10);
      this.refresh();
      event.preventDefault();
    });
    this.element.addEventListener('pointermove', (event) => {
      if (!this.pointers.has(event.pointerId)) return;
      this.input.touchAction(event.pointerId, this.actionAt(event));
      this.refresh();
    });
    const end = (event: PointerEvent) => {
      this.pointers.delete(event.pointerId);
      this.input.touchEnd(event.pointerId);
      this.refresh();
    };
    this.element.addEventListener('pointerup', end);
    this.element.addEventListener('pointercancel', end);
    this.element.addEventListener('lostpointercapture', end);
    this.element.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  private actionAt(event: PointerEvent): Action | null {
    for (const [action, button] of this.buttons) {
      const box = button.getBoundingClientRect();
      if (
        event.clientX >= box.left &&
        event.clientX < box.right &&
        event.clientY >= box.top &&
        event.clientY < box.bottom
      )
        return action;
    }
    return null;
  }

  private refresh(): void {
    for (const [action, button] of this.buttons) {
      const pressed = this.input.pressedTouchActions.has(action);
      button.classList.toggle('pressed', pressed);
      button.setAttribute('aria-pressed', String(pressed));
    }
  }

  set visible(visible: boolean) {
    this.element.hidden = !visible;
    if (!visible) {
      for (const pointer of this.pointers) this.input.touchEnd(pointer);
      this.pointers.clear();
    }
    this.refresh();
  }
  get visible(): boolean {
    return !this.element.hidden;
  }
  get height(): number {
    return this.element.hidden ? 0 : this.element.getBoundingClientRect().height;
  }
}
