import type { Music } from './audio/music';
import type { Sound } from './audio/sound';
import { PHYSICS_VERSION } from './core/version';
import { decodeReplay, encodeReplay, hashTrack, MAX_REPLAY_BYTES, Outcome, type Replay } from './formats/replay';
import type { Game, RecordedRun, RunResult, Track } from './game/game';
import { GamepadNavigator } from './game/gamepad-nav';
import {
  addScore,
  clearScores,
  formatScoreTime,
  loadScores,
  PLACES,
  placeOf,
  saveScores,
  type TrackScores,
} from './game/highscores';
import type { Input } from './game/input';
import {
  availableLeagues,
  canStart,
  completedCount,
  completeTrack,
  isCheatName,
  LEAGUE_NAMES,
  LEVEL_NAMES,
  loadProgress,
  type Progress,
  saveProgress,
  unlockEverything,
} from './game/progress';
import { loadSettings, normalizeName, type Settings, saveSettings } from './game/settings';
import type { Library } from './mods/library';
import { ORIGINAL_PACK_ID, type Pack } from './mods/pack';
import { ModsScreens, type ScreenBuilder } from './mods/screens';
import type { PlayerControls } from './player/controls';
import { ReplayScreens } from './replay/screens';
import { decodeFragment, isReplayFragment } from './replay/share';
import { verifyReplay } from './replay/simulate';
import type { ReplayStore, StoredReplay } from './replay/store';
import { removeAll, writeJson } from './storage/store';
import type { Keypad } from './ui/keypad';
import type { MenuItem, MenuKey, MenuView } from './ui/menu/view';
import { STRINGS as S } from './ui/strings';

/** Three seconds of riding; shorter unfinished runs are not kept. */
const MIN_UNFINISHED_TICKS = 200;

/** Where the identifier of the pack being played is remembered. */
export const ACTIVE_PACK_KEY = 'activePack';

const ON_OFF = [S.on, S.off] as const;
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** Keys that drive the menus, by `KeyboardEvent.code`. The digits follow the original's phone keypad. */
const MENU_KEYS: Readonly<Record<string, MenuKey>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
  Digit2: 'up',
  Digit8: 'down',
  Digit4: 'left',
  Digit6: 'right',
  Digit5: 'fire',
  Numpad2: 'up',
  Numpad8: 'down',
  Numpad4: 'left',
  Numpad6: 'right',
  Numpad5: 'fire',
  Enter: 'fire',
  NumpadEnter: 'fire',
  Space: 'fire',
  Escape: 'back',
  Backspace: 'back',
};
const KEYPAD_KEYS: Readonly<Record<number, MenuKey>> = { 2: 'up', 8: 'down', 4: 'left', 6: 'right', 5: 'fire' };
const PAUSE_KEYS = new Set(['Escape', 'KeyP']);

/**
 * Ties the menus to the game: which screen is up, what happens when a run ends, what the player
 * has unlocked. The flow follows `Menu/Menu.java` of the original.
 */
export class App {
  private readonly settings: Settings = loadSettings();
  private progress: Progress;
  private trackCounts: number[];
  private readonly mods: ModsScreens;
  private readonly replays: ReplayScreens;
  private readonly padNavigator = new GamepadNavigator();

  private current: ScreenBuilder | null = null;
  /** What is being ridden, or was last. */
  private level = 0;
  private track = 0;
  private playing = false;
  /** A replay is on screen. */
  private watching = false;
  /** The run that has just ended, once it has been saved. */
  private lastRun: Promise<StoredReplay | null> = Promise.resolve(null);

