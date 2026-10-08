import { TICK_MILLISECONDS } from '../core/sim';
import { dayLabel } from '../daily/daily';
import { type CardSize, canvasBlob, drawCard } from '../export/card';
import { Film, type FilmSource } from '../export/film';
import { gifSpeed, renderGif } from '../export/gif';
import { encodeQr } from '../export/qr';
import { Outcome } from '../formats/replay';
import { formatScoreTime } from '../game/highscores';
import { LEAGUE_NAMES, LEVEL_NAMES } from '../game/progress';
import type { SceneOptions } from '../render/scene';
import type { Sprites } from '../render/sprites';
import type { MenuItem, MenuScreen } from '../ui/menu/view';
import { STRINGS as S } from '../ui/strings';
import { COMFORTABLE_LINK_LENGTH, encodeLink } from './share';
import { personalBests, type ReplayStore, type StoredReplay } from './store';

type ScreenBuilder = () => MenuScreen;

export interface ReplaysHost {
  open(builder: ScreenBuilder): void;
  readonly parent: ScreenBuilder;
  /** Plays a run, then returns to `back`. */
  watch(replay: StoredReplay, back: ScreenBuilder): void;
  /** Starts the track of a run with that run as the ghost. */
  race(replay: StoredReplay, back: ScreenBuilder): void;
  /** One of the player's runs has been sent somewhere. */
  shared(): void;
  /** The pack and track chosen in the Play menu, for the filters. */
  selected(): { packId: string; level: number; track: number };
  /** Takes in a replay file from outside. */
  importReplay(bytes: Uint8Array): void;
  /** Address that replay links are built on. */
  readonly shareBaseUrl: string;
  /** Address of the short link service, if there is one. */
  readonly shortLinkApi: string | null;
  /** What is needed to draw a run away from the screen, or the reason it cannot be drawn. */
  exportSource(replay: StoredReplay): Promise<ExportSource | string>;
  readonly sprites: Sprites;
  /** Address of the logo image. */
  readonly logoUrl: string;
  /** The player's graphics options. */
  sceneOptions(): SceneOptions;
}

export interface ExportSource {
  film: FilmSource;
  packName: string;
  packAuthor: string;
}

