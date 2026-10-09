import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import type { Pose } from '../../src/core/sim';
import { Sim, Status } from '../../src/core/sim';
import type { Terrain } from '../../src/core/terrain';
import { PHYSICS_VERSION } from '../../src/core/version';
import { parsePackHeader, parseTrack } from '../../src/formats/mrg';
import { decodeReplay, encodeReplay, hashTrack, inputCode, Outcome } from '../../src/formats/replay';
import type { Animator } from '../../src/render/animator';
import type { SceneRenderer } from '../../src/render/scene';

const pack = new Uint8Array(readFileSync('public/assets/levels/levels.mrg'));
const track = parseTrack(pack, parsePackHeader(pack).levels[0]?.[0]?.offset ?? 0);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [] });
    Object.defineProperty(navigator, 'hid', { configurable: true, value: undefined });
  });
});

/** A reproducible unfinished recording, without depending on real-time riding or saved user data. */
function link(ticks = 200, finished = false): string {
  const sim = new Sim({ track, league: 0, demo: false });
  let inputs = new Uint8Array(ticks).fill(inputCode(0, 0));
  for (let tick = 0; tick < ticks; tick++) sim.step(0, 0);
  let time = 0;
  if (finished) {
    const codes = [...inputs];
    for (let tick = 0; tick < 4000; tick++) {
      codes.push(inputCode(1, 0));
      const status = sim.step(1, 0);
      if (status === Status.Finished || status === Status.FinishedLate) {
        time = sim.raceTime;
        break;
      }
    }
    if (!time) throw new Error('Fixture did not finish');
    for (let tick = 0; tick < 300; tick++) {
      codes.push(inputCode(0, 0));
      sim.step(0, 0);
    }
    inputs = Uint8Array.from(codes);
  }
  const bytes = encodeReplay({
    physicsVersion: PHYSICS_VERSION,
    packId: 'original',
    level: 0,
    track: 0,
    league: 0,
    trackHash: hashTrack(track),
    trackName: 'Intro',
    player: 'AAA',
    date: 1_791_504_000,
    outcome: finished ? Outcome.Finished : Outcome.Abandoned,
    wheelie: false,
    time,
    finalHash: sim.hash() >>> 0,
    inputs,
    trackData: null,
  });
  return `/#r=p${Buffer.from(bytes).toString('base64url')}`;
}

const pick = (page: Page, label: string) => page.locator('.menu-label').filter({ hasText: label }).first().click();

async function openShare(page: Page): Promise<void> {
  await page.goto(link());
  await expect(page.locator('.player')).toBeVisible();
  await page.keyboard.press('Escape');
  await pick(page, 'My runs');
  await pick(page, 'Intro');
  await pick(page, 'Share');
  await expect(page.locator('.menu-title')).toHaveText('Share');
}

interface SharedFile {
  name: string;
  type: string;
  header: number[];
  activated: boolean;
}

async function mockShare(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = { files: [] as SharedFile[], mode: 'success' };
    Object.assign(window, { sharingTest: state });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        const file = data.files?.[0];
        if (!file) throw new Error('Expected a file');
        const activated = navigator.userActivation.isActive;
        state.files.push({
          name: file.name,
          type: file.type,
          activated,
          header: [...new Uint8Array(await file.slice(0, 6).arrayBuffer())],
        });
        if (state.mode === 'abort') throw new DOMException('Cancelled', 'AbortError');
        if (state.mode === 'error') throw new DOMException('Unavailable', 'NotAllowedError');
      },
    });
  });
}

test('PNG and GIF sharing passes real files from a fresh user gesture', async ({ page }) => {
  await mockShare(page);
  await openShare(page);
  for (const [button, type, extension, magic] of [
    ['Save image', 'image/png', '.png', [137, 80, 78, 71]],
    ['Save GIF', 'image/gif', '.gif', [71, 73, 70, 56, 57, 97]],
  ] as const) {
    await pick(page, button);
    await expect(page.locator('.menu-text').nth(1)).toHaveText('Ready. Tap Share to send the file.', {
      timeout: 15_000,
    });
    await pick(page, 'Share file');
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { sharingTest: { files: SharedFile[] } }).sharingTest.files.at(-1)?.type,
        ),
      )
      .toBe(type);
    const file = await page.evaluate(() =>
      (window as unknown as { sharingTest: { files: SharedFile[] } }).sharingTest.files.at(-1),
    );
    expect(file?.name.endsWith(extension)).toBe(true);
    expect(file?.header.slice(0, magic.length)).toEqual([...magic]);
    expect(file?.activated).toBe(true);
  }
});