  constructor(
    private pack: Pack,
    private readonly original: Pack,
    library: Library,
    private readonly replayStore: ReplayStore,
    baseUrl: string,
    shareBaseUrl: string,
    private readonly game: Game,
    private readonly input: Input,
    private readonly keypad: Keypad,
    private readonly menu: MenuView,
    private readonly music: Music,
    private readonly sound: Sound,
    private readonly menuButton: HTMLElement,
    private readonly controls: PlayerControls,
    private readonly onLayout: () => void,
    private readonly onReset: () => void,
  ) {
    this.trackCounts = pack.levels.map((level) => level.length);
    this.progress = loadProgress(pack.id, this.trackCounts);
    if (isCheatName(this.settings.name)) unlockEverything(this.progress, this.trackCounts);
    this.applySettings();
    this.mods = new ModsScreens(
      {
        open: (builder) => this.open(builder),
        alert: (title, text, then) => this.alert(title, text, then),
        parent: this.mainMenu,
        activePackId: () => this.pack.id,
        usePack: (next) => this.usePack(next),
        forgetPack: (id) => {
          clearScores(id);
          removeAll(`progress.${id}`);
        },
      },
      library,
      baseUrl,
      original,
    );

    this.replays = new ReplayScreens(
      {
        open: (builder) => this.open(builder),
        parent: this.mainMenu,
        watch: (replay, back) => void this.watch(replay, back),
        importReplay: (bytes) => void this.importReplay(bytes),
        shareBaseUrl,
      },
      replayStore,
    );
    controls.onClose = () => this.stopWatching();

    game.onFinish = (result) => this.finished(result);
    game.onRun = (run) => this.recordRun(run);
    input.onDeviceChange = () => this.updateKeypad();
    keypad.onPress = (digit) => {
      const key = KEYPAD_KEYS[digit];
      if (key && this.menu.visible) this.menuKey(key);
    };
    menuButton.addEventListener('click', () => this.pause());
    requestAnimationFrame(this.pollGamepad);
  }

  // ---- plumbing ---------------------------------------------------------------------------

  private applySettings(): void {
    const s = this.settings;
    this.game.options.perspective = s.perspective;
    this.game.options.shadows = s.shadows;
    this.game.options.driverSprite = s.driverSprite;
    this.game.options.bikeSprite = s.bikeSprite;
    this.game.lookAhead = s.lookAhead;
    this.input.keyset = s.keyset;
    this.keypad.vibrate = s.vibrate;
    if (this.music.enabled !== s.music) this.music.enabled = s.music;
    this.sound.enabled = s.sound;
    this.updateKeypad();
  }

  private saveSettings(): void {
    saveSettings(this.settings);
    this.applySettings();
  }

  /** Switches to another level pack, with its own progress and scores, and shows its tracks. */
  private usePack(pack: Pack): void {
    this.pack = pack;
    this.trackCounts = pack.levels.map((level) => level.length);
    this.progress = loadProgress(pack.id, this.trackCounts);
    if (isCheatName(this.settings.name)) unlockEverything(this.progress, this.trackCounts);
    writeJson(ACTIVE_PACK_KEY, pack.id);
    this.showFrontMenu(this.playMenu);
  }

  private saveProgress(): void {
    saveProgress(this.pack.id, this.progress);
  }

  /** The keypad shows on touch devices: always while riding, and in the menus if the option says so. */
  private updateKeypad(): void {
    const touch = this.input.device === 'touch';
    this.keypad.visible = touch && !this.watching && (this.playing || this.settings.keypadInMenu);
    this.menuButton.hidden = !this.playing || this.menu.visible || this.watching;
    this.onLayout();
  }

  private open(builder: ScreenBuilder): void {
    this.current = builder;
    this.menu.show(builder());
  }

  /** Rebuilds the screen that is up after something on it changed. */
  private refresh(): void {
    if (this.current) this.menu.show(this.current(), true);
  }

  private menuKey(key: MenuKey): void {
    this.music.unlock();
    if (key === 'fire' || key === 'back') this.sound.menuSelect();
    else this.sound.menuMove();
    this.menu.key(key);
  }

  /** Handles a key press. Returns true if the key was used. */
  keyDown(event: KeyboardEvent): boolean {
    this.music.unlock();
    if (this.watching) return this.controls.key(event);
    if (this.menu.visible) {
      if (event.key.length === 1 && this.menu.typeLetter(event.key)) return true;
      const key = MENU_KEYS[event.code];
      if (!key) return false;
      // Holding a key repeats movement but not selection.
      if (event.repeat && (key === 'fire' || key === 'back')) return true;
      this.menuKey(key);
      return true;
    }
    if (event.repeat) return this.input.keyDown(event.code);
    if (PAUSE_KEYS.has(event.code)) {
      this.pause();
      return true;
    }
    return this.input.keyDown(event.code);
  }

