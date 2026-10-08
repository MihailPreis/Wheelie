import { ACTIVE_PACK_KEY, App } from './app';
import { Music } from './audio/music';
import { AudioOutput } from './audio/output';
import { Sound } from './audio/sound';
import { APP_NAME, resolveShareBaseUrl } from './config';
import { Drafts } from './editor/drafts';
import { Editor } from './editor/editor';
import { Game } from './game/game';
import { Input } from './game/input';
import { Library } from './mods/library';
import { buildPack, ORIGINAL_PACK_ID, type Pack } from './mods/pack';
import { PlayerControls } from './player/controls';
import { GAME_FONT } from './render/hud';
import { loadSprites } from './render/sprites';
import { isReplayFragment, isTrackFragment } from './replay/share';
import { ReplayStore } from './replay/store';
import { readJson } from './storage/store';
import './style.css';
import { createFullscreenButton, toggleFullscreen } from './ui/fullscreen';
import { Keypad } from './ui/keypad';
import { MenuView } from './ui/menu/view';
import { currentLanguage, STRINGS } from './ui/strings';
import { Toasts } from './ui/toast';

/** How long each of the two opening screens stays up, in milliseconds. */
const SPLASH_MILLISECONDS = 1200;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

/**
 * Two opening screens over a progress bar, as in the original: this game's logo, then the credit
 * for the game it is a port of. They stay up while `work` runs and can be skipped once it is done.
 */
async function splash<T>(base: string, work: Promise<T>, brief: boolean): Promise<T> {
  const root = element('div', 'splash');
  const progress = element('div', 'splash-progress');
  const bar = element('div', 'splash-progress-bar');
  progress.append(bar);
  const content = element('div', '');
  root.append(progress, content);
  document.body.append(root);

  // Someone following a link to a replay came for the replay.
  let skipped = brief;
  const skip = () => {
    skipped = true;
  };
  window.addEventListener('keydown', skip);
  window.addEventListener('pointerdown', skip);
  const hold = async (from: number, to: number) => {
    const start = performance.now();
    while (!skipped && performance.now() - start < SPLASH_MILLISECONDS) {
      const done = (performance.now() - start) / SPLASH_MILLISECONDS;
      bar.style.width = `${(from + (to - from) * done) * 100}%`;
      await new Promise(requestAnimationFrame);
    }
  };

  try {
    const logo = element('img', 'splash-logo');
    logo.src = `${base}assets/brand/wordmark.svg`;
    logo.alt = APP_NAME;
    const tagline = element('div', 'splash-tagline');
    tagline.textContent = STRINGS.tagline;
    content.append(logo, tagline);
    await hold(0, 0.5);

    const credit = element('div', 'splash-credit');
    credit.textContent = STRINGS.splashCredit;
    content.replaceChildren(credit);
    const result = await work;
    skipped = brief;
    await hold(0.5, 1);
    return result;
  } finally {
    window.removeEventListener('keydown', skip);
    window.removeEventListener('pointerdown', skip);
    root.remove();
  }
}

/** The pack the player last switched to, if it is still installed and readable. */
async function activePack(library: Library, original: Pack): Promise<Pack> {
  const id = readJson<unknown>(ACTIVE_PACK_KEY);
  if (typeof id !== 'string' || id === ORIGINAL_PACK_ID) return original;
  try {
    const installed = await library.get(id);
    if (installed) return buildPack(installed.id, installed.name, installed.author, installed.bytes);
  } catch {
    // Fall through to the tracks the game comes with.
  }
  return original;
}

