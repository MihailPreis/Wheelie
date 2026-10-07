import { Outcome } from '../formats/replay';
import { formatScoreTime } from '../game/highscores';
import { LEAGUE_NAMES, LEVEL_NAMES } from '../game/progress';
import type { MenuItem, MenuScreen } from '../ui/menu/view';
import { STRINGS as S } from '../ui/strings';
import type { ReplayStore, StoredReplay } from './store';

type ScreenBuilder = () => MenuScreen;

export interface ReplaysHost {
  open(builder: ScreenBuilder): void;
  readonly parent: ScreenBuilder;
}

/** Runs listed at once; the rest come with "Load more". */
const PAGE = 50;

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const field = (label: string, value: string): MenuItem => ({
  kind: 'text',
  html: `<span class="menu-dim">${label}:</span> ${escapeHtml(value)}`,
});
const when = (milliseconds: number) =>
  new Date(milliseconds).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

function result(replay: StoredReplay): string {
  if (replay.outcome === Outcome.Finished) return formatScoreTime(Math.floor(replay.time / 10));
  return replay.outcome === Outcome.Crashed ? S.runCrashed : S.runAbandoned;
}

/** "My runs": the replays kept on this device. */
export class ReplayScreens {
  private replays: StoredReplay[] = [];
  private shown = PAGE;

  constructor(
    private readonly host: ReplaysHost,
    private readonly store: ReplayStore,
  ) {}

  async openList(): Promise<void> {
    this.replays = await this.store.list();
    this.shown = PAGE;
    this.host.open(this.listScreen);
  }

  private readonly listScreen: ScreenBuilder = () => {
    const back = () => this.host.open(this.host.parent);
    const items: MenuItem[] = [];
    if (this.replays.length === 0) items.push({ kind: 'text', html: S.noRuns });
    for (const replay of this.replays.slice(0, this.shown)) {
      items.push({
        kind: 'action',
        label: `${replay.trackName} - ${LEAGUE_NAMES[replay.league] ?? ''} - ${result(replay)}`,
        run: () => this.host.open(this.replayScreen(replay)),
      });
    }
    if (this.replays.length > this.shown) {
      items.push({
        kind: 'action',
        label: S.loadMore(this.replays.length - this.shown),
        run: () => {
          this.shown += PAGE;
          this.host.open(this.listScreen);
        },
      });
    }
    items.push({ kind: 'action', label: S.back, run: back });
    return { title: S.myRuns, back, items };
  };

  private replayScreen(replay: StoredReplay): ScreenBuilder {
    return () => {
      const back = () => this.host.open(this.listScreen);
      return {
        title: S.myRuns,
        back,
        items: [
          { kind: 'text', html: escapeHtml(replay.trackName), big: true },
          field(
            S.result,
            result(replay) + (replay.outcome === Outcome.Finished && replay.wheelie ? ` - ${S.wheelie}` : ''),
          ),
          field(S.league, LEAGUE_NAMES[replay.league] ?? ''),
          field(S.levels, `${replay.packName} - ${LEVEL_NAMES[replay.level] ?? ''}`),
          field(S.rider, replay.player),
          field(S.date, when(replay.date)),
          { kind: 'space', size: 10 },
          {
            kind: 'action',
            label: S.delete,
            run: () => {
              void this.store.delete(replay.id);
              this.replays = this.replays.filter((other) => other.id !== replay.id);
              this.host.open(this.listScreen);
            },
          },
          { kind: 'action', label: S.back, run: back },
        ],
      };
    };
  }
}