  private readonly pollGamepad = (now: number): void => {
    for (const action of this.padNavigator.poll(now)) {
      if (this.watching) {
        this.controls.pad(action);
        continue;
      }
      if (action === 'pause') {
        if (this.menu.visible) this.menu.key('back');
        else this.pause();
      } else if (this.menu.visible) {
        this.menuKey(action);
      }
    }
    requestAnimationFrame(this.pollGamepad);
  };

  /** The page went to the background: a run in progress is paused rather than left to crash. */
  hidden(): void {
    this.input.release();
    if (this.watching) this.game.paused = true;
    else if (this.playing && !this.menu.visible) this.pause();
  }

  private trackAt(level: number, track: number): Track | undefined {
    return this.pack.levels[level]?.[track];
  }

  private trackName(level: number, track: number): string {
    return this.trackAt(level, track)?.name ?? '---';
  }

  private get selectedTrack(): number {
    return this.progress.selectedTracks[this.progress.selectedLevel] ?? 0;
  }

  // ---- game states ------------------------------------------------------------------------

  /** Covers the scene with a menu. */
  private showMenu(builder: ScreenBuilder): void {
    this.game.hud = false;
    this.game.options.dimmed = true;
    this.input.release();
    this.open(builder);
    this.updateKeypad();
  }

  /** The menus outside a run, with the demo rider on the selected track behind them. */
  private showFrontMenu(builder: ScreenBuilder): void {
    this.playing = false;
    this.game.paused = false;
    this.loadDemo();
    this.showMenu(builder);
  }

  private loadDemo(): void {
    const track = this.trackAt(this.progress.selectedLevel, this.selectedTrack) ?? this.trackAt(0, 0);
    if (!track) return;
    try {
      this.game.load(track, Math.min(this.progress.selectedLeague, 3), true);
    } catch {
      // A damaged track simply has no demo.
    }
  }

  start(): void {
    this.showFrontMenu(this.mainMenu);
  }

  private play(level: number, track: number): void {
    const data = this.trackAt(level, track);
    if (!data) return;
    try {
      this.game.load(data, this.progress.selectedLeague);
    } catch {
      // Some community packs contain a track that cannot be loaded. It counts as passed, or the
      // tracks behind it could never be unlocked.
      completeTrack(this.progress, level, track, this.trackCounts);
      this.saveProgress();
      this.alert(S.playMenu, S.damagedTrack, () => this.open(this.playMenu));
      return;
    }
    this.level = level;
    this.track = track;
    this.playing = true;
    this.game.paused = false;
    this.game.hud = true;
    this.game.options.dimmed = false;
    this.menu.hide();
    this.current = null;
    this.updateKeypad();
  }

  private pause(): void {
    if (!this.playing || this.menu.visible || !this.game.riding) return;
    this.game.paused = true;
    this.showMenu(this.ingameMenu);
  }

  private resume(): void {
    this.menu.hide();
    this.current = null;
    this.game.paused = false;
    this.game.hud = true;
    this.game.options.dimmed = false;
    this.updateKeypad();
  }

  /** Keeps a run as a replay, once riding it again has been seen to end the same way. */
  private recordRun(run: RecordedRun): void {
    const track = this.trackAt(this.level, this.track);
    // A run given up within the first seconds is not worth a place in the list.
    if (!track || (run.outcome !== Outcome.Finished && run.inputs.length < MIN_UNFINISHED_TICKS)) return;
    const date = Date.now();
    const replay: Replay = {
      physicsVersion: PHYSICS_VERSION,
      packId: this.pack.id,
      level: this.level,
      track: this.track,
      league: this.game.league,
      trackHash: hashTrack(track.data),
      trackName: track.name,
      player: this.settings.name,
      date: Math.floor(date / 1000),
      outcome: run.outcome,
      wheelie: run.wheelie,
      time: run.time,
      finalHash: run.finalHash,
      inputs: run.inputs,
      // Tracks from the player's own files exist nowhere else, so they travel with the replay.
      trackData: this.pack.id.startsWith('file-') ? track.data : null,
    };
    if (!verifyReplay(track.data, replay)) {
      console.warn('A run could not be reproduced and was not saved.');
      this.lastRun = Promise.resolve(null);
      return;
    }
    this.lastRun = this.replayStore.add({
      bytes: encodeReplay(replay),
      packId: replay.packId,
      packName: this.pack.name,
      level: replay.level,
      track: replay.track,
      league: replay.league,
      trackName: replay.trackName,
      player: replay.player,
      date,
      outcome: replay.outcome,
      wheelie: replay.wheelie,
      time: replay.time,
    });
  }

