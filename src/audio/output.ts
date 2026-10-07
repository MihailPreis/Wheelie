/**
 * The one audio context everything plays through.
 *
 * Browsers only allow sound after the player has interacted with the page, so the context does
 * not exist until {@link AudioOutput.unlock} is called from an input event.
 */
export class AudioOutput {
  private current: AudioContext | null = null;
  /** The page is in the background, so nothing should be audible. */
  private hidden = false;

  /** The context, once the player has interacted with the page. */
  get context(): AudioContext | null {
    return this.current;
  }

  /** Call from a user input event. Returns null where audio is not available at all. */
  unlock(): AudioContext | null {
    if (!this.current) {
      if (typeof AudioContext === 'undefined') return null;
      this.current = new AudioContext();
    }
    this.apply();
    return this.current;
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.apply();
  }

  private apply(): void {
    const context = this.current;
    if (!context) return;
    if (!this.hidden && context.state === 'suspended') void context.resume();
    else if (this.hidden && context.state === 'running') void context.suspend();
  }
}
