import './toast.css';

/** How long a line stays up, in milliseconds. */
const SHOWN_FOR = 4500;

/** Brief lines at the top of the screen, for news that should not interrupt: an achievement earned. */
export class Toasts {
  readonly element = document.createElement('div');

  constructor() {
    this.element.className = 'toasts';
    this.element.setAttribute('role', 'status');
  }

  show(text: string): void {
    const line = document.createElement('div');
    line.className = 'toast';
    line.textContent = text;
    this.element.append(line);
    setTimeout(() => line.remove(), SHOWN_FOR);
  }
}