  // ---- watching a replay ------------------------------------------------------------------

  /** The track a replay was made on, or the reason it cannot be shown. */
  private async trackFor(replay: Replay): Promise<{ track: Track; packName: string } | string> {
    if (replay.physicsVersion !== PHYSICS_VERSION) return S.replayOtherVersion;
    if (replay.trackData) {
      if (hashTrack(replay.trackData) !== replay.trackHash) return S.replayDamaged;
      return { track: { name: replay.trackName, data: replay.trackData }, packName: S.ownLevels };
    }
    let pack: Pack | null = null;
    if (replay.packId === this.pack.id) pack = this.pack;
    else if (replay.packId === ORIGINAL_PACK_ID) pack = this.original;
    // A pack of the bundled catalogue is installed on the spot if it is not there yet.
    else pack = await this.mods.obtain(replay.packId);
    const track = pack?.levels[replay.level]?.[replay.track];
    if (!pack || !track) return S.replayNoPack;
    return hashTrack(track.data) === replay.trackHash ? { track, packName: pack.name } : S.replayChangedTrack;
  }

  /** Plays a saved run; `back` is the screen to return to afterwards. */
  private async watch(stored: StoredReplay, back: ScreenBuilder): Promise<void> {
    const fail = (text: string) => this.alert(S.myRuns, text, () => this.open(back));
    let replay: Replay;
    try {
      replay = decodeReplay(stored.bytes);
    } catch {
      fail(S.replayDamaged);
      return;
    }
    const found = await this.trackFor(replay);
    if (typeof found === 'string') fail(found);
    else this.startWatching(replay, found.track, back, fail);
  }

  private startWatching(replay: Replay, track: Track, back: ScreenBuilder, fail: (text: string) => void): void {
    try {
      this.game.watch(track, replay.league, { inputs: replay.inputs, finishTime: replay.time });
    } catch {
      fail(S.replayDamaged);
      return;
    }
    this.watching = true;
    this.afterWatching = back;
    this.playing = false;
    this.game.paused = false;
    this.game.hud = true;
    this.game.options.dimmed = false;
    this.menu.hide();
    this.current = null;
    this.controls.show();
    this.updateKeypad();
  }

  /**
   * Takes in a replay from outside — a file or a link. It is checked by riding it again, kept
   * with the player's own runs and played.
   */
  async importReplay(bytes: Uint8Array): Promise<void> {
    if (this.playing && !this.menu.visible) return;
    const back: ScreenBuilder = () => this.mainMenu();
    const fail = (text: string) => this.alert(S.myRuns, text, () => this.open(back));
    this.open(() => ({ title: S.myRuns, back: null, items: [{ kind: 'text', html: S.openingReplay }] }));
    let replay: Replay;
    try {
      replay = decodeReplay(bytes);
    } catch {
      fail(S.replayDamaged);
      return;
    }
    const found = await this.trackFor(replay);
    if (typeof found === 'string') {
      fail(found);
      return;
    }
    if (!verifyReplay(found.track.data, replay)) {
      fail(S.replayDamaged);
      return;
    }
    const known = (await this.replayStore.list()).some(
      (stored) => stored.bytes.length === bytes.length && stored.bytes.every((byte, index) => byte === bytes[index]),
    );
    if (!known) {
      await this.replayStore.add({
        bytes,
        packId: replay.packId,
        packName: found.packName,
        level: replay.level,
        track: replay.track,
        league: replay.league,
        trackName: replay.trackName,
        player: replay.player,
        date: replay.date * 1000,
        outcome: replay.outcome,
        wheelie: replay.wheelie,
        time: replay.time,
      });
    }
    this.startWatching(replay, found.track, back, fail);
  }

  /** Opens the replay carried by a link's fragment, if there is one. */
  async openLink(fragment: string): Promise<void> {
    if (!isReplayFragment(fragment)) return;
    try {
      await this.importReplay(await decodeFragment(fragment));
    } catch {
      this.alert(S.myRuns, S.replayDamaged, () => this.open(this.mainMenu));
    }
  }

