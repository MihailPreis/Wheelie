import {
  ACHIEVEMENTS,
  type AchievementId,
  addRuns,
  award,
  countRun,
  earnedAchievements,
  runAchievements,
} from './achievements/achievements';
import { analyseRun } from './achievements/analyse';
import type { Music } from './audio/music';
import type { Sound } from './audio/sound';
import { PHYSICS_VERSION } from './core/version';
import {
  type Candidate,
  dailyBest,
  dailyBestEver,
  dailyStreak,
  dayLabel,
  dayOf,
  parseCandidates,
  pickDaily,
  recordDaily,
} from './daily/daily';
import type { Drafts } from './editor/drafts';
import type { Editor } from './editor/editor';
import { type EditorTrack, toTrackData } from './editor/model';
import { EditorScreens } from './editor/screens';
import { decodeReplay, encodeReplay, hashTrack, MAX_REPLAY_BYTES, Outcome, type Replay } from './formats/replay';
import type { Game, RecordedRun, RunResult, Track } from './game/game';
import { GamepadNavigator, isMenuAction } from './game/gamepad-nav';
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
import {
  ACTIONS,
  type Action,
  defaultBindings,
  heldButton,
  type Input,
  isPlayStationPad,
  parseBindings,
  rebind,
} from './game/input';
import { buttonName, keyName } from './game/input-names';
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
import { buildPack, ORIGINAL_PACK_ID, type Pack } from './mods/pack';
import { ModsScreens, type ScreenBuilder } from './mods/screens';
import type { PlayerControls, TimelineMark } from './player/controls';
import { decodeProfile, isProfile, MAX_PROFILE_BYTES } from './profile/profile';
import type { Sprites } from './render/sprites';
import { ReplayScreens } from './replay/screens';
import { decodeFragment, decodeTrackFragment, isReplayFragment } from './replay/share';
import { verifyReplay } from './replay/simulate';
import type { ReplayStore, StoredReplay } from './replay/store';
import { readJson, removeAll, writeJson } from './storage/store';
import type { Keypad } from './ui/keypad';
import type { MenuItem, MenuKey, MenuView } from './ui/menu/view';
import { chooseLanguage, currentLanguage, LANGUAGE_NAMES, LANGUAGES, STRINGS as S } from './ui/strings';
import type { Toasts } from './ui/toast';

/** Smaller side of the picture, in pixels, for each value of the Screen option. */
const CLASSIC_SCREENS = [0, 240, 176];

/** How far back the archive of daily tracks goes. */
const DAILY_ARCHIVE_DAYS = 30;

/** Three seconds of riding; shorter unfinished runs are not kept. */
const MIN_UNFINISHED_TICKS = 200;