test('cancelled sharing retains the prepared file; errors allow download and retry', async ({ page }) => {
  await mockShare(page);
  await openShare(page);
  await pick(page, 'Save image');
  const status = page.locator('.menu-text').nth(1);
  await expect(status).toContainText('Ready.');
  const mode = (value: string) =>
    page.evaluate((value) => {
      (window as unknown as { sharingTest: { mode: string } }).sharingTest.mode = value;
    }, value);
  await mode('abort');
  await pick(page, 'Share file');
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { sharingTest: { files: SharedFile[] } }).sharingTest.files.length),
    )
    .toBe(1);
  await expect(status).toContainText('Ready.');
  await mode('error');
  await pick(page, 'Share file');
  await expect(status).toContainText('That did not work in this browser.');
  const [download] = await Promise.all([page.waitForEvent('download'), pick(page, 'Download file')]);
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  await mode('success');
  await pick(page, 'Share file');
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { sharingTest: { files: SharedFile[] } }).sharingTest.files.length),
    )
    .toBe(3);
});

test('unsupported file sharing falls back to a PNG download', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false }),
  );
  await openShare(page);
  const [download] = await Promise.all([page.waitForEvent('download'), pick(page, 'Save image')]);
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  expect([...readFileSync(await download.path()).subarray(0, 4)]).toEqual([137, 80, 78, 71]);
  await expect(page.locator('.menu-label').filter({ hasText: 'Share file' })).toHaveCount(0);
});

test('a 320px replay timeline has a 44px target and still seeks', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(link(4000));
  const player = page.locator('.player');
  await expect(player).toBeVisible();
  const timeline = page.locator('.player-timeline');
  const box = await timeline.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await timeline.click({ position: { x: (box?.width ?? 100) * 0.75, y: 42 } });
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { wheelie: { game: { position: number } } }).wheelie.game.position),
    )
    .toBeGreaterThan(2800);
  await page.screenshot({ path: testInfo.outputPath('timeline-320.png') });
});

