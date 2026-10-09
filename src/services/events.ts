export interface GameEvents {
  game_open: { entry: 'menu' | 'replay' | 'track'; embedded: boolean };
  run_start: { mode: 'regular' | 'daily'; league: number; input_device: string; pack_type: string };
  run_end: { outcome: 'finished' | 'crashed' | 'abandoned'; duration_ms: number; race_time_ms: number; mode: string };
  editor_test: { league: number };
  mod_install: { source: 'catalogue' | 'file' };
  export_ready: { format: 'png' | 'gif' | 'gdr' };
  game_pause: Record<string, never>;
  game_resume: Record<string, never>;
  replay_open: { embedded: boolean; duration_ms: number };
  share: { content_type: 'run' };
  unlock_achievement: { achievement_id: string };
}

type Send = (name: string, parameters: Record<string, string | number | boolean>) => void;
let send: Send | null = null;

export function setAnalyticsSender(sender: Send | null): void {
  send = sender;
}

/** Telemetry must never interrupt a game or its deterministic simulation. */
export function trackEvent<K extends keyof GameEvents>(name: K, parameters: GameEvents[K]): void {
  try {
    send?.(name, parameters);
  } catch {
    // Offline play and blocked tags are ordinary conditions.
  }
}
