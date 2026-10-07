# Wheelie!

**An unofficial fan-made web port of Gravity Defied** — the classic 2004 trial racing game for J2ME phones, playable in the browser.

> **Status: early development.** The original game is playable at https://mihailpreis.github.io/Wheelie/ — all 30 tracks, menus, unlocks, high scores and options, with a keyboard, a gamepad or a touch screen, plus close to a thousand community level packs. It installs as an app and works offline. Replays and the editor are not there yet. The list below describes what is being built, not what exists today.

## What it is

Wheelie! is a port of the [Android remaster of Gravity Defied](https://github.com/evgenyzinoviev/gravitydefied) to the web. The goal is to keep the original physics, look and feel intact, and add the things a browser makes possible.

## Planned features

**The original game**

- The original bike physics, ported faithfully from the Android remaster
- The original graphics, menus and screens
- All leagues, tracks, unlocks, medals and high scores
- Keyboard, gamepad (Xbox, DualShock, DualSense) and touch controls

**Mods**

- The community level packs from [gdtr.net](https://gdtr.net/levels/), bundled with the game
- Install your own `levels.mrg` file

**Replays**

- Every run is recorded and can be watched again
- A replay player with seeking, pause and playback speed
- Share a replay as a file, or as a link that contains the whole replay
- Export a result as an image card or as an animated GIF

**Later**

- An online track and level pack editor

## Tech

TypeScript, Vite and Canvas 2D, with no game engine and no backend. The game is a static site, hosted on GitHub Pages and published on itch.io.

## Development

Requires Node.js 24+ and pnpm 12.

```
pnpm install
pnpm dev          # start the dev server
pnpm check        # lint and type-check
pnpm test         # unit tests, including the physics comparison against the original
pnpm test:e2e     # browser tests: smoke test and cross-engine determinism
pnpm build        # production build in dist/
```

### Level packs

`mods-src/` is a mirror of the level pack catalogue of gdtr.net: `catalog.json` and one `.mrg` file per
pack. `pnpm dev` and `pnpm build` pack it into `public/assets/mods/` — a compact catalogue and a few
chunk files, which the game fetches only when the player opens the Mods menu. `pnpm mods:mirror`
refreshes the mirror; it is run by hand and the result is committed.

### Physics fidelity

The simulation in `src/core` is an integer-only port of the original physics, and it has to match the
original bit for bit: a replay stores nothing but the player's inputs.

`tools/golden` compiles the unmodified Java sources of the Android port against small stand-ins for
the Android classes, runs them headless over a set of scenarios and records the inputs, statuses and
state hashes in `tests/golden`. The unit tests replay those recordings against the TypeScript port,
and the browser tests do the same in Chromium, Firefox and WebKit.

To regenerate the recordings (needs a JDK):

```
pnpm reference:fetch
pnpm golden:generate
```

## Credits

Wheelie! exists because of other people's work:

- **Gravity Defied — Trial Racing** was created by [Codebrew Software](http://codebrew.se) in 2004: Tors Björn Henrik Johansson, Set Elis Norman and Per David Jacobsson.
- **The Android port** this project is based on was made by Gregory Klyushnikov and Evgeny Zinoviev.
- **The level packs** were made by the gdtr.net community since 2007. Each pack is credited to its author in the game.
- **The music** is "Go" from *Three Red Hearts* by [Abstraction](https://abstractionmusic.com/), released into the public domain (CC0) as part of the [Music Loop Bundle](https://tallbeard.itch.io/music-loop-bundle).

## Disclaimer

This is a fan project. It is not affiliated with, endorsed by or connected to Codebrew Software in any way. All rights to the original Gravity Defied — its name, logo, brand and original assets — belong to Codebrew Software.

## License

[GNU General Public License v2.0](LICENSE.txt), the same license as the Android port this project is derived from.