test('the replay panel stays visible while focused and resumes hiding after focus leaves', async ({ page }) => {
  await page.goto(link(4000));
  const player = page.locator('.player');
  await expect(player).toBeVisible();
  await page.locator('.player-speed').focus();
  const expire = () =>
    page.evaluate(async () => {
      const controls = (window as unknown as { wheelie: { app: { controls: { lastInput: number } } } }).wheelie.app
        .controls;
      controls.lastInput = performance.now() - 3000;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
  await expire();
  await expect(player).not.toHaveClass(/player-idle/);
  await page.locator('.player-speed').evaluate((button) => button.blur());
  await expire();
  await expect(player).toHaveClass(/player-idle/);
  await page.locator('.player-speed').focus();
  await expect(player).not.toHaveClass(/player-idle/);
});

test('the replay clock excludes the approach and freezes at the finish even after seeking', async ({ page }) => {
  const url = link(40, true);
  const replay = decodeReplay(new Uint8Array(Buffer.from(url.split('#r=p')[1] ?? '', 'base64url')));
  const sim = new Sim({ track, league: 0, demo: false });
  let startTick = 0;
  let finishTick = 0;
  for (let tick = 0; tick < replay.inputs.length; tick++) {
    const status = sim.step(tick < 40 || finishTick > 0 ? 0 : 1, 0);
    if (!startTick && status !== Status.BeforeStart) startTick = sim.ticks;
    if (status === Status.Finished || status === Status.FinishedLate) {
      finishTick = sim.ticks;
      break;
    }
  }
  expect(startTick).toBeGreaterThan(40);
  expect(finishTick).toBeGreaterThan(startTick + 100);
  await page.goto(url);
  await expect(page.locator('.player')).toBeVisible();
  const seek = (tick: number) =>
    page.evaluate((tick) => {
      const game = (window as unknown as { wheelie: { game: { paused: boolean; seek(tick: number): void } } }).wheelie
        .game;
      game.paused = true;
      game.seek(tick);
    }, tick);
  const clock = page.locator('.player-clock');
  await seek(20);
  await expect(clock).toHaveText('0:00:00');
  await seek(startTick + 100);
  await expect(clock).toHaveText('0:01:50');
  const minutes = Math.floor(replay.time / 60_000);
  const seconds = String(Math.floor(replay.time / 1000) % 60).padStart(2, '0');
  const hundredths = String(Math.floor(replay.time / 10) % 100).padStart(2, '0');
  const finalClock = `${minutes}:${seconds}:${hundredths}`;
  await seek(replay.inputs.length);
  await expect(clock).toHaveText(finalClock);
  await seek(finishTick);
  await expect(clock).toHaveText(finalClock);
  await seek(startTick + 100);
  await expect(clock).toHaveText('0:01:50');
  await seek(0);
  await expect(clock).toHaveText('0:00:00');
});

async function mainMenu(page: Page): Promise<void> {
  await page.goto('/');
  await page.keyboard.press('Enter');
  await expect(page.locator('.menu-title')).toHaveText('Main');
}

test('riding menus have one exit footer; submenus return to the paused game', async ({ page }, testInfo) => {
  await mainMenu(page);
  await pick(page, 'Play Menu');
  await pick(page, 'Start>');
  await expect(page.locator('.menu')).toBeHidden();
  await page.keyboard.press('Escape');
  const footer = page.locator('.menu-back');
  const labels = page.locator('.menu-item .menu-label');
  await expect(labels).toHaveText(['Continue', 'Restart: Intro', 'Options', 'Help', 'Exit to menu']);
  await expect(footer).toHaveText('Exit to menu');
  await page.screenshot({ path: testInfo.outputPath('pause-desktop.png') });
  await page.setViewportSize({ width: 320, height: 640 });
  await expect(footer).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('pause-320.png') });
  await pick(page, 'Options');
  await expect(footer).toHaveText('Back');
  await pick(page, 'Screen');
  await expect(footer).toHaveText('Back');
  await footer.click();
  await expect(page.locator('.menu-title')).toHaveText('Options');
  await footer.click();
  await expect(page.locator('.menu-title')).toHaveText('Ingame');
  expect(
    await page.evaluate(() => (window as unknown as { wheelie: { game: { paused: boolean } } }).wheelie.game.paused),
  ).toBe(true);
  await pick(page, 'Continue');
  await expect(page.locator('.menu')).toBeHidden();
  await page.keyboard.press('Escape');
  await footer.click();
  await expect(page.locator('.menu-title')).toHaveText('Play');
  await pick(page, 'Start>');
  await expect(page.locator('.menu')).toBeHidden();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu-title')).toHaveText('Play');
});

test('daily pause and a fallen rider exit to the daily menu without restarting', async ({ page }) => {
  await mainMenu(page);
  await pick(page, 'Daily track');
  await expect(page.locator('.menu-title')).toHaveText('Daily track');
  await pick(page, 'Start>');
  await expect(page.locator('.menu')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu-item .menu-label')).toHaveText([
    'Continue',
    'Restart',
    'Options',
    'Help',
    'Exit to menu',
  ]);
  await pick(page, 'Help');
  await expect(page.locator('.menu-back')).toHaveText('Back');
  await page.locator('.menu-back').click();
  await expect(page.locator('.menu-title')).toHaveText('Ingame');
  await page.locator('.menu-back').click();
  await expect(page.locator('.menu-title')).toHaveText('Daily track');
  await pick(page, 'Start>');
  await expect(page.locator('.menu')).toBeHidden();
  await page.evaluate(() => {
    const game = (window as unknown as { wheelie: { game: { phase: string; phaseTicks: number } } }).wheelie.game;
    game.phase = 'crashed';
    game.phaseTicks = 10000;
  });
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu-item.selected .menu-label')).toHaveText('Restart');
  await expect(page.locator('.menu-item .menu-label')).toHaveText(['Restart', 'Options', 'Help', 'Exit to menu']);
  await page.locator('.menu-back').click();
  await expect(page.locator('.menu-title')).toHaveText('Daily track');
});