/** The link service takes no larger picture. */
const MAX_PREVIEW_BYTES = 400 * 1024;
const GIF_SIZES = [
  [320, 180],
  [480, 270],
  [640, 360],
] as const;
/** The view of the animation in dp, whatever its size in pixels. */
const GIF_VIEW = 270;
/** Length of the "first" and "last" parts of a run, in ticks. */
const GIF_PART_TICKS = Math.round(10_000 / TICK_MILLISECONDS);
/** A link longer than this makes a code too fine to read off a picture. */
const QR_LINK_VERSION = 15;
const cardDay = (day: number) =>
  new Date(day * 86_400_000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load ${url}`));
    image.src = url;
  });
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const fileName = (replay: StoredReplay) =>
  `${replay.trackName} ${result(replay)}`.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'replay';

/** Runs listed at once; the rest come with "Load more". */
const PAGE = 50;

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const field = (label: string, value: string): MenuItem => ({
  kind: 'text',
  html: `<span class="menu-dim">${label}:</span> ${escapeHtml(value)}`,
});
const when = (milliseconds: number) =>
  new Date(milliseconds).toLocaleString(S.locale, {
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
  /** Set while a GIF is being rendered; aborting it cancels the rendering. */
  private rendering: AbortController | null = null;
  private shown = PAGE;
  private filter = 0;
  private gifSize = 1;
  private gifPart = 0;

  constructor(
    private readonly host: ReplaysHost,
    private readonly store: ReplayStore,
  ) {}

  /** The runs that are the fastest finish on their track and league. */
  private get best(): Set<string> {
    return personalBests(this.replays);
  }

  async openList(): Promise<void> {
    this.replays = await this.store.list();
    this.shown = PAGE;
    this.host.open(this.listScreen);
  }

  private readonly listScreen: ScreenBuilder = () => {
    const back = () => this.host.open(this.host.parent);
    const items: MenuItem[] = [];
    if (this.replays.length === 0) items.push({ kind: 'text', html: S.noRuns });
    else {
      items.push({
        kind: 'option',
        label: S.show,
        options: S.runFilters,
        value: this.filter,
        change: (value) => {
          this.filter = value;
          this.shown = PAGE;
          this.host.open(this.listScreen);
        },
      });
    }
    const selected = this.host.selected();
    const here = (replay: StoredReplay) => replay.packId === selected.packId;
    const keep: ((replay: StoredReplay) => boolean)[] = [
      () => true,
      (replay) => replay.outcome === Outcome.Finished,
      (replay) => this.best.has(replay.id),
      here,
      (replay) => here(replay) && replay.level === selected.level && replay.track === selected.track,
    ];
    const replays = this.replays.filter(keep[this.filter] ?? (() => true));
    if (this.replays.length > 0 && replays.length === 0) items.push({ kind: 'text', html: S.nothingFound });
    for (const replay of replays.slice(0, this.shown)) {
      const best = this.best.has(replay.id) ? ` - ${S.personalBest}` : '';
      items.push({
        kind: 'action',
        label: `${replay.trackName} - ${LEAGUE_NAMES[replay.league] ?? ''} - ${result(replay)}${best}`,
        run: () => this.host.open(this.replayScreen(replay)),
      });
    }
    if (replays.length > this.shown) {
      items.push({
        kind: 'action',
        label: S.loadMore(replays.length - this.shown),
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
            result(replay) +
              (replay.outcome === Outcome.Finished && replay.wheelie ? ` - ${S.wheelie}` : '') +
              (this.best.has(replay.id) ? ` - ${S.personalBest}` : ''),
          ),
          field(S.league, LEAGUE_NAMES[replay.league] ?? ''),
          field(S.levels, `${replay.packName} - ${LEVEL_NAMES[replay.level] ?? ''}`),
          field(S.rider, replay.player),
          field(S.date, when(replay.date)),
          ...(replay.daily === undefined ? [] : [field(S.daily, dayLabel(replay.daily))]),
          { kind: 'space', size: 10 },
          { kind: 'action', label: S.watch, run: () => this.host.watch(replay, self) },
          { kind: 'action', label: S.race, run: () => this.host.race(replay, self) },
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

  /** Opens the sharing options of a run from elsewhere in the menus. */
  share(replay: StoredReplay, back: ScreenBuilder): void {
    this.host.open(this.shareScreen(replay, back, ''));
  }

  // ---- sharing ----------------------------------------------------------------------------

  private shareScreen(replay: StoredReplay, parent: ScreenBuilder, status: string): ScreenBuilder {
    return () => {
      const back = () => {
        this.rendering?.abort();
        this.host.open(parent);
      };
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
                this.host.shared();
                say(S.linkCopied(url.length) + (url.length > COMFORTABLE_LINK_LENGTH ? ` ${S.linkLong}` : ''));
              })
              .catch(() => say(S.linkNotCopied)),
        },
      ];
      items.push({
        kind: 'action',
        label: S.copyEmbed,
        run: () =>
          void link()
            .then(async (url) => {
              const src = url.replace('#', '?embed=1#');
              await navigator.clipboard.writeText(
                `<iframe src="${src}" width="640" height="400" style="border:0" allowfullscreen></iframe>`,
              );
              say(S.embedCopied);
            })
            .catch(() => say(S.linkNotCopied)),
      });
      if (this.host.shortLinkApi) {
        items.push({
          kind: 'action',
          label: S.copyShortLink,
          run: () =>
            void this.shortLink(replay)
              .then(async (url) => {
                await navigator.clipboard.writeText(url);
                say(S.shortLinkCopied(url));
              })
              .catch(() => say(S.shortLinkFailed)),
        });
      }
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
      const image = (size: CardSize, copy: boolean) => () =>
        void this.card(replay, size)
          .then(async (blob) => {
            if (typeof blob === 'string') return say(blob);
            if (!copy) {
              download(blob, `${fileName(replay)}.png`);
              this.host.shared();
              return say(S.imageSaved);
            }
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            say(S.imageCopied);
          })
          .catch(() => say(S.exportFailed));
      items.push(
        { kind: 'action', label: S.saveImage, run: image('wide', false) },
        { kind: 'action', label: S.saveSquareImage, run: image('square', false) },
      );
      if (typeof ClipboardItem !== 'undefined') {
        items.push({ kind: 'action', label: S.copyImage, run: image('wide', true) });
      }
      items.push(
        {
          kind: 'option',
          label: S.gifSize,
          options: GIF_SIZES.map(([width, height]) => `${width}x${height}`),
          value: this.gifSize,
          change: (value) => {
            this.gifSize = value;
            say(status);
          },
        },
        {
          kind: 'option',
          label: S.gifPart,
          options: S.gifParts,
          value: this.gifPart,
          change: (value) => {
            this.gifPart = value;
            say(status);
          },
        },
        { kind: 'action', label: S.saveGif, run: () => void this.gif(replay, say) },
        { kind: 'action', label: S.saveFile, run: () => this.saveFile(replay) },
        { kind: 'action', label: S.back, run: back },
      );
      return { title: S.share, back, items };
    };
  }

  private saveFile(replay: StoredReplay): void {
    download(
      new Blob([Uint8Array.from(replay.bytes)], { type: 'application/octet-stream' }),
      `${fileName(replay)}.gdr`,
    );
  }

  /**
   * Asks the link service for a short address of a run. The result card goes along, so that the
   * link shows a picture of the run where it is posted.
   */
  private async shortLink(replay: StoredReplay): Promise<string> {
    const base64 = (bytes: Uint8Array) => {
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    };
    const body: { replay: string; image?: string } = { replay: base64(replay.bytes) };
    try {
      const card = await this.card(replay, 'wide');
      if (typeof card !== 'string' && card.size <= MAX_PREVIEW_BYTES) {
        body.image = base64(new Uint8Array(await card.arrayBuffer()));
      }
    } catch {
      // The link works without a picture.
    }
    const response = await fetch(`${this.host.shortLinkApi?.replace(/\/$/, '')}/api/links`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`The link service answered ${response.status}`);
    const { url } = (await response.json()) as { url?: unknown };
    if (typeof url !== 'string' || !/^https:\/\//.test(url)) throw new Error('The link service gave no link');
    return url;
  }

  /** The result card of a run as a PNG, or the reason there is none. */
  private async card(replay: StoredReplay, size: CardSize): Promise<Blob | string> {
    const source = await this.host.exportSource(replay);
    if (typeof source === 'string') return source;
    const film = new Film(this.host.sprites, source.film, { ...this.host.sceneOptions(), dimmed: false }, 300);
    // The code leads to the replay itself while its link is short enough, and to the game otherwise.
    const text = new TextEncoder();
    const link = await encodeLink(this.host.shareBaseUrl, Uint8Array.from(replay.bytes)).catch(() => '');
    const qr = (link && encodeQr(text.encode(link), QR_LINK_VERSION)) || encodeQr(text.encode(this.host.shareBaseUrl));
    const canvas = drawCard(
      film,
      await loadImage(this.host.logoUrl),
      {
        result: result(replay),
        track: replay.trackName,
        category: `${LEVEL_NAMES[replay.level] ?? ''} - ${LEAGUE_NAMES[replay.league] ?? ''}`,
        pack: source.packAuthor ? `${source.packName} by ${source.packAuthor}` : source.packName,
        player: replay.player,
        date: new Date(replay.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
        wheelie: replay.outcome === Outcome.Finished && replay.wheelie,
        site: this.host.shareBaseUrl
          .replace(/^https?:\/\//, '')
          .replace(/[#?].*$/, '')
          .replace(/\/$/, ''),
        daily: replay.daily === undefined ? null : cardDay(replay.daily),
        qr,
      },
      size,
    );
    return canvasBlob(canvas);
  }

  private async gif(replay: StoredReplay, say: (text: string) => void): Promise<void> {
    if (this.rendering) return;
    const source = await this.host.exportSource(replay);
    if (typeof source === 'string') {
      say(source);
      return;
    }
    const rendering = new AbortController();
    this.rendering = rendering;
    try {
      const options = { ...this.host.sceneOptions(), dimmed: false };
      const [width, height] = GIF_SIZES[this.gifSize] ?? GIF_SIZES[1];
      const film = new Film(this.host.sprites, source.film, options, GIF_VIEW);
      const from = this.gifPart === 2 ? Math.max(0, film.length - GIF_PART_TICKS) : 0;
      const to = this.gifPart === 1 ? Math.min(film.length, GIF_PART_TICKS) : film.length;
      const speed = gifSpeed((to - from) * TICK_MILLISECONDS);
      say(S.gifRendering(0));
      const blob = await renderGif(film, {
        width,
        height,
        speed,
        from,
        to,
        caption: `${replay.trackName} - ${LEAGUE_NAMES[replay.league] ?? ''} - ${source.packName} - ${speed}x`,
        paletteSample: new Film(this.host.sprites, source.film, options, GIF_VIEW),
        signal: rendering.signal,
        onProgress: (done) => say(S.gifRendering(Math.round(done * 100))),
      });
      download(blob, `${fileName(replay)}.gif`);
      this.host.shared();
      say(S.gifSaved((blob.size / 1024 / 1024).toFixed(1)));
    } catch (error) {
      // Leaving the screen cancels the rendering; there is nobody left to tell.
      if (!rendering.signal.aborted) {
        console.warn(error);
        say(S.exportFailed);
      }
    } finally {
      this.rendering = null;
    }
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
