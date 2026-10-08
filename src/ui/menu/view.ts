import './menu.css';
import { STRINGS as S } from '../strings';

/**
 * The menu, laid out as in the Android port: a title, then a column of items, the highlighted one
 * marked by a spinning helmet. Screens are plain data; the controller rebuilds them whenever
 * something changes.
 */

export type MenuItem =
  | { kind: 'action'; label: string; run: () => void }
  | {
      kind: 'option';
      label: string;
      options: readonly string[];
      value: number;
      /** Highest option that is unlocked; later ones show a lock. */
      unlocked?: number;
      /** An on/off switch: `value` 0 is on, 1 is off, and selecting it flips it. */
      toggle?: boolean;
      change: (value: number) => void;
    }
  | {
      /** A line of text to type. `change` gets it when Enter is pressed or the field is left. */
      kind: 'input';
      label: string;
      value: string;
      maxLength: number;
      change: (value: string) => void;
    }
  | { kind: 'text'; html: string; big?: boolean; medal?: number }
  | { kind: 'space'; size: number };

export interface MenuScreen {
  title: string;
  items: MenuItem[];
  /** Where "back" leads; `null` if the screen cannot be left that way. */
  back: (() => void) | null;
  /** A screen of reading matter: up and down scroll instead of moving the highlight. */
  text?: boolean;
  /** Item index to select on opening; otherwise the first interactive item. */
  initialSelection?: number;
}

export type MenuKey = 'up' | 'down' | 'left' | 'right' | 'fire' | 'back';