test('back cancels a changed score name; exiting the finish saves the score and progress', async ({ page }) => {
  await mainMenu(page);
  await pick(page, 'Play Menu');
  await pick(page, 'Start>');
  await expect(page.locator('.menu')).toBeHidden();
  await page.evaluate(() => {
    (
      window as unknown as { wheelie: { game: { onFinish(result: { time: number; wheelie: boolean }): void } } }
    ).wheelie.game.onFinish({ time: 12340, wheelie: false });
  });
  await expect(page.locator('.menu-back')).toHaveText('Exit to menu');
  await pick(page, 'Name -');
  await page.keyboard.type('mik');
  await page.locator('.menu-back').click();
  await expect(page.locator('.menu-title')).toHaveText('Finished!');
  await expect(page.locator('.menu-label').filter({ hasText: 'Name -' })).toHaveText('Name - AAA');
  await page.locator('.menu-back').click();
  await expect(page.locator('.menu-title')).toHaveText('Play');
  await pick(page, 'Track');
  await pick(page, 'Intro');
  await pick(page, 'High Scores');
  await expect(page.locator('.menu-text').nth(1)).toContainText('1. AAA 00:12.34');
  await page.locator('.menu-back').click();
  await pick(page, 'Track');
  await expect(page.locator('.menu-item').nth(1).locator('.menu-lock')).toHaveCount(0);
});

test('run deletion requires confirmation and ordinary messages have only Back', async ({ page }) => {
  await openShare(page);
  await page.locator('.menu-back').click();
  await pick(page, 'Delete');
  await expect(page.locator('.menu-title')).toHaveText('Delete run');
  await expect(page.locator('.menu-item.selected .menu-label')).toHaveText('No');
  await page.locator('.menu-back').click();
  await expect(page.locator('.menu-title')).toHaveText('My runs');
  await pick(page, 'Delete');
  await pick(page, 'No');
  await expect(page.locator('.menu-label').filter({ hasText: 'Watch' })).toHaveCount(1);
  await pick(page, 'Delete');
  await pick(page, 'Yes');
  await expect(page.locator('.menu-text').first()).toHaveText('No runs yet. Every run you make is recorded here.');
  await page.locator('.menu-back').click();
  await pick(page, 'Options');
  await pick(page, 'Clear highscore');
  await pick(page, 'Yes');
  await expect(page.locator('.menu-title')).toHaveText('Cleared');
  await expect(page.locator('.menu-item .menu-label')).toHaveText(['Back']);
  await page.locator('.menu-back').click();
  await expect(page.locator('.menu-title')).toHaveText('Options');
});

test('a track named Back remains selectable separately from the navigation footer', async ({ page }) => {
  await mainMenu(page);
  await page.evaluate(() => {
    const actions = { track: 0, back: 0 };
    Object.assign(window, { menuActions: actions });
    const menu = (window as unknown as { wheelie: { app: { menu: { show(screen: unknown): void } } } }).wheelie.app
      .menu;
    menu.show({
      title: 'Track',
      back: () => actions.back++,
      items: [
        { kind: 'action', label: 'Back', run: () => actions.track++ },
        { kind: 'action', label: 'Other', run: () => undefined },
      ],
    });
  });
  await expect(page.locator('.menu-item .menu-label')).toHaveText(['Back', 'Other', 'Back']);
  await page.locator('.menu-item').first().click();
  await page.locator('.menu-back').click();
  expect(
    await page.evaluate(() => (window as unknown as { menuActions: { track: number; back: number } }).menuActions),
  ).toEqual({ track: 1, back: 1 });
});