/** Where the identifier of the pack being played is remembered. */
export const ACTIVE_PACK_KEY = 'activePack';
const BINDINGS_KEY = 'bindings';

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
const TYPING_KEYS = new Set(['ArrowUp', 'ArrowDown', 'Enter', 'NumpadEnter', 'Escape']);
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
  private readonly editorScreens: EditorScreens;
  /** A track from the editor is being tried out. */
  private testing = false;
  /** The pack the track being ridden belongs to; not the active pack on a daily track. */
  private runPack: Pack;
  /** The daily track, once it has been looked up. */
  private daily: {
    day: number;
    pack: Pack;
    level: number;
    track: number;
    league: number;
    /** False for the track of a day gone by, opened from the archive. */
    today: boolean;
  } | null = null;
  private dailyCandidates: Candidate[] | null = null;
  /** The run in progress is on the daily track. */
  private ridingDaily = false;
  private readonly padNavigator = new GamepadNavigator();
  /** Address of the full game when this one is embedded in another page to show a replay. */
  embedUrl: string | null = null;

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
    shortLinkApi: string | null,
    sprites: Sprites,
    private readonly game: Game,
    private readonly input: Input,
    private readonly keypad: Keypad,
    private readonly menu: MenuView,
    private readonly music: Music,
    private readonly sound: Sound,
    private readonly menuButton: HTMLElement,
    private readonly controls: PlayerControls,
    private readonly editor: Editor,
    private readonly toasts: Toasts,
    drafts: Drafts,
    private readonly onLayout: () => void,
    private readonly onReset: () => void,
  ) {
    this.runPack = pack;
    input.bindings = parseBindings(readJson<unknown>(BINDINGS_KEY));
    this.baseUrl = baseUrl;
    this.library = library;
    this.trackCounts = pack.levels.map((level) => level.length);
    this.progress = this.loadProgress(pack);
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
        race: (replay, back) => void this.race(replay, back),
        importReplay: (bytes) => void this.importReplay(bytes),
        shared: () => this.earn(['shared']),
        selected: () => ({
          packId: this.pack.id,
          level: this.progress.selectedLevel,
          track: this.selectedTrack,
        }),
        shareBaseUrl,
        shortLinkApi,
        sprites,
        logoUrl: `${baseUrl}assets/brand/wordmark.svg`,
        sceneOptions: () => this.game.options,
        exportSource: async (stored) => {
          let replay: Replay;
          try {
            replay = decodeReplay(stored.bytes);
          } catch {
            return S.replayDamaged;
          }
          const found = await this.trackFor(replay);
          if (typeof found === 'string') return found;
          return {
            film: { track: found.track.data, league: replay.league, inputs: replay.inputs, finishTime: replay.time },
            packName: found.packName,
            packAuthor: found.packAuthor,
          };
        },
      },
      replayStore,
    );
    controls.onClose = () => this.stopWatching();
    this.editorScreens = new EditorScreens(
      {
        open: (builder) => this.open(builder),
        alert: (title, text, then) => this.alert(title, text, then),
        parent: this.mainMenu,
        selectedTrack: () => this.trackAt(this.progress.selectedLevel, this.selectedTrack) ?? null,
        activePack: () => this.pack,
        shareBaseUrl,
        edit: (draft, back) => {
          this.menu.hide();
          this.current = null;
          editor.onChange = (track) => {
            draft.track = track;
            void drafts.save(draft);
          };
          editor.onTest = (track) => this.startTest(track);
          editor.onClose = () => {
            editor.hide();
            this.updateKeypad();
            back();
          };
          editor.open(draft.track);
          this.updateKeypad();
        },
        playPack: (bytes) => {
          const id = 'file-mytracks';
          void library
            .put({ id, name: S.myTracks, author: this.settings.name, bytes, installed: Date.now() })
            .then(() => this.usePack(buildPack(id, S.myTracks, this.settings.name, bytes)));
        },
      },
      drafts,
    );

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
    this.game.classic = CLASSIC_SCREENS[s.screen] ?? 0;
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
    this.progress = this.loadProgress(pack);
    writeJson(ACTIVE_PACK_KEY, pack.id);
    this.showFrontMenu(this.playMenu);
  }

  /**
   * The player's progress in a pack. Their own tracks are all open from the start: the levels
   * of such a pack may be empty, and an empty level can never be completed to unlock the next.
   */
  private loadProgress(pack: Pack): Progress {
    const counts = pack.levels.map((level) => level.length);
    const progress = loadProgress(pack.id, counts);
    if (isCheatName(this.settings.name) || pack.id.startsWith('file-')) {
      const league = progress.unlockedLeagues;
      unlockEverything(progress, counts);
      if (!isCheatName(this.settings.name)) progress.unlockedLeagues = Math.max(league, 2);
    }
    return progress;
  }

  private saveProgress(): void {
    saveProgress(this.pack.id, this.progress);
  }

  /** The keypad shows on touch devices: always while riding, and in the menus if the option says so. */
  private updateKeypad(): void {
    const touch = this.input.device === 'touch';
    this.keypad.visible =
      touch && !this.watching && !this.editor.visible && (this.playing || this.settings.keypadInMenu);
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
    if (this.capture) {
      if (!event.repeat) this.capture.key(event.code);
      return true;
    }
    if (this.watching) return this.controls.key(event);
    if (this.editor.visible) return this.editor.key(event);
    if (this.menu.visible) {
      if (event.key.length === 1 && this.menu.typeLetter(event.key)) return true;
      // While a field is being typed into, only the keys that leave it belong to the menu.
      if (this.menu.typing && !TYPING_KEYS.has(event.code)) return false;
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

  /**
   * The browser's Back button, or the back gesture of a phone: one step back in the game.
   * Returns false where there is nowhere back to go and the page itself may be left.
   */
  back(): boolean {
    if (this.capture) {
      this.capture.key('Escape');
      return true;
    }
    if (this.watching) {
      if (this.embedUrl) return false;
      this.stopWatching();
      return true;
    }
    if (this.editor.visible) {
      this.editor.onClose?.();
      return true;
    }
    if (this.menu.visible) {
      if (this.current === this.mainMenu) return false;
      this.menuKey('back');
      return true;
    }
    if (this.playing) {
      this.pause();
      return true;
    }
    return false;
  }

  /** Set while the Controls screen waits for the key or button to give to an action. */
  private capture: { key: (code: string) => void; button: ((index: number) => void) | null; armed: boolean } | null =
    null;

  private readonly pollGamepad = (now: number): void => {
    const capture = this.capture;
    if (capture?.button) {
      // The button that chose the row is still down; wait for it to come up first.
      const held = heldButton();
      if (held === null) capture.armed = true;
      else if (capture.armed) capture.button(held);
      this.padNavigator.poll(now);
      requestAnimationFrame(this.pollGamepad);
      return;
    }
    for (const action of this.padNavigator.poll(now)) {
      if (this.editor.visible && !this.watching) {
        this.editor.pad(action);
        continue;
      }
      if (!isMenuAction(action)) continue;
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
    this.ridingDaily = false;
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

  /** Starts a track; `rival` is a recorded run of it to race against. */
  private play(level: number, track: number, rival: Replay | null = null): void {
    if (this.launching) return;
    this.launching = true;
    void this.launch(level, track, rival).finally(() => {
      this.launching = false;
    });
  }

  private launching = false;
  private readonly baseUrl: string;
  private readonly library: Library;

  /** The player's own fastest finish on a track and league, as a ghost to beat. */
  private async bestRun(
    packId: string,
    level: number,
    track: number,
    league: number,
    data: Track,
  ): Promise<Replay | null> {
    const hash = hashTrack(data.data);
    let best: Replay | null = null;
    for (const stored of await this.replayStore.list()) {
      if (
        stored.outcome !== Outcome.Finished ||
        stored.packId !== packId ||
        stored.level !== level ||
        stored.track !== track ||
        stored.league !== league ||
        (best && stored.time >= best.time)
      ) {
        continue;
      }
      try {
        const replay = decodeReplay(stored.bytes);
        // The track may have changed since, as tracks from the editor do.
        if (replay.trackHash === hash && replay.physicsVersion === PHYSICS_VERSION) best = replay;
      } catch {
        // Not a ghost, then.
      }
    }
    return best;
  }

  private async launch(level: number, track: number, rival: Replay | null): Promise<void> {
    const data = this.trackAt(level, track);
    if (!data) return;
    const league = rival?.league ?? this.progress.selectedLeague;
    const ghost = rival ?? (this.settings.ghost ? await this.bestRun(this.pack.id, level, track, league, data) : null);
    try {
      this.game.load(data, league, false, ghost?.inputs ?? null);
      this.ghostTime = ghost?.time ?? null;
      this.fresh = [];
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
    this.runPack = this.pack;
    this.ridingDaily = false;
    this.playing = true;
    this.game.paused = false;
    this.game.hud = true;
    this.game.options.dimmed = false;
    this.menu.hide();
    this.current = null;
    this.updateKeypad();
  }

  private pause(): void {
    if (this.testing) {
      this.stopTest('');
      return;
    }
    if (this.ridingDaily && this.playing && !this.menu.visible && this.game.riding) {
      this.game.paused = true;
      this.showMenu(this.dailyPauseMenu);
      return;
    }
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
    if (this.testing) return;
    const track = this.runPack.levels[this.level]?.[this.track];
    // Achievements are judged on the original tracks and the daily one: anywhere else a track
    // could be made to order for them.
    if (track && (this.ridingDaily || this.runPack.id === ORIGINAL_PACK_ID)) {
      const facts = analyseRun(track.data, this.game.league, run.inputs);
      const earned = runAchievements(facts, {
        level: this.level,
        daily: this.ridingDaily,
        wheelie: run.wheelie,
        time: run.time,
        ghostTime: this.ghostTime,
      });
      if (countRun() >= 100) earned.push('runs100');
      this.earn(earned);
    }
    // A run given up within the first seconds is not worth a place in the list.
    if (!track || (run.outcome !== Outcome.Finished && run.inputs.length < MIN_UNFINISHED_TICKS)) return;
    const date = Date.now();
    const replay: Replay = {
      physicsVersion: PHYSICS_VERSION,
      packId: this.runPack.id,
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
      trackData: this.runPack.id.startsWith('file-') ? track.data : null,
    };
    if (!verifyReplay(track.data, replay)) {
      console.warn('A run could not be reproduced and was not saved.');
      this.lastRun = Promise.resolve(null);
      return;
    }
    this.lastRun = this.replayStore.add({
      bytes: encodeReplay(replay),
      packId: replay.packId,
      packName: this.runPack.name,
      level: replay.level,
      track: replay.track,
      league: replay.league,
      trackName: replay.trackName,
      player: replay.player,
      date,
      outcome: replay.outcome,
      wheelie: replay.wheelie,
      time: replay.time,
      ...(this.ridingDaily && this.daily ? { daily: this.daily.day } : {}),
    });
  }

  // ---- achievements ------------------------------------------------------------------------

  /** Finish time of the ghost being raced, in milliseconds. */
  private ghostTime: number | null = null;

  /** Awards achievements and announces the ones that are new. */
  private earn(ids: readonly AchievementId[]): void {
    for (const id of award(ids, Date.now())) {
      this.fresh.push(id);
      this.toasts.show(S.achievementEarned(S.achievementList[id][0]));
    }
  }

  /** Achievements earned since the run in progress began, for the screen at its end. */
  private fresh: AchievementId[] = [];

  private freshItems(): MenuItem[] {
    return this.fresh.map((id) => ({
      kind: 'text',
      html: `<b>${escapeHtml(S.achievementEarned(S.achievementList[id][0]))}</b><br>${escapeHtml(S.achievementList[id][1])}`,
    }));
  }

  /** Every achievement is a secret until it is earned. */
  private readonly achievementsScreen: ScreenBuilder = () => {
    const back = () => this.open(this.mainMenu);
    const earned = earnedAchievements();
    const count = ACHIEVEMENTS.filter((id) => earned[id] !== undefined).length;
    const items: MenuItem[] = [{ kind: 'text', html: S.achievementCount(count, ACHIEVEMENTS.length) }];
    for (const id of ACHIEVEMENTS) {
      const when = earned[id];
      if (when === undefined) {
        items.push({ kind: 'text', html: `<span class="menu-dim">${S.achievementHidden}</span>` });
        continue;
      }
      const [title, text] = S.achievementList[id];
      const date = new Date(when).toLocaleDateString(S.locale, { day: 'numeric', month: 'short', year: 'numeric' });
      items.push({
        kind: 'text',
        html: `<b>${escapeHtml(title)}</b><br>${escapeHtml(text)}<br><span class="menu-dim">${escapeHtml(date)}</span>`,
      });
    }
    items.push({ kind: 'action', label: S.back, run: back });
    return { title: S.achievements, back, text: true, items };
  };

  // ---- the daily track ---------------------------------------------------------------------

  /** Looks up the track of a day — today's unless told otherwise — fetching its pack if need be. */
  private async openDaily(past: number | null = null): Promise<void> {
    this.open(() => ({ title: S.daily, back: null, items: [{ kind: 'text', html: S.downloading }] }));
    const today = dayOf(Date.now());
    const day = past ?? today;
    try {
      if (this.daily?.day !== day) {
        if (!this.dailyCandidates) {
          const response = await fetch(`${this.baseUrl}assets/mods/daily.json`);
          if (!response.ok) throw new Error('No list of daily tracks');
          this.dailyCandidates = parseCandidates(await response.json());
        }
        const pick = pickDaily(this.dailyCandidates, day);
        const pack = pick ? await this.mods.obtain(pick.packId) : null;
        if (!pick || !pack?.levels[pick.level]?.[pick.track]) throw new Error('No daily track');
        this.daily = { day, pack, level: pick.level, track: pick.track, league: pick.league, today: day === today };
      }
    } catch {
      this.alert(S.daily, S.dailyUnavailable, () => this.open(past === null ? this.mainMenu : this.dailyArchive));
      return;
    }
    this.open(this.dailyScreen);
  }

  /** The tracks of the days gone by. They can still be ridden; only the streak is beyond mending. */
  private readonly dailyArchive: ScreenBuilder = () => {
    const back = () => void this.openDaily();
    const today = dayOf(Date.now());
    const items: MenuItem[] = [];
    for (let day = today - 1; day >= today - DAILY_ARCHIVE_DAYS; day--) {
      const best = dailyBestEver(day);
      items.push({
        kind: 'action',
        label: `${dayLabel(day)} - ${best === null ? '---' : formatScoreTime(Math.floor(best / 10))}`,
        run: () => void this.openDaily(day),
      });
    }
    items.push({ kind: 'action', label: S.back, run: back });
    return { title: S.dailyPast, back, items };
  };

  private readonly dailyScreen: ScreenBuilder = () => {
    const daily = this.daily;
    const back = () => (daily && !daily.today ? this.open(this.dailyArchive) : this.open(this.mainMenu));
    if (!daily) return { title: S.daily, back, items: [{ kind: 'action', label: S.back, run: back }] };
    const best = daily.today ? dailyBest(daily.day) : dailyBestEver(daily.day);
    const streak = dailyStreak(dayOf(Date.now()));
    const dim = (label: string, value: string): MenuItem => ({
      kind: 'text',
      html: `<span class="menu-dim">${label}:</span> ${escapeHtml(value)}`,
    });
    return {
      title: S.daily,
      back,
      items: [
        { kind: 'text', html: escapeHtml(daily.pack.levels[daily.level]?.[daily.track]?.name ?? ''), big: true },
        dim(S.date, dayLabel(daily.day)),
        dim(S.league, LEAGUE_NAMES[daily.league] ?? ''),
        dim(S.levels, daily.pack.author ? S.packBy(daily.pack.name, daily.pack.author) : daily.pack.name),
        dim(
          daily.today ? S.dailyBest : S.dailyBestPast,
          best === null ? S.dailyNotYet : formatScoreTime(Math.floor(best / 10)),
        ),
        ...(daily.today ? [dim(S.dailyStreak, S.dailyDays(streak))] : []),
        { kind: 'space', size: 10 },
        { kind: 'action', label: `${S.start}>`, run: () => void this.playDaily() },
        ...(daily.today ? [this.link(S.dailyPast, this.dailyArchive)] : []),
        { kind: 'action', label: S.back, run: back },
      ],
    };
  };

  private async playDaily(): Promise<void> {
    const daily = this.daily;
    const track = daily?.pack.levels[daily.level]?.[daily.track];
    if (!daily || !track || this.launching) return;
    this.launching = true;
    try {
      // The ghost is the best run on this very track, which today's best necessarily is.
      const ghost = this.settings.ghost
        ? await this.bestRun(daily.pack.id, daily.level, daily.track, daily.league, track)
        : null;
      this.game.load(track, daily.league, false, ghost?.inputs ?? null);
      this.ghostTime = ghost?.time ?? null;
      this.fresh = [];
    } catch {
      this.alert(S.daily, S.damagedTrack, () => this.open(this.dailyScreen));
      return;
    } finally {
      this.launching = false;
    }
    this.level = daily.level;
    this.track = daily.track;
    this.runPack = daily.pack;
    this.ridingDaily = true;
    this.playing = true;
    this.game.paused = false;
    this.game.hud = true;
    this.game.options.dimmed = false;
    this.menu.hide();
    this.current = null;
    this.updateKeypad();
  }

  private readonly dailyPauseMenu: ScreenBuilder = () => ({
    title: S.ingame,
    back: () => this.resume(),
    items: [
      { kind: 'action', label: S.continue, run: () => this.resume() },
      { kind: 'action', label: S.restart, run: () => void this.playDaily() },
      this.link(S.options, this.optionsMenu(this.dailyPauseMenu)),
      { kind: 'action', label: S.daily, run: () => this.showFrontMenu(this.dailyScreen) },
    ],
  });

  /** The daily track stands apart: no unlocks, no high score table, only the best time of the day. */
  private dailyFinished(result: RunResult): void {
    const daily = this.daily;
    if (!daily) return;
    // The day may have turned over while the track was being ridden; the run still belongs to it.
    const improved = recordDaily(daily.day, result.time, !daily.today);
    const streak = daily.today ? dailyStreak(daily.day) : 0;
    this.earn([...(streak >= 3 ? (['daily3'] as const) : []), ...(streak >= 7 ? (['daily7'] as const) : [])]);
    const best = dailyBestEver(daily.day) ?? result.time;
    const screen: ScreenBuilder = () => ({
      title: S.finished,
      back: null,
      items: [
        { kind: 'text', html: formatScoreTime(Math.floor(result.time / 10)), big: true },
        {
          kind: 'text',
          html: improved
            ? daily.today
              ? S.dailyNewBest
              : S.dailyNewBestPast
            : `${daily.today ? S.dailyBest : S.dailyBestPast}: ${formatScoreTime(Math.floor(best / 10))}`,
        },
        ...(daily.today
          ? [{ kind: 'text' as const, html: `${S.dailyStreak}: ${S.dailyDays(dailyStreak(daily.day))}` }]
          : []),
        ...this.freshItems(),
        { kind: 'space', size: 10 },
        { kind: 'action', label: S.restart, run: () => void this.playDaily() },
        {
          kind: 'action',
          label: S.watchReplay,
          run: () =>
            void this.lastRun.then((run) => {
              if (run) void this.watch(run, screen);
            }),
        },
        {
          kind: 'action',
          label: S.share,
          run: () =>
            void this.lastRun.then((run) => {
              if (run) this.replays.share(run, screen);
            }),
        },
        { kind: 'action', label: S.daily, run: () => this.showFrontMenu(this.dailyScreen) },
      ],
    });
    this.showMenu(screen);
  }

  // ---- trying out a track from the editor --------------------------------------------------

  private startTest(track: EditorTrack): void {
    try {
      this.game.load({ name: track.name, data: toTrackData(track) }, this.progress.selectedLeague);
    } catch {
      this.editor.show(S.editorTestFailed);
      return;
    }
    this.editor.hide();
    this.testing = true;
    this.playing = true;
    this.game.paused = false;
    this.game.hud = true;
    this.game.options.dimmed = false;
    this.updateKeypad();
  }

  /** Back to the editor, where the test drive was started from. */
  private stopTest(message: string): void {
    this.testing = false;
    this.playing = false;
    this.game.paused = false;
    this.game.hud = false;
    this.game.options.dimmed = true;
    this.input.release();
    this.loadDemo();
    this.editor.show(message);
    this.updateKeypad();
  }

  // ---- watching a replay ------------------------------------------------------------------

  /** The track a replay was made on, or the reason it cannot be shown. */
  private async trackFor(replay: Replay): Promise<{ track: Track; packName: string; packAuthor: string } | string> {
    if (replay.physicsVersion !== PHYSICS_VERSION) return S.replayOtherVersion;
    if (replay.trackData) {
      if (hashTrack(replay.trackData) !== replay.trackHash) return S.replayDamaged;
      return { track: { name: replay.trackName, data: replay.trackData }, packName: S.ownLevels, packAuthor: '' };
    }
    let pack: Pack | null = null;
    if (replay.packId === this.pack.id) pack = this.pack;
    else if (replay.packId === ORIGINAL_PACK_ID) pack = this.original;
    // A pack of the bundled catalogue is installed on the spot if it is not there yet.
    else pack = await this.mods.obtain(replay.packId);
    const track = pack?.levels[replay.level]?.[replay.track];
    if (!pack || !track) return S.replayNoPack;
    return hashTrack(track.data) === replay.trackHash
      ? { track, packName: pack.name, packAuthor: pack.author }
      : S.replayChangedTrack;
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
    else this.startWatching(replay, found.track, back, fail, stored);
  }

  /** `stored` is the run as it is kept, if it is: that is what racing it needs. */
  private startWatching(
    replay: Replay,
    track: Track,
    back: ScreenBuilder,
    fail: (text: string) => void,
    stored: StoredReplay | null,
  ): void {
    let marks: TimelineMark[];
    try {
      this.game.watch(track, replay.league, { inputs: replay.inputs, finishTime: replay.time });
      const facts = analyseRun(track.data, replay.league, replay.inputs);
      marks = facts.flips.map((tick) => ({ tick, kind: 'flip' as const }));
      if (facts.crashedAt !== null) marks.push({ tick: facts.crashedAt, kind: 'crash' });
      if (facts.finishedAt !== null) marks.push({ tick: facts.finishedAt, kind: 'finish' });
    } catch {
      fail(S.replayDamaged);
      return;
    }
    const race =
      stored && !this.embedUrl
        ? () => {
            this.stopWatching();
            void this.race(stored, back);
          }
        : null;
    this.watching = true;
    this.afterWatching = back;
    this.playing = false;
    this.game.paused = false;
    this.game.hud = true;
    this.game.options.dimmed = false;
    this.menu.hide();
    this.current = null;
    this.controls.show({ marks, race, embedded: this.embedUrl });
    this.updateKeypad();
  }

  /**
   * Takes in a replay from outside — a file or a link. It is checked by riding it again, kept
   * with the player's own runs and played.
   */
  async importReplay(bytes: Uint8Array): Promise<void> {
    if (this.playing && !this.menu.visible) return;
    if (isProfile(bytes)) return this.importProfile(bytes);
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
    const same = (other: StoredReplay) =>
      other.bytes.length === bytes.length && other.bytes.every((byte, index) => byte === bytes[index]);
    let stored = (await this.replayStore.list()).find(same) ?? null;
    // A replay shown on somebody else's page is a guest there and leaves nothing behind.
    if (!stored && !this.embedUrl) {
      stored = await this.replayStore.add({
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
    this.startWatching(replay, found.track, back, fail, stored);
  }

  /**
   * Reads a backup of runs. Each run is checked by riding it again and added to the player's own;
   * the progress, high scores and achievements those runs amount to are then worked out from
   * them, in the order they were made — the file itself says nothing about any of that.
   */
  private async importProfile(bytes: Uint8Array): Promise<void> {
    const done = () => void this.replays.openList();
    const say = (text: string) =>
      this.open(() => ({ title: S.myRuns, back: null, items: [{ kind: 'text', html: text }] }));
    let files: Uint8Array[];
    try {
      files = decodeProfile(bytes, MAX_REPLAY_BYTES);
    } catch {
      this.alert(S.myRuns, S.backupDamaged, done);
      return;
    }
    say(S.backupReading(0, files.length));

    const kept = await this.replayStore.list();
    const known = new Set(kept.map((stored) => stored.bytes.join(',')));
    const taken: { bytes: Uint8Array; replay: Replay; track: Track; packName: string; pack: Pack | null }[] = [];
    let skipped = 0;
    for (const [index, file] of files.entries()) {
      if (index % 5 === 4) {
        say(S.backupReading(index + 1, files.length));
        await new Promise((resolve) => setTimeout(resolve));
      }
      const signature = file.join(',');
      if (known.has(signature)) continue;
      known.add(signature);
      try {
        const replay = decodeReplay(file);
        const found = await this.trackFor(replay);
        if (typeof found === 'string' || !verifyReplay(found.track.data, replay)) throw new Error('Not a run');
        const pack = replay.trackData
          ? null
          : replay.packId === ORIGINAL_PACK_ID
            ? this.original
            : replay.packId === this.pack.id
              ? this.pack
              : await this.mods.obtain(replay.packId);
        taken.push({ bytes: file, replay, track: found.track, packName: found.packName, pack });
      } catch {
        skipped++;
      }
    }

    try {
      if (!this.dailyCandidates) {
        const response = await fetch(`${this.baseUrl}assets/mods/daily.json`);
        if (response.ok) this.dailyCandidates = parseCandidates(await response.json());
      }
    } catch {
      // Without the list the runs on daily tracks count as ordinary runs on their packs.
    }

    taken.sort((a, b) => a.replay.date - b.replay.date);
    /** Fastest finish so far per track and league, as the ghost each later run was up against. */
    const fastest = new Map<string, number>();
    for (const stored of kept) {
      if (stored.outcome !== Outcome.Finished) continue;
      const key = `${stored.packId}/${stored.level}/${stored.track}/${stored.league}`;
      fastest.set(key, Math.min(fastest.get(key) ?? Infinity, stored.time));
    }
    const earned: AchievementId[] = [];
    let counted = 0;
    for (const { bytes: file, replay, track, packName, pack } of taken) {
      const date = replay.date * 1000;
      const day = dayOf(date);
      const pick = this.dailyCandidates ? pickDaily(this.dailyCandidates, day) : null;
      const daily =
        pick?.packId === replay.packId &&
        pick.level === replay.level &&
        pick.track === replay.track &&
        pick.league === replay.league;
      const finished = replay.outcome === Outcome.Finished;
      const key = `${replay.packId}/${replay.level}/${replay.track}/${replay.league}`;

      if (daily || replay.packId === ORIGINAL_PACK_ID) {
        counted++;
        const facts = analyseRun(track.data, replay.league, replay.inputs);
        earned.push(
          ...runAchievements(facts, {
            level: replay.level,
            daily,
            wheelie: replay.wheelie,
            time: replay.time,
            ghostTime: fastest.get(key) ?? null,
          }),
        );
      }
      if (finished) {
        fastest.set(key, Math.min(fastest.get(key) ?? Infinity, replay.time));
        if (daily) {
          recordDaily(day, replay.time);
        } else if (pack) {
          const counts = pack.levels.map((level) => level.length);
          const progress = loadProgress(pack.id, counts);
          const { selectedLevel, selectedLeague } = progress;
          const selectedTracks: Progress['selectedTracks'] = [...progress.selectedTracks];
          completeTrack(progress, replay.level, replay.track, counts);
          // Only what was unlocked is of interest here, not where the selection moved to.
          saveProgress(pack.id, { ...progress, selectedLevel, selectedTracks, selectedLeague });
          const scores = loadScores(pack.id, replay.level, replay.track);
          addScore(scores, replay.league, normalizeName(replay.player), Math.floor(replay.time / 10));
          saveScores(pack.id, replay.level, replay.track, scores);
        }
        if (replay.packId === 'file-mytracks') earned.push('ownTrack');
      }
      await this.replayStore.add({
        bytes: file,
        packId: replay.packId,
        packName,
        level: replay.level,
        track: replay.track,
        league: replay.league,
        trackName: replay.trackName,
        player: replay.player,
        date,
        outcome: replay.outcome,
        wheelie: replay.wheelie,
        time: replay.time,
        ...(daily ? { daily: day } : {}),
      });
    }

    // What follows from the whole rather than from any one run.
    const original = this.original.levels.map((level) => level.length);
    const progress = loadProgress(ORIGINAL_PACK_ID, original);
    (['easyDone', 'mediumDone', 'hardDone'] as const).forEach((id, level) => {
      if (completedCount(progress, level, original) >= (original[level] ?? 0)) earned.push(id);
    });
    if (progress.unlockedLeagues >= 3) earned.push('league325');
    const streak = Math.max(0, ...taken.map(({ replay }) => dailyStreak(dayOf(replay.date * 1000))));
    if (streak >= 3) earned.push('daily3');
    if (streak >= 7) earned.push('daily7');
    if (addRuns(counted) >= 100) earned.push('runs100');
    this.fresh = [];
    this.earn(earned);
    this.progress = this.loadProgress(this.pack);
    this.alert(S.myRuns, S.backupRead(taken.length, files.length - taken.length - skipped, skipped), done);
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

  /**
   * Opens the track carried by a link's fragment: a level pack of one track, which can be ridden
   * as it is or taken into the editor.
   */
  async openTrackLink(fragment: string): Promise<void> {
    const back = () => this.open(this.mainMenu);
    let bytes: Uint8Array;
    let pack: Pack;
    try {
      bytes = await decodeTrackFragment(fragment);
      // The identifier follows from the contents, so the same link always means the same pack.
      const hash = bytes.reduce((sum, byte) => Math.imul(sum ^ byte, 0x01000193) >>> 0, 0x811c9dc5);
      pack = buildPack(`file-shared-${hash.toString(16)}`, S.sharedTrack, '', bytes);
    } catch {
      this.alert(S.editor, S.damagedPack, back);
      return;
    }
    const track = pack.levels.flat()[0];
    if (!track) {
      this.alert(S.editor, S.damagedPack, back);
      return;
    }
    this.open(() => ({
      title: S.sharedTrack,
      back,
      items: [
        { kind: 'text', html: escapeHtml(track.name), big: true },
        { kind: 'text', html: S.editorPoints(track.data.pointCount) },
        { kind: 'space', size: 10 },
        {
          kind: 'action',
          label: S.play,
          run: () =>
            void this.library
              .put({ id: pack.id, name: `${S.sharedTrack}: ${track.name}`, author: '', bytes, installed: Date.now() })
              .then(() => this.usePack(pack)),
        },
        {
          kind: 'action',
          label: S.editorOpenIn,
          run: () =>
            void this.editorScreens.adopt(track.name, track.data).then((taken) => {
              if (!taken) this.alert(S.editor, S.editorCannotCopy, back);
            }),
        },
        { kind: 'action', label: S.back, run: back },
      ],
    }));
  }

  /** A file was dropped on the page: a replay is played, anything else is taken for a level pack. */
  async openFile(file: File): Promise<void> {
    if (this.playing && !this.menu.visible) return;
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (head[0] === 0x47 && head[1] === 0x44 && head[2] === 0x52 && head[3] === 0x1a) {
      if (file.size <= MAX_REPLAY_BYTES) await this.importReplay(new Uint8Array(await file.arrayBuffer()));
      else this.alert(S.myRuns, S.replayDamaged, () => this.open(this.mainMenu));
    } else if (isProfile(head)) {
      if (file.size <= MAX_PROFILE_BYTES) await this.importProfile(new Uint8Array(await file.arrayBuffer()));
      else this.alert(S.myRuns, S.backupDamaged, () => this.open(this.mainMenu));
    } else {
      await this.mods.installFile(file);
    }
  }

  /** Starts the track of a saved run with that run as the ghost. */
  private async race(stored: StoredReplay, back: ScreenBuilder): Promise<void> {
    const fail = (text: string) => this.alert(S.myRuns, text, () => this.open(back));
    let replay: Replay;
    try {
      replay = decodeReplay(stored.bytes);
    } catch {
      fail(S.replayDamaged);
      return;
    }
    const found = await this.trackFor(replay);
    if (typeof found === 'string') {
      fail(found);
      return;
    }
    // The race is run as part of the pack the track belongs to, so the result counts there.
    if (replay.packId !== this.pack.id) {
      const pack = replay.packId === ORIGINAL_PACK_ID ? this.original : await this.mods.obtain(replay.packId);
      if (!pack) {
        fail(S.replayNoPack);
        return;
      }
      this.usePack(pack);
    }
    if (hashTrack(this.trackAt(replay.level, replay.track)?.data ?? found.track.data) !== replay.trackHash) {
      fail(S.replayChangedTrack);
      return;
    }
    this.play(replay.level, replay.track, replay);
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
    if (this.ridingDaily) {
      this.dailyFinished(result);
      return;
    }
    if (this.testing) {
      this.earn(['ownTrack']);
      this.stopTest(S.editorTestFinished(formatScoreTime(Math.floor(result.time / 10))));
      return;
    }
    const time = Math.floor(result.time / 10);
    const league = this.game.league;
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
    const league = this.game.league;
    const leagues = availableLeagues(this.progress);
    const outcome = completeTrack(this.progress, level, track, this.trackCounts);
    this.saveProgress();
    if (this.pack.id === ORIGINAL_PACK_ID) {
      const done = (index: number) =>
        completedCount(this.progress, index, this.trackCounts) >= (this.trackCounts[index] ?? 0);
      const earned: AchievementId[] = [];
      if (done(0)) earned.push('easyDone');
      if (done(1)) earned.push('mediumDone');
      if (done(2)) earned.push('hardDone');
      if (this.progress.unlockedLeagues >= 3) earned.push('league325');
      this.earn(earned);
    }

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

    items.push(...this.freshItems());

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

  /** A newer version of the game has been downloaded and starts with the next load of the page. */
  private updateReady = false;
  /** Asks the browser to install the game as an app; 'manual' where the player has to do it by hand. */
  installOffer: (() => void) | 'manual' | null = null;

  /** Something the main menu shows has changed. */
  menuChanged(): void {
    if (this.current === this.mainMenu) this.refresh();
  }

  updateAvailable(): void {
    if (this.updateReady) return;
    this.updateReady = true;
    this.toasts.show(S.updateReady);
    if (this.current === this.mainMenu) this.refresh();
  }

  private readonly mainMenu: ScreenBuilder = () => ({
    title: S.main,
    back: null,
    items: [
      ...(this.updateReady ? [{ kind: 'action' as const, label: S.updateNow, run: () => location.reload() }] : []),
      this.link(S.playMenu, this.playMenu),
      { kind: 'action', label: S.daily, run: () => void this.openDaily() },
      { kind: 'action', label: S.mods, run: () => this.open(this.mods.menu) },
      { kind: 'action', label: S.myRuns, run: () => void this.replays.openList() },
      this.link(S.achievements, this.achievementsScreen),
      { kind: 'action', label: S.editor, run: () => void this.editorScreens.openList() },
      this.link(S.options, this.optionsMenu(this.mainMenu)),
      this.link(S.help, this.helpMenu(this.mainMenu)),
      this.link(S.about, this.textScreen(S.about, S.aboutText, this.mainMenu)),
      ...(this.installOffer
        ? [
            {
              kind: 'action' as const,
              label: S.installApp,
              run: () => {
                if (typeof this.installOffer === 'function') this.installOffer();
                else this.open(this.textScreen(S.installApp, S.installAppManual, this.mainMenu));
              },
            },
          ]
        : []),
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
          | 'sound'
          | 'ghost',
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
          this.link(S.controls, this.controlsScreen(self)),
          toggle(S.lookAhead, 'lookAhead'),
          {
            kind: 'option',
            label: S.screen,
            options: S.screens,
            value: s.screen,
            change: (value) => {
              s.screen = value;
              this.saveSettings();
              this.refresh();
            },
          },
          toggle(S.vibrateOnTouch, 'vibrate'),
          toggle(S.keyboardInMenu, 'keypadInMenu'),
          toggle(S.ghost, 'ghost'),
          {
            kind: 'option',
            label: S.language,
            options: LANGUAGE_NAMES,
            value: LANGUAGES.indexOf(currentLanguage()),
            change: (value) => {
              const language = LANGUAGES[value];
              if (!language || language === currentLanguage()) return;
              // Texts are picked at start-up, so the game starts over in the new language.
              chooseLanguage(language);
              location.reload();
            },
          },
          toggle(S.music, 'music'),
          toggle(S.sound, 'sound'),
          this.link(S.clearHighscore, this.eraseScreen(self)),
          { kind: 'action', label: S.back, run: back },
        ],
      };
    };
    return self;
  }

  /** Which keys and buttons ride the bike. */
  private controlsScreen(parent: ScreenBuilder): ScreenBuilder {
    const self: ScreenBuilder = () => {
      const back = () => this.open(parent);
      const bindings = this.input.bindings;
      const playStation = isPlayStationPad();
      const save = () => {
        this.input.bindings = bindings;
        writeJson(BINDINGS_KEY, bindings);
        this.capture = null;
        this.open(self);
      };
      const ask = (text: string) =>
        this.open(() => ({ title: S.controls, back: null, items: [{ kind: 'text', html: text }] }));
      const cancel = () => {
        this.capture = null;
        this.open(self);
      };
      const items: MenuItem[] = [];
      ACTIONS.forEach((action: Action, index) => {
        const label = S.actions[index] ?? action;
        items.push(
          {
            kind: 'action',
            label: `${label}: ${bindings.keys[action].map(keyName).join(', ') || '---'}`,
            run: () => {
              ask(S.pressKey(label));
              this.capture = {
                armed: true,
                button: null,
                key: (code) => {
                  if (code === 'Escape') return cancel();
                  rebind(bindings, 'keys', action, code);
                  save();
                },
              };
            },
          },
          {
            kind: 'action',
            label: `${label} (${S.gamepad}): ${
              bindings.buttons[action].map((button) => buttonName(button, playStation)).join(', ') || '---'
            }`,
            run: () => {
              ask(S.pressButton(label));
              this.capture = {
                armed: false,
                key: (code) => {
                  if (code === 'Escape') cancel();
                },
                button: (button) => {
                  rebind(bindings, 'buttons', action, button);
                  save();
                },
              };
            },
          },
        );
      });
      items.push(
        {
          kind: 'action',
          label: S.controlsReset,
          run: () => {
            this.input.bindings = defaultBindings();
            removeAll(BINDINGS_KEY);
            this.open(self);
          },
        },
        { kind: 'action', label: S.back, run: back },
      );
      return { title: S.controls, back, items };
    };
    return self;
  }

  /** The Keys page of the help: the controls as they are now, the device in use first. */
  private keysText(): string {
    const { keys, buttons } = this.input.bindings;
    const playStation = isPlayStationPad();
    const list = (names: string[]) => escapeHtml(names.join(', ') || '---');
    const keyboard = ACTIONS.map((action, index) => `${S.actions[index]}: ${list(keys[action].map(keyName))}`);
    const pad = ACTIONS.map(
      (action, index) =>
        `${S.actions[index]}: ${list(buttons[action].map((button) => buttonName(button, playStation)))}`,
    );
    const sections = [
      `<b>${S.keyboard}</b><br>${keyboard.join('<br>')}<br>${S.keyboardPause}`,
      `<b>${S.gamepad}</b><br>${pad.join('<br>')}<br>${S.gamepadExtra(buttonName(9, playStation))}`,
    ];
    if (this.input.device === 'gamepad') sections.reverse();
    return `${sections.join('<br><br>')}<br><br>${S.keysText}`;
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
          { kind: 'action', label: S.keys, run: () => this.open(this.textScreen(S.keys, this.keysText(), self)) },
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