async function loadEverything(base: string) {
  const [sprites, packResponse] = await Promise.all([
    loadSprites(base),
    fetch(`${base}assets/levels/levels.mrg`),
    document.fonts.load(`18px ${GAME_FONT}`),
  ]);
  if (!packResponse.ok) throw new Error('Failed to load the level pack');
  const bytes = new Uint8Array(await packResponse.arrayBuffer());
  const original = buildPack(ORIGINAL_PACK_ID, STRINGS.originalLevels, 'Codebrew Software', bytes);
  const library = new Library();
  return { sprites, original, library, pack: await activePack(library, original) };
}

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game');
  if (!canvas) throw new Error('Game canvas is missing');
  const base = import.meta.env.BASE_URL;
  const root = document.documentElement;
  root.lang = currentLanguage();

  // Sizes everywhere are in dp; this is the same scale the game picks for the scene.
  const dp = () => Math.max(1, Math.min(window.innerWidth, window.innerHeight) / 360);
  root.style.setProperty('--dp', String(dp()));

  const { sprites, pack, original, library } = await splash(
    base,
    loadEverything(base),
    isReplayFragment(location.hash),
  );

  const input = new Input();
  const game = new Game(canvas, sprites, input);
  const keypad = new Keypad(input);
  const menu = new MenuView((name) => `${base}assets/sprites/3x/${name}.png`);
  const replayStore = new ReplayStore();
  const controls = new PlayerControls(game);
  const editor = new Editor();
  const toasts = new Toasts();
  const drafts = new Drafts();
  const output = new AudioOutput();
  const music = new Music(output, `${base}assets/audio/go.ogg`);
  const sound = new Sound(output);
  game.audio = sound;

  const menuButton = element('button', 'menu-button');
  menuButton.type = 'button';
  menuButton.setAttribute('aria-label', 'Menu');
  const dots = element('img', 'menu-button-icon');
  dots.src = `${base}assets/sprites/3x/ic_menu_up.png`;
  dots.alt = '';
  menuButton.append(dots);
  menuButton.hidden = true;
  document.body.append(
    menu.element,
    keypad.element,
    menuButton,
    createFullscreenButton(),
    controls.element,
    editor.element,
    toasts.element,
  );

  const layout = () => {
    root.style.setProperty('--dp', String(game.scale));
    const keypadHeight = keypad.height;
    root.style.setProperty('--keypad-height', `${keypadHeight}px`);
    game.keypadHeight = keypadHeight;
  };
  new ResizeObserver(layout).observe(canvas);

  const shareBaseUrl = resolveShareBaseUrl(import.meta.env.VITE_SHARE_BASE_URL, location);
  const app = new App(
    pack,
    original,
    library,
    replayStore,
    base,
    shareBaseUrl,
    import.meta.env.VITE_SHORT_LINK_API?.trim() || null,
    sprites,
    game,
    input,
    keypad,
    menu,
    music,
    sound,
    menuButton,
    controls,
    editor,
    toasts,
    drafts,
    layout,
    () => {
      library.clear();
      replayStore.clear();
      drafts.clear();
    },
  );
  // `?embed=1` with a replay link shows that replay inside another page.
  const embedded = new URLSearchParams(location.search).has('embed') && isReplayFragment(location.hash);
  if (embedded) app.embedUrl = shareBaseUrl;
  if (matchMedia('(pointer: coarse)').matches) input.touch(-1, null);
  input.touchEnd(-1);

  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (app.keyDown(event)) event.preventDefault();
    // F is free everywhere except where text is being typed.
    else if (event.code === 'KeyF' && !event.repeat && !(event.target instanceof HTMLInputElement)) toggleFullscreen();
  });
  window.addEventListener('keyup', (event) => input.keyUp(event.code));
  window.addEventListener('pointerdown', (event) => {
    music.unlock();
    // A finger anywhere switches to touch controls.
    if (event.pointerType === 'touch' && input.device !== 'touch') {
      input.touch(event.pointerId, null);
      input.touchEnd(event.pointerId);
    }
  });
  // A level pack file can be dropped anywhere on the page.
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files[0];
    if (file) void app.openFile(file);
  });
  // The browser's Back button steps back through the game before it leaves the page. An entry
  // of our own stands guard in the history; each time it is used up, another takes its place.
  if (!embedded) {
    history.pushState({ wheelie: true }, '');
    window.addEventListener('popstate', () => {
      if (app.back()) history.pushState({ wheelie: true }, '');
      else history.back();
    });
  }
  canvas.addEventListener('click', () => app.sceneTap());
  window.addEventListener('pointermove', () => controls.wake());
  window.addEventListener('blur', () => input.release());
  document.addEventListener('visibilitychange', () => {
    output.setHidden(document.hidden);
    if (document.hidden) {
      app.hidden();
      game.stop();
    } else {
      game.start();
    }
  });

  // A handle for the browser tests, which cannot ride a track to the finish by themselves.
  if (import.meta.env.DEV) Object.assign(window, { wheelie: { game, app } });

  // Offline play and installation as an app. Development always loads fresh code.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    // A worker taking over a page that already had one means a new version has been downloaded.
    const hadWorker = navigator.serviceWorker.controller !== null;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadWorker) app.updateAvailable();
    });
    navigator.serviceWorker
      .register(`${base}sw.js`)
      .then((registration) => {
        // An installed app can stay open for days; look for a new version whenever it comes back.
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) registration.update().catch(() => undefined);
        });
      })
      .catch((error) => console.warn('Offline mode is unavailable:', error));
  }

  // Installing as an app: browsers that support it say so with an event; Safari on iPhone and
  // iPad has only its Share menu. Inside somebody else's page neither applies.
  if (window.top === window) {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      app.installOffer = () => void (event as Event & { prompt(): Promise<unknown> }).prompt();
      app.menuChanged();
    });
    window.addEventListener('appinstalled', () => {
      app.installOffer = null;
      app.menuChanged();
    });
    if ('standalone' in navigator && navigator.standalone === false) app.installOffer = 'manual';
  }

  layout();
  app.start();
  game.start();

  // A link to a replay opens straight into it; the replay is then kept, so the address is cleaned.
  const openLink = () => {
    const fragment = location.hash;
    if (!isReplayFragment(fragment) && !isTrackFragment(fragment)) return;
    history.replaceState(null, '', location.pathname + location.search);
    if (isTrackFragment(fragment)) void app.openTrackLink(fragment);
    else void app.openLink(fragment);
  };
  window.addEventListener('hashchange', openLink);
  openLink();
}

main().catch((error) => {
  console.error(error);
  document.body.textContent = `${APP_NAME} failed to start. See the console for details.`;
});
