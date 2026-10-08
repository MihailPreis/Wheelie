# Changelog

Versions follow [Semantic Versioning](https://semver.org/). The version of the game is shown on
its About screen.

A change to the physics is a new `PHYSICS_VERSION` and is called out here: replays recorded with
another physics version cannot be played back.

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
