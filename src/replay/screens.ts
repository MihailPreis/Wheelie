import { Outcome } from '../formats/replay';
import { formatScoreTime } from '../game/highscores';
import { LEAGUE_NAMES, LEVEL_NAMES } from '../game/progress';
import type { MenuItem, MenuScreen } from '../ui/menu/view';
import { STRINGS as S } from '../ui/strings';
import { COMFORTABLE_LINK_LENGTH, encodeLink } from './share';
import type { ReplayStore, StoredReplay } from './store';

type ScreenBuilder = () => MenuScreen;

export interface ReplaysHost {
  open(builder: ScreenBuilder): void;
  readonly parent: ScreenBuilder;
  /** Plays a run, then returns to `back`. */
  watch(replay: StoredReplay, back: ScreenBuilder): void;
  /** Takes in a replay file from outside. */
  importReplay(bytes: Uint8Array): void;
  /** Address that replay links are built on. */
  readonly shareBaseUrl: string;
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
    items.push({ kind: 'action', label: S.openReplayFile, run: () => this.pickFile() });
    items.push({ kind: 'action', label: S.back, run: back });
    return { title: S.myRuns, back, items };
  };

  private replayScreen(replay: StoredReplay): ScreenBuilder {
    const self: ScreenBuilder = () => {
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
          { kind: 'action', label: S.watch, run: () => this.host.watch(replay, self) },
          { kind: 'action', label: S.share, run: () => this.host.open(this.shareScreen(replay, self, '')) },
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
    return self;
  }

  // ---- sharing ----------------------------------------------------------------------------

  private shareScreen(replay: StoredReplay, parent: ScreenBuilder, status: string): ScreenBuilder {
    return () => {
      const back = () => this.host.open(parent);
      const say = (text: string) => this.host.open(this.shareScreen(replay, parent, text));
      const link = () => encodeLink(this.host.shareBaseUrl, Uint8Array.from(replay.bytes));
      const items: MenuItem[] = [
        { kind: 'text', html: escapeHtml(`${replay.trackName} - ${result(replay)}`), big: true },
        { kind: 'text', html: status || '&nbsp;' },
        {
          kind: 'action',
          label: S.copyLink,
          run: () =>
            void link()
              .then(async (url) => {
                await navigator.clipboard.writeText(url);
                say(S.linkCopied(url.length) + (url.length > COMFORTABLE_LINK_LENGTH ? ` ${S.linkLong}` : ''));
              })
              .catch(() => say(S.linkNotCopied)),
        },
      ];
      if (typeof navigator.share === 'function') {
        items.push({
          kind: 'action',
          label: S.shareVia,
          run: () =>
            void link()
              // Dismissing the share sheet is not an error worth reporting.
              .then((url) => navigator.share({ title: S.shareText(replay.trackName, result(replay)), url }))
              .catch(() => undefined),
        });
      }
      items.push(
        { kind: 'action', label: S.saveFile, run: () => this.saveFile(replay) },
        { kind: 'action', label: S.back, run: back },
      );
      return { title: S.share, back, items };
    };
  }

  private saveFile(replay: StoredReplay): void {
    const name = `${replay.trackName} ${result(replay)}`.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
    const url = URL.createObjectURL(new Blob([Uint8Array.from(replay.bytes)], { type: 'application/octet-stream' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${name || 'replay'}.gdr`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  private pickFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.gdr';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) void file.arrayBuffer().then((buffer) => this.host.importReplay(new Uint8Array(buffer)));
    });
    input.click();
  }
}