test('opaque perspective hides distant grid lines while preserving the riding edge and simulation', async ({
  page,
}, testInfo) => {
  await mainMenu(page);
  const result = await page.evaluate(async () => {
    const load = (path: string) => import(path);
    const { Terrain } = (await load('/src/core/terrain.ts')) as typeof import('../../src/core/terrain');
    const { createPose } = (await load('/src/core/sim.ts')) as typeof import('../../src/core/sim');
    const { Animator } = (await load('/src/render/animator.ts')) as typeof import('../../src/render/animator');
    const { shadowDepth } = (await load('/src/render/shadow.ts')) as typeof import('../../src/render/shadow');
    type Renderer = {
      draw: SceneRenderer['draw'];
      drawTrackBack(terrain: Terrain, pose: Pose, animator: Animator, left: number, right: number): void;
      ctx: CanvasRenderingContext2D;
      originX: number;
      originY: number;
    };
    const game = (
      window as unknown as {
        wheelie: { game: { renderer: Renderer; stop(): void; sim: { hash(): number; capture(pose: Pose): void } } };
      }
    ).wheelie.game;
    game.stop();
    const hash = game.sim.hash();
    const points = [
      0, 0, 10, 2, 20, 4, 22, -14, 24, 2, 30, 0, 38, 2, 40, -22, 42, 2, 52, 3, 62, 5, 64, -14, 66, 4, 80, 0,
    ];
    const terrain = new Terrain({
      points: Int32Array.from(points, (value) => value * 65536),
      pointCount: points.length / 2,
      startX: 2 * 65536,
      startY: 5 * 65536,
      finishX: 78 * 65536,
      finishY: 0,
      truncated: false,
    });
    const pose = createPose();
    game.sim.capture(pose);
    const dx = 50 * 65536 * 2 - (pose.x[0] as number);
    const dy = 10 * 65536 * 2 - (pose.y[0] as number);
    for (let i = 0; i < pose.x.length; i++) {
      pose.x[i] = (pose.x[i] as number) + dx;
      pose.y[i] = (pose.y[i] as number) + dy;
    }
    const canvas = (id: string) => {
      const node = document.createElement('canvas');
      node.id = id;
      node.width = 900;
      node.height = 520;
      node.style.cssText = 'position:fixed;top:0;left:0;z-index:10000;background:white';
      document.body.append(node);
      return node;
    };
    const before = canvas('perspective-before');
    const after = canvas('perspective-after');
    const renderer = game.renderer;
    const original = renderer.drawTrackBack;
    const options = { perspective: true, shadows: true, driverSprite: true, bikeSprite: true, dimmed: false };
    const draw = (node: HTMLCanvasElement) =>
      renderer.draw(
        node.getContext('2d') as CanvasRenderingContext2D,
        { width: 900, height: 520, lift: 0 },
        terrain,
        pose,
        new Animator(),
        0,
        options,
      );
    renderer.drawTrackBack = function (...args) {
      original.apply(this, args);
      const eyeX = ((pose.x[0] as number) * 4) / 65536;
      const eyeY = ((pose.y[0] as number) * 4) / 65536 + 400;
      this.ctx.strokeStyle = 'rgb(0,170,0)';
      const line = (x: number, y: number, x2: number, y2: number) => {
        this.ctx.beginPath();
        this.ctx.moveTo(x + this.originX, -y + this.originY);
        this.ctx.lineTo(x2 + this.originX, -y2 + this.originY);
        this.ctx.stroke();
      };
      for (let i = 0; i < terrain.pointCount - 1; i++) {
        const x = ((terrain.points[i * 2] as number) * 8) / 65536;
        const y = ((terrain.points[i * 2 + 1] as number) * 8) / 65536;
        const x2 = ((terrain.points[i * 2 + 2] as number) * 8) / 65536;
        const y2 = ((terrain.points[i * 2 + 3] as number) * 8) / 65536;
        const [dx, dy] = shadowDepth(x, y, eyeX, eyeY);
        const [dx2, dy2] = shadowDepth(x2, y2, eyeX, eyeY);
        line(x + dx, y + dy, x2 + dx2, y2 + dy2);
        line(x, y, x + dx, y + dy);
      }
    };
    try {
      draw(before);
    } finally {
      renderer.drawTrackBack = original;
    }
    draw(after);
    const a = before.getContext('2d')?.getImageData(0, 0, 900, 520).data;
    const b = after.getContext('2d')?.getImageData(0, 0, 900, 520).data;
    if (!a || !b) throw new Error('Missing pixels');
    let hidden = 0;
    let nearBefore = 0;
    let nearAfter = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (
        (a[i + 1] as number) > (a[i] as number) + 20 &&
        (a[i + 1] as number) > (a[i + 2] as number) + 20 &&
        (b[i] as number) >= 254 &&
        (b[i + 1] as number) >= 254 &&
        (b[i + 2] as number) >= 254
      )
        hidden++;
      if (a[i] === 0 && a[i + 1] === 255 && a[i + 2] === 0) nearBefore++;
      if (b[i] === 0 && b[i + 1] === 255 && b[i + 2] === 0) nearAfter++;
    }
    return { hidden, nearBefore, nearAfter, sameHash: hash === game.sim.hash() };
  });
  await page.locator('#perspective-after').screenshot({ path: testInfo.outputPath('perspective-after.png') });
  await page.locator('#perspective-after').evaluate((node) => {
    node.style.display = 'none';
  });
  await page.locator('#perspective-before').screenshot({ path: testInfo.outputPath('perspective-before.png') });
  expect(result.hidden, JSON.stringify(result)).toBeGreaterThan(10);
  expect(result.nearAfter).toBe(result.nearBefore);
  expect(result.sameHash).toBe(true);
});

