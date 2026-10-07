import { parsePackHeader, parseTrack } from './formats/mrg';
import { Game, type Track } from './game/game';
import { Input } from './game/input';
import { fitCanvas } from './render/canvas';
import { GAME_FONT } from './render/hud';
import { loadSprites } from './render/sprites';
import './style.css';
import { Keypad } from './ui/keypad';

// Temporary shell until the menus exist: plays the original pack straight away.
//   ?level=0..2 &track=0.. &league=0..3   choose what to ride
//   R restart, [ and ] previous and next track, L next league

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game');
  if (!canvas) throw new Error('Game canvas is missing');
  const base = import.meta.env.BASE_URL;

  const [sprites, packResponse] = await Promise.all([
    loadSprites(base),
    fetch(`${base}assets/levels/levels.mrg`),
    document.fonts.load(`18px ${GAME_FONT}`),
  ]);
  if (!packResponse.ok) throw new Error('Failed to load the level pack');
  const pack = new Uint8Array(await packResponse.arrayBuffer());
  const tracks: Track[][] = parsePackHeader(pack).levels.map((level) =>
    level.map((entry) => ({ name: entry.name, data: parseTrack(pack, entry.offset) })),
  );

  const params = new URLSearchParams(location.search);
  const param = (name: string, limit: number) => {
    const value = Number.parseInt(params.get(name) ?? '0', 10);
    return Number.isFinite(value) ? Math.max(0, Math.min(limit - 1, value)) : 0;
  };
  let level = param('level', tracks.length);
  let index = param('track', tracks[level]?.length ?? 1);
  let league = param('league', 4);

  const input = new Input();
  const game = new Game(canvas, sprites, input);
  const keypad = new Keypad(input);
  document.body.append(keypad.element);

  const layout = () => {
    document.documentElement.style.setProperty('--dp', String(game.scale));
    game.keypadHeight = keypad.height;
  };
  const showKeypad = (visible: boolean) => {
    keypad.visible = visible;
    layout();
  };
  fitCanvas(canvas, layout);
  input.onDeviceChange = (device) => showKeypad(device === 'touch');
  if (matchMedia('(pointer: coarse)').matches) showKeypad(true);

  const load = () => {
    const track = tracks[level]?.[index];
    if (track) game.load(track, league);
  };
  const step = (delta: number) => {
    const flat = tracks.flatMap((list, l) => list.map((_, t) => [l, t] as const));
    const at = flat.findIndex(([l, t]) => l === level && t === index);
    const next = flat[(at + delta + flat.length) % flat.length];
    if (!next) return;
    [level, index] = next;
    load();
  };

  window.addEventListener('keydown', (event) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (input.keyDown(event.code)) {
      event.preventDefault();
      return;
    }
    if (event.code === 'KeyR') game.restart();
    else if (event.code === 'BracketLeft') step(-1);
    else if (event.code === 'BracketRight') step(1);
    else if (event.code === 'KeyL') {
      league = (league + 1) % 4;
      load();
    }
  });
  window.addEventListener('keyup', (event) => input.keyUp(event.code));
  window.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch' && !keypad.visible) input.touch(event.pointerId, null);
  });
  window.addEventListener('blur', () => input.release());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      input.release();
      game.stop();
    } else {
      game.start();
    }
  });

  game.onFinish = () => step(1);
  load();
  game.start();
}

main().catch((error) => {
  console.error(error);
  document.body.textContent = 'Wheelie! failed to start. See the console for details.';
});