  /** A file was dropped on the page: a replay is played, anything else is taken for a level pack. */
  async openFile(file: File): Promise<void> {
    if (this.playing && !this.menu.visible) return;
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (head[0] === 0x47 && head[1] === 0x44 && head[2] === 0x52 && head[3] === 0x1a) {
      if (file.size <= MAX_REPLAY_BYTES) await this.importReplay(new Uint8Array(await file.arrayBuffer()));
      else this.alert(S.myRuns, S.replayDamaged, () => this.open(this.mainMenu));
    } else {
      await this.mods.installFile(file);
    }
  }

  private afterWatching: ScreenBuilder | null = null;

  private stopWatching(): void {
    if (!this.watching) return;
    this.watching = false;
    this.controls.hide();
    this.showFrontMenu(this.afterWatching ?? this.mainMenu);
  }

  /** A tap or click on the picture itself. */
  sceneTap(): void {
    if (this.watching) this.controls.tap();
  }

  // ---- finishing a run --------------------------------------------------------------------

  private finished(result: RunResult): void {
    const time = Math.floor(result.time / 10);
    const league = this.progress.selectedLeague;
    const scores = loadScores(this.pack.id, this.level, this.track);
    const place = placeOf(scores, league, time);
    if (place >= PLACES) {
      this.completed(scores, time);
      return;
    }

    // A time that makes the table: announce it and offer to change the name first.
    const record: ScreenBuilder = () => ({
      title: S.finished,
      back: null,
      items: [
        { kind: 'text', html: S.places[place] ?? '', big: true, medal: place },
        { kind: 'text', html: formatScoreTime(time) },
        {
          kind: 'action',
          label: S.ok,
          run: () => {
            addScore(scores, league, this.settings.name, time);
            saveScores(this.pack.id, this.level, this.track, scores);
            this.completed(scores, time);
          },
        },
        {
          kind: 'action',
          label: `${S.name} - ${this.settings.name}`,
          run: () =>
            this.menu.showNameInput(S.enterName, this.settings.name, (name) => {
              this.settings.name = normalizeName(name);
              this.saveSettings();
              if (isCheatName(this.settings.name)) {
                unlockEverything(this.progress, this.trackCounts);
                this.saveProgress();
              }
              this.open(record);
            }),
        },
      ],
    });
    this.showMenu(record);
  }

  /** `Menu.saveCompletedTrack`: unlocks what the run earned and shows the result. */
  private completed(scores: TrackScores, time: number): void {
    const { level, track } = this;
    const league = this.progress.selectedLeague;
    const leagues = availableLeagues(this.progress);
    const outcome = completeTrack(this.progress, level, track, this.trackCounts);
    this.saveProgress();

    const items: MenuItem[] = [{ kind: 'text', html: `<b>${S.time}</b>: ${formatScoreTime(time)}` }];
    (scores[league] ?? []).forEach((score, place) => {
      items.push({ kind: 'text', html: `${place + 1}. ${escapeHtml(score.name)} ${formatScoreTime(score.time)}` });
    });
    items.push({
      kind: 'text',
      html: S.tracksCompleted(
        completedCount(this.progress, level, this.trackCounts),
        this.trackCounts[level] ?? 0,
        LEVEL_NAMES[level] ?? '',
      ),
    });

    const unlocked = outcome.leagueUnlocked;
    if (unlocked !== null) {
      const name = LEAGUE_NAMES[unlocked] ?? leagues[unlocked] ?? '';
      items.push({ kind: 'text', html: S.congratulations + name });
      if (unlocked === 3) items.push({ kind: 'text', html: S.enjoy });
    } else if (outcome.levelCompleted && !outcome.everythingCompleted) {
      items.push({ kind: 'text', html: S.levelCompleted });
    }
    if (!outcome.levelCompleted) {
      items.push({
        kind: 'action',
        label: `${S.next}: ${this.trackName(level, track + 1)}`,
        run: () => this.play(level, track + 1),
      });
    }
    items.push({
      kind: 'action',
      label: `${S.restart}: ${this.trackName(level, track)}`,
      run: () => this.play(level, track),
    });
    const screen: ScreenBuilder = () => ({ title: S.finished, back: null, items });
    items.push({
      kind: 'action',
      label: S.watchReplay,
      run: () =>
        void this.lastRun.then((run) => {
          if (run) void this.watch(run, screen);
        }),
    });
    items.push({ kind: 'action', label: S.playMenu, run: () => this.showFrontMenu(this.playMenu) });

    this.showMenu(screen);
    if (unlocked !== null) {
      this.alert(S.leagueUnlocked, S.leagueUnlockedText + (LEAGUE_NAMES[unlocked] ?? ''), () => this.open(screen));
    }
  }

