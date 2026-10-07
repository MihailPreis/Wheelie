# Wheelie!

**An unofficial fan-made web port of Gravity Defied** — the classic 2004 trial racing game for J2ME phones, playable in the browser.

> **Status: early development.** There is nothing playable yet. This repository currently holds the project setup; the list below describes what is being built, not what exists today.

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

## Credits

Wheelie! exists because of other people's work:

- **Gravity Defied — Trial Racing** was created by [Codebrew Software](http://codebrew.se) in 2004: Tors Björn Henrik Johansson, Set Elis Norman and Per David Jacobsson.
- **The Android port** this project is based on was made by Gregory Klyushnikov and Evgeny Zinoviev.
- **The level packs** were made by the gdtr.net community since 2007. Each pack is credited to its author in the game.

## Disclaimer

This is a fan project. It is not affiliated with, endorsed by or connected to Codebrew Software in any way. All rights to the original Gravity Defied — its name, logo, brand and original assets — belong to Codebrew Software.

## License

[GNU General Public License v2.0](LICENSE.txt), the same license as the Android port this project is derived from.
