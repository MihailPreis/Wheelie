# Changelog

Versions follow [Semantic Versioning](https://semver.org/). The version of the game is shown on
its About screen.

A change to the physics is a new `PHYSICS_VERSION` and is called out here: replays recorded with
another physics version cannot be played back.

## Unreleased

## 1.2.0 — 2026-10-09

### Added

- Direct GA4 events for runs, pauses, replays, editor testing, mod installations, exports and
  achievements. Select separate streams for GitHub Pages and itch.io at runtime, including the
  itch.io game iframe. Development and localhost do not send analytics; blocked analytics do
  not prevent the game from starting.
- An opt-in local regression command with Chromium and WebKit coverage for gameplay, menus,
  controller settings, replay timing, sharing and analytics blocking.

### Improved

- Hide distant perspective grid lines behind opaque white track surfaces on steep terrain.
- Reduce rendering work on long tracks with binary segment lookup, local shadow clipping and
  fewer allocations; avoid repainting white track surfaces and unnecessary canvas style writes.
- Give the replay timeline a 44px touch target on small screens and keep controls visible while focused.
- Prepare PNG/GIF files before sharing them with a fresh user gesture; retain prepared files
  after cancellation or failure and provide a download fallback.

### Fixed

- Show race time in the replay player from the start flag to the finish, including after seeking.
- End runs when the whole bike leaves the track or falls below its surface; hide shadows outside
  the track without changing the original physics.
- Use a single Exit to menu footer on riding and finish screens, separate from Continue or Restart.
  Submenus return to their parent without resuming the game; touch riding controls stay hidden in menus.
- Cancel high-score name edits with Back, preserve results when leaving the finish screen,
  remove duplicate message actions and confirm run deletion.
- Detect a held gamepad when starting a run after touch or keyboard menu input.
- Enable controller features only on their first connection and preserve manually chosen or
  previously saved settings across reconnections and reloads.

Physics version: 1; existing replays remain compatible. DualSense feedback and trigger tuning are unchanged.

## 1.1.0 — 2026-10-09

- DualSense Bluetooth input, automatic connection and feedback settings, engine PCM haptics,
  smooth analogue throttle/brake and adaptive trigger resistance; recover feedback after an output failure.
- Engine audio drawn from the supplied recording, with a long sustained stereo rev texture;
  independent music and engine/effects volume controls.
- Replace the previous music with Rocket Power, Cut and Run and Funky Chunk by Kevin MacLeod,
  credited under CC BY 4.0. Music is off by default.
- Simple lean arrows and play/stop throttle/brake icons in the riding controls and replay player.
- Softer shadows confined to the track; correct bike placement with perspective switched off.
- Start the ghost when the rider crosses the start flag, aligned to race time.
- Correct rider orientation during fast flips without changing the simulation.
- Consistent Back buttons at the bottom of submenus and option lists. Fresh menus select their
  primary action; pause offers Continue, a fallen rider Restart, confirmations No, and a completed
  level offers the next one. Reading screens open at the beginning.

Physics version: 1; existing replays remain compatible.

## 1.0.0

The first public release.

- The original game: physics ported line by line and checked against the original code, the 30
  original tracks, three levels, four leagues, unlocks, high scores, options and the three keysets.
- Keyboard, gamepad and touch controls; the riding keys and buttons can be reassigned.
- Replays: every run is recorded and can be watched with pause, seeking, speed control, marks on
  the timeline and a display of the keys held.
- Sharing: a run as a link that carries the whole replay, as a file, as an image card with a QR
  code, as an animated GIF, or embedded in another page.
- Ghost: race your own best run or any replay you were sent.
- Daily track, the same for everyone, with the tracks of the last thirty days.
- Close to a thousand level packs by the gdtr.net community, with search; your own `levels.mrg`
  files can be installed too.
- Track editor with a test drive, three levels, import of whole packs, tracks shared as links and
  export to `levels.mrg`.
- Achievements.
- All runs in one backup file; progress, high scores and achievements are worked out from the runs.
- English and Russian.
- Works offline and installs as an app.

Physics version: 1.