  // ---- screens ----------------------------------------------------------------------------

  private alert(title: string, text: string, then: () => void): void {
    this.open(() => ({
      title,
      back: then,
      items: [
        { kind: 'text', html: text },
        { kind: 'space', size: 10 },
        { kind: 'action', label: S.ok, run: then },
      ],
    }));
  }

  private link(label: string, builder: ScreenBuilder): MenuItem {
    return { kind: 'action', label, run: () => this.open(builder) };
  }

  private readonly mainMenu: ScreenBuilder = () => ({
    title: S.main,
    back: null,
    items: [
      this.link(S.playMenu, this.playMenu),
      { kind: 'action', label: S.mods, run: () => this.open(this.mods.menu) },
      { kind: 'action', label: S.myRuns, run: () => void this.replays.openList() },
      this.link(S.options, this.optionsMenu(this.mainMenu)),
      this.link(S.help, this.helpMenu(this.mainMenu)),
      this.link(S.about, this.textScreen(S.about, S.aboutText, this.mainMenu)),
    ],
  });

  private readonly playMenu: ScreenBuilder = () => {
    const p = this.progress;
    const level = p.selectedLevel;
    const select = (change: () => void) => () => {
      change();
      this.saveProgress();
      this.loadDemo();
      this.refresh();
    };
    return {
      title: S.play,
      back: () => this.open(this.mainMenu),
      items: [
        {
          kind: 'action',
          label: `${S.start}>`,
          run: () => {
            if (canStart(p, level, this.selectedTrack, p.selectedLeague)) this.play(level, this.selectedTrack);
            else this.alert(S.play, S.completeToUnlock, () => this.open(this.playMenu));
          },
        },
        {
          kind: 'option',
          label: S.level,
          options: LEVEL_NAMES,
          value: level,
          unlocked: p.unlockedLevels,
          change: (value) =>
            select(() => {
              p.selectedLevel = value;
            })(),
        },
        {
          kind: 'option',
          label: S.track,
          options: (this.pack.levels[level] ?? []).map((track) => track.name),
          value: this.selectedTrack,
          unlocked: level <= p.unlockedLevels ? (p.unlockedTracks[level] ?? -1) : -1,
          change: (value) =>
            select(() => {
              p.selectedTracks[level] = value;
            })(),
        },
        {
          kind: 'option',
          label: S.league,
          options: availableLeagues(p),
          value: Math.min(p.selectedLeague, availableLeagues(p).length - 1),
          unlocked: p.unlockedLeagues,
          change: (value) =>
            select(() => {
              p.selectedLeague = value;
            })(),
        },
        this.link(S.highscores, this.highscoresScreen(p.selectedLeague)),
        { kind: 'action', label: S.goToMain, run: () => this.open(this.mainMenu) },
      ],
    };
  };

  private highscoresScreen(league: number): ScreenBuilder {
    return () => {
      const level = this.progress.selectedLevel;
      const track = this.selectedTrack;
      const scores = loadScores(this.pack.id, level, track)[league] ?? [];
      const back = () => this.open(this.playMenu);
      const items: MenuItem[] = [
        { kind: 'text', html: escapeHtml(this.trackName(level, track)), big: true },
        {
          kind: 'option',
          label: S.league,
          options: LEAGUE_NAMES,
          value: league,
          change: (value) => this.open(this.highscoresScreen(value)),
        },
      ];
      if (scores.length === 0) items.push({ kind: 'text', html: S.noHighscores });
      scores.forEach((score, place) => {
        items.push({
          kind: 'text',
          html: `${place + 1}. ${escapeHtml(score.name)} ${formatScoreTime(score.time)}`,
          medal: place,
        });
      });
      items.push({ kind: 'space', size: 10 }, { kind: 'action', label: S.back, run: back });
      return { title: S.highscores, back, items };
    };
  }