const MEDALS = ['s_medal_gold', 's_medal_silver', 's_medal_bronze'];
const NAME_ALPHABET = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class MenuView {
  readonly element = el('div', 'menu');
  private readonly title = el('div', 'menu-title');
  private readonly list = el('div', 'menu-items');

  private screen: MenuScreen | null = null;
  private selected = -1;
  private rows: (HTMLElement | null)[] = [];
  private nameInput: { chars: string[]; cursor: number; done: (name: string) => void } | null = null;

  constructor(private readonly spriteUrl: (name: string) => string) {
    this.element.hidden = true;
    this.element.append(this.title, this.list);
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  hide(): void {
    this.element.hidden = true;
    this.screen = null;
    this.nameInput = null;
  }

  private sprite(name: string, className: string): HTMLImageElement {
    const image = el('img', className);
    image.src = this.spriteUrl(name);
    image.alt = '';
    image.draggable = false;
    return image;
  }

  // ---- list screens -----------------------------------------------------------------------

  /** Shows a screen. `keepSelection` keeps the highlight where it is, for a rebuilt screen. */
  show(screen: MenuScreen, keepSelection = false): void {
    const previousItem =
      keepSelection && this.screen?.title === screen.title ? this.screen.items[this.selected] : undefined;
    const previous =
      previousItem && 'label' in previousItem
        ? screen.items.findIndex(
            (item) => item.kind === previousItem.kind && 'label' in item && item.label === previousItem.label,
          )
        : undefined;
    // One consistent footer, including option lists and confirmation screens.
    if (screen.back) {
      const footer = screen.items.find((item) => item.kind === 'action' && item.label === S.back);
      screen = {
        ...screen,
        items: [
          ...screen.items.filter((item) => item.kind !== 'action' || item.label !== S.back),
          footer ?? { kind: 'action', label: S.back, run: screen.back },
        ],
      };
    }
    this.screen = screen;
    this.nameInput = null;
    this.element.hidden = false;
    this.element.classList.toggle('menu-text-screen', !!screen.text);
    this.title.textContent = screen.title;
    this.list.replaceChildren();
    this.rows = screen.items.map((item, index) => {
      const row = this.renderItem(item, index);
      this.list.append(row);
      return item.kind === 'action' || item.kind === 'option' || item.kind === 'input' ? row : null;
    });

    const wanted = previous ?? screen.initialSelection ?? -1;
    this.select(this.rows[wanted] ? wanted : this.rows.findIndex((row) => row !== null));
    if (!keepSelection) this.list.scrollTop = 0;
    if (!screen.text) this.revealSelected();
  }

  private renderItem(item: MenuItem, index: number): HTMLElement {
    if (item.kind === 'space') {
      const space = el('div', 'menu-space');
      space.style.height = `calc(var(--dp) * ${item.size}px)`;
      return space;
    }
    if (item.kind === 'text') {
      const text = el('div', item.big ? 'menu-text menu-text-big' : 'menu-text');
      if (item.medal !== undefined) text.append(this.sprite(MEDALS[item.medal] ?? MEDALS[0] ?? '', 'menu-medal'));
      const body = el('span', '');
      // Screen text comes from the strings module and from escaped values only.
      body.innerHTML = item.html;
      text.append(body);
      return text;
    }

    const row = el('div', 'menu-item');
    row.classList.toggle('menu-back', item.kind === 'action' && item.label === S.back);
    const helmet = el('span', 'menu-helmet');
    helmet.append(this.sprite('s_helmet', 'menu-helmet-image'));
    row.append(helmet);
    if (item.kind === 'action') {
      row.append(el('span', 'menu-label', item.label));
    } else if (item.kind === 'input') {
      row.append(el('span', 'menu-label', `${item.label}: `));
      const input = el('input', 'menu-input');
      input.type = 'text';
      input.value = item.value;
      input.maxLength = item.maxLength;
      input.setAttribute('aria-label', item.label);
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.addEventListener('change', () => item.change(input.value));
      input.addEventListener('focus', () => this.select(index));
      row.append(input);
      row.addEventListener('pointermove', () => this.select(index));
      row.addEventListener('click', () => input.focus());
      return row;
    } else {
      row.append(el('span', 'menu-label', `${item.label}: `));
      const locked = item.unlocked !== undefined && item.value > item.unlocked;
      if (locked) row.append(this.sprite('s_lock0', 'menu-lock'));
      row.append(el('span', 'menu-value', item.options[item.value] ?? ''));
    }
    row.addEventListener('pointermove', () => this.select(index));
    row.addEventListener('click', () => {
      this.select(index);
      this.key('fire');
    });
    return row;
  }

  private select(index: number): void {
    if (index === this.selected && this.rows[index]?.classList.contains('selected')) return;
    this.rows[this.selected]?.classList.remove('selected');
    this.selected = index;
    this.rows[index]?.classList.add('selected');
    const field = this.rows[index]?.querySelector('input');
    const focused = document.activeElement;
    // The highlight and the caret go together when moving with the keys.
    if (!field && focused instanceof HTMLInputElement && this.list.contains(focused)) focused.blur();
  }

  /** The text field of the highlighted row, if it is one. */
  private get field(): HTMLInputElement | null {
    return this.rows[this.selected]?.querySelector('input') ?? null;
  }

  /** True while the player is typing into a field of the menu. */
  get typing(): boolean {
    const focused = document.activeElement;
    return focused instanceof HTMLInputElement && this.list.contains(focused);
  }

  private revealSelected(): void {
    this.rows[this.selected]?.scrollIntoView({ block: 'nearest' });
  }

  private move(direction: 1 | -1): void {
    const count = this.rows.length;
    for (let step = 1; step <= count; step++) {
      const index = (((this.selected + direction * step) % count) + count) % count;
      if (this.rows[index]) {
        this.select(index);
        this.revealSelected();
        this.field?.focus();
        return;
      }
    }
  }

  /** A list of an option's values to pick from, as the original shows when an option is selected. */
  private pick(item: Extract<MenuItem, { kind: 'option' }>, parent: MenuScreen): void {
    const parentSelection = this.selected;
    const back = () => this.show({ ...parent, initialSelection: parentSelection });
    const screen: MenuScreen = {
      title: item.label,
      back,
      initialSelection: item.value,
      items: item.options.map((label, value) => ({
        kind: 'action' as const,
        label,
        run: () => {
          item.change(value);
          if (this.screen?.title === parent.title) {
            this.select(parentSelection);
            this.revealSelected();
          }
        },
      })),
    };
    this.show(screen);
    item.options.forEach((_, value) => {
      if (item.unlocked !== undefined && value > item.unlocked) {
        this.rows[value]?.append(this.sprite('s_lock0', 'menu-lock menu-lock-after'));
      }
    });
  }

  /** Handles a navigation key. Returns false if nothing is shown. */
  key(key: MenuKey): boolean {
    if (this.nameInput) {
      this.nameKey(key);
      return true;
    }
    const screen = this.screen;
    if (!screen) return false;
    if (key === 'back') {
      screen.back?.();
      return true;
    }
    if (key === 'up' || key === 'down') {
      if (screen.text) this.list.scrollBy({ top: (key === 'up' ? -1 : 1) * this.list.clientHeight * 0.5 });
      else this.move(key === 'up' ? -1 : 1);
      return true;
    }

    const item = screen.items[this.selected];
    if (!item) return true;
    if (item.kind === 'action') {
      if (key === 'fire') item.run();
      return true;
    }
    if (item.kind === 'input') {
      const field = this.field;
      if (key !== 'fire' || !field) return true;
      // Selecting starts typing; selecting again takes what was typed.
      if (document.activeElement === field) field.blur();
      else field.focus();
      return true;
    }
    if (item.kind !== 'option') return true;
    if (item.toggle) {
      // Right switches on, left switches off, selecting flips.
      const next = key === 'fire' ? 1 - item.value : key === 'right' ? 0 : 1;
      if (next !== item.value) item.change(next);
    } else if (key === 'fire') {
      this.pick(item, screen);
    } else {
      const next = Math.max(0, Math.min(item.options.length - 1, item.value + (key === 'right' ? 1 : -1)));
      if (next !== item.value) item.change(next);
    }
    return true;
  }

  // ---- name entry -------------------------------------------------------------------------

  /** Asks for the three-letter name of the high score tables (`NameInputMenuScreen`). */
  showNameInput(title: string, name: string, done: (name: string) => void): void {
    this.screen = null;
    this.nameInput = { chars: [...name.padEnd(3, ' ').slice(0, 3)], cursor: 0, done };
    this.element.hidden = false;
    this.element.classList.remove('menu-text-screen');
    this.title.textContent = title;
    this.renderName();
  }

  private renderName(): void {
    const state = this.nameInput;
    if (!state) return;
    const letters = el('div', 'menu-name');
    state.chars.forEach((char, index) => {
      const column = el('div', index === state.cursor ? 'menu-name-letter selected' : 'menu-name-letter');
      const up = this.sprite('s_arrow_up', 'menu-name-arrow');
      const down = this.sprite('s_arrow_down', 'menu-name-arrow');
      const pick = (delta: 1 | -1) => (event: Event) => {
        event.stopPropagation();
        state.cursor = index;
        this.cycleLetter(delta);
      };
      up.addEventListener('click', pick(1));
      down.addEventListener('click', pick(-1));
      column.addEventListener('click', () => {
        state.cursor = index;
        this.renderName();
      });
      column.append(up, el('span', 'menu-name-char', char === ' ' ? ' ' : char), down);
      letters.append(column);
    });
    const ok = el('div', 'menu-item selected');
    const helmet = el('span', 'menu-helmet');
    helmet.append(this.sprite('s_helmet', 'menu-helmet-image'));
    ok.append(helmet, el('span', 'menu-label', S.ok));
    ok.addEventListener('click', () => this.nameKey('fire'));
    const back = el('div', 'menu-item menu-back');
    back.append(el('span', 'menu-helmet'), el('span', 'menu-label', S.back));
    back.addEventListener('click', () => this.nameKey('back'));
    this.list.replaceChildren(letters, ok, back);
  }

  private cycleLetter(delta: 1 | -1): void {
    const state = this.nameInput;
    if (!state) return;
    const size = NAME_ALPHABET.length;
    const at = Math.max(0, NAME_ALPHABET.indexOf(state.chars[state.cursor] ?? ' '));
    state.chars[state.cursor] = NAME_ALPHABET[(at + delta + size) % size] ?? ' ';
    this.renderName();
  }

  private nameKey(key: MenuKey): void {
    const state = this.nameInput;
    if (!state) return;
    if (key === 'up') this.cycleLetter(1);
    else if (key === 'down') this.cycleLetter(-1);
    else if (key === 'left' || key === 'right') {
      state.cursor = (state.cursor + (key === 'right' ? 1 : 2)) % 3;
      this.renderName();
    } else {
      // Selecting and going back both accept what has been entered.
      this.nameInput = null;
      state.done(state.chars.join(''));
    }
  }

  /** Types a letter straight into the name, if the name is being entered. */
  typeLetter(letter: string): boolean {
    const state = this.nameInput;
    const upper = letter.toUpperCase();
    if (!state || upper.length !== 1 || !NAME_ALPHABET.includes(upper)) return false;
    state.chars[state.cursor] = upper;
    state.cursor = Math.min(2, state.cursor + 1);
    this.renderName();
    return true;
  }
}