test('game events describe actions without sending player names or replay data', async ({ page }) => {
  await mainMenu(page);
  await page.evaluate(async () => {
    const path = '/src/services/events.ts';
    const { setAnalyticsSender } = await import(path);
    const events: { name: string; parameters: unknown }[] = [];
    Object.assign(window, { analyticsTest: events });
    setAnalyticsSender((name: string, parameters: unknown) => events.push({ name, parameters }));
  });
  await pick(page, 'Play Menu');
  await pick(page, 'Start>');
  await expect(page.locator('.menu')).toBeHidden();
  await page.evaluate(() => {
    const game = (window as unknown as { wheelie: { game: { stop(): void; tick(): void } } }).wheelie.game;
    game.stop();
    game.tick();
  });
  await page.keyboard.press('Escape');
  await pick(page, 'Continue');
  await page.keyboard.press('Escape');
  await pick(page, 'Restart');
  await expect(page.locator('.menu')).toBeHidden();
  await page.evaluate(() => {
    const game = (window as unknown as { wheelie: { game: { stop(): void; tick(): void } } }).wheelie.game;
    game.stop();
    game.tick();
  });
  await page.keyboard.press('Escape');
  await page.locator('.menu-back').click();
  const events = await page.evaluate(
    () => (window as unknown as { analyticsTest: { name: string; parameters: unknown }[] }).analyticsTest,
  );
  expect(events.filter((event) => event.name === 'run_start')).toHaveLength(2);
  expect(events.filter((event) => event.name === 'run_end')).toHaveLength(2);
  expect(events.some((event) => event.name === 'game_pause')).toBe(true);
  expect(events.some((event) => event.name === 'game_resume')).toBe(true);
  expect(JSON.stringify(events)).not.toMatch(/AAA|trackName|player|inputs|finalHash/);
});

test('development starts and plays when analytics module URLs are blocked', async ({ page }) => {
  const requested: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/src/analytics/**', (route) => route.abort('blockedbyclient'));
  await page.route('**/www.googletagmanager.com/**', (route) => route.abort('blockedbyclient'));
  await mainMenu(page);
  await pick(page, 'Play Menu');
  await pick(page, 'Start>');
  await expect(page.locator('.menu')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu-title')).toHaveText('Ingame');
  expect(requested.filter((url) => url.includes('/src/analytics/') || url.includes('googletagmanager.com'))).toEqual(
    [],
  );
  expect(errors).toEqual([]);
});