  private readonly ingameMenu: ScreenBuilder = () => ({
    title: S.ingame,
    back: () => this.resume(),
    items: [
      { kind: 'action', label: S.continue, run: () => this.resume() },
      {
        kind: 'action',
        label: `${S.restart}: ${this.trackName(this.level, this.track)}`,
        run: () => this.play(this.level, this.track),
      },
      this.link(S.options, this.optionsMenu(this.ingameMenu)),
      this.link(S.help, this.helpMenu(this.ingameMenu)),
      { kind: 'action', label: S.playMenu, run: () => this.showFrontMenu(this.playMenu) },
    ],
  });

  private optionsMenu(parent: ScreenBuilder): ScreenBuilder {
    const self: ScreenBuilder = () => {
      const s = this.settings;
      const toggle = (
        label: string,
        key:
          | 'perspective'
          | 'shadows'
          | 'driverSprite'
          | 'bikeSprite'
          | 'lookAhead'
          | 'vibrate'
          | 'keypadInMenu'
          | 'music'
          | 'sound',
      ): MenuItem => ({
        kind: 'option',
        label,
        options: ON_OFF,
        value: s[key] ? 0 : 1,
        toggle: true,
        change: (value) => {
          s[key] = value === 0;
          this.saveSettings();
          this.refresh();
        },
      });
      const back = () => this.open(parent);
      return {
        title: S.options,
        back,
        items: [
          toggle(S.perspective, 'perspective'),
          toggle(S.shadows, 'shadows'),
          toggle(S.driverSprite, 'driverSprite'),
          toggle(S.bikeSprite, 'bikeSprite'),
          {
            kind: 'option',
            label: S.input,
            options: S.keysets,
            value: s.keyset,
            change: (value) => {
              s.keyset = value;
              this.saveSettings();
              this.refresh();
            },
          },
          toggle(S.lookAhead, 'lookAhead'),
          toggle(S.vibrateOnTouch, 'vibrate'),
          toggle(S.keyboardInMenu, 'keypadInMenu'),
          toggle(S.music, 'music'),
          toggle(S.sound, 'sound'),
          this.link(S.clearHighscore, this.eraseScreen(self)),
          { kind: 'action', label: S.back, run: back },
        ],
      };
    };
    return self;
  }

  private eraseScreen(parent: ScreenBuilder): ScreenBuilder {
    const self: ScreenBuilder = () => {
      const back = () => this.open(parent);
      return {
        title: S.confirmClear,
        back,
        items: [
          { kind: 'text', html: S.eraseText1 },
          { kind: 'text', html: S.eraseText2 },
          { kind: 'space', size: 10 },
          { kind: 'action', label: S.no, run: back },
          {
            kind: 'action',
            label: S.yes,
            run: () => {
              clearScores(this.pack.id);
              this.alert(S.cleared, S.clearedText, back);
            },
          },
          this.link(S.fullReset, this.resetScreen(self)),
        ],
      };
    };
    return self;
  }

  private resetScreen(parent: ScreenBuilder): ScreenBuilder {
    return () => {
      const back = () => this.open(parent);
      return {
        title: S.confirmReset,
        back,
        items: [
          { kind: 'text', html: S.resetText1 },
          { kind: 'text', html: S.resetText2 },
          { kind: 'space', size: 10 },
          { kind: 'action', label: S.no, run: back },
          {
            kind: 'action',
            label: S.yes,
            run: () => {
              // Everything the game has stored, then a fresh start.
              removeAll('');
              this.onReset();
              location.reload();
            },
          },
        ],
      };
    };
  }

  private helpMenu(parent: ScreenBuilder): ScreenBuilder {
    const self: ScreenBuilder = () => {
      const page = (title: string, html: string) => this.link(title, this.textScreen(title, html, self));
      return {
        title: S.help,
        back: () => this.open(parent),
        items: [
          page(S.objective, S.objectiveText),
          page(S.keys, S.keysText),
          page(S.unlocking, S.unlockingText),
          page(S.highscores, S.highscoreText),
          page(S.options, S.optionsText),
          { kind: 'action', label: S.back, run: () => this.open(parent) },
        ],
      };
    };
    return self;
  }

  private textScreen(title: string, html: string, parent: ScreenBuilder): ScreenBuilder {
    return () => {
      const back = () => this.open(parent);
      return {
        title,
        back,
        text: true,
        items: [
          { kind: 'text', html },
          { kind: 'action', label: S.back, run: back },
        ],
      };
    };
  }
}
