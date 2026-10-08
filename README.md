# Wheelie!

**An unofficial fan-made web port of Gravity Defied** — the classic 2004 trial racing game for J2ME phones, playable in the browser.

Play it at https://mihailpreis.github.io/Wheelie/. Changes from version to version are in [CHANGELOG.md](CHANGELOG.md).

## What it is

Wheelie! is a port of the [Android remaster of Gravity Defied](https://github.com/evgenyzinoviev/gravitydefied) to the web. The goal is to keep the original physics, look and feel intact, and add the things a browser makes possible.

## Features

**The original game**

- The original bike physics, ported line by line from the Android remaster and checked against it
- The original graphics, menus and screens
- All leagues, tracks, unlocks, medals and high scores
- Keyboard, gamepad (Xbox, DualShock, DualSense) and touch controls; the riding keys and buttons can be reassigned

**Mods**

- Close to a thousand community level packs from [gdtr.net](https://gdtr.net/levels/), bundled with the game, with search
- Install your own `levels.mrg` file

**Replays**

- Every run is recorded and can be watched again
- A replay player with seeking, pause, playback speed, marks on the timeline and a display of the keys held
- Share a replay as a file, or as a link that contains the whole replay
- Export a result as an image card with a QR code, or as an animated GIF
- Race any replay as a ghost
- Save all runs to one backup file; progress, high scores and achievements are worked out again from the runs when it is read

**More**

- A daily track, the same for everyone, and the tracks of the last thirty days
- A track editor: draw a track, test-drive it, share it as a link, save a `levels.mrg` pack
- Achievements
- English and Russian
- Installs as an app and works offline

### Embedding a replay

A replay link with `?embed=1` before the fragment shows that replay inside another page — the Share
screen of a run copies the code:

```html
<iframe src="https://mihailpreis.github.io/Wheelie/?embed=1#r=…" width="640" height="400" style="border:0" allowfullscreen></iframe>
```

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
pnpm package:itch # the same build zipped for itch.io; needs VITE_SHARE_BASE_URL
```

### Level packs

`mods-src/` is a mirror of the level pack catalogue of gdtr.net: `catalog.json` and one `.mrg` file per
pack. `pnpm dev` and `pnpm build` pack it into `public/assets/mods/` — a compact catalogue and a few
chunk files, which the game fetches only when the player opens the Mods menu. `mods-src/daily.json` lists the
tracks the daily track is drawn from — those the game's demo rider can finish — and is regenerated
with `pnpm mods:daily`. `pnpm mods:mirror`
refreshes the mirror; it is run by hand and the result is committed.

### Publishing

Every push to `main` builds the game, deploys it to GitHub Pages and keeps the zipped build as the
`wheelie-itch` artifact. With the repository secret `BUTLER_API_KEY` (an itch.io API key) and the
repository variable `ITCH_TARGET` (for example `user/game:html5`) set, the same build is also pushed
to itch.io. The version comes from `package.json`.

### Short links (optional)

A replay link carries the whole replay in the fragment of the address, which works without any
server but is long and shows no preview where it is posted. `worker/` is a small Cloudflare Worker
that stores a replay and its result card under a short identifier and serves a page with preview
tags that leads on to the game. To use it:

```
cd worker
npx wrangler kv namespace create LINKS   # put the printed id into wrangler.toml
npx wrangler deploy
```

Then build the game with `VITE_SHORT_LINK_API` set to the worker's address (for the Pages deploy:
the repository variable `SHORT_LINK_API`). Without it the game simply offers no short links.

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
