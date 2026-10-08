# Asset sources

## From the Android port

Everything under `public/assets/` except `audio/` is copied unchanged from the Android port of Gravity Defied
([evgenyzinoviev/gravitydefied](https://github.com/evgenyzinoviev/gravitydefied), commit `ee26c95`).

| Here | Original location | Notes |
|---|---|---|
| `sprites/1x/` | `res/drawable-mdpi/` | |
| `sprites/1.5x/` | `res/drawable-hdpi/` | |
| `sprites/2x/` | `res/drawable-xhdpi/` | The most complete set |
| `sprites/3x/` | `res/drawable-xxhdpi/` | |
| `levels/levels.mrg` | `assets/levels.mrg` | The 30 original tracks |
| `fonts/RobotoCondensed-Regular.ttf` | `assets/RobotoCondensed-Regular.ttf` | Roboto Condensed, Apache License 2.0 |

Not copied: the launcher icons (`icon*.png`, `ic_launcher.png`) and the Gravity Defied logo (`gd.png`).

The sets are not identical across densities — a few sprites exist only in some of them. Files named
`*.9.png` are Android nine-patch images: the outer one-pixel border encodes the stretch and content
areas and is not part of the picture.

The original graphics and tracks belong to Codebrew Software; the remastered sprites were made for
the Android port by its authors.

## Music

The previous nine-track playlist has been removed. The replacement shortlist focuses on
instrumental bass, drums and guitar, with one more electronic driving track:

| File | Title / author | Source |
|---|---|---|
| `audio/rocket-power.mp3` | Rocket Power — Kevin MacLeod | https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1600038 |
| `audio/cut-and-run.mp3` | Cut and Run — Kevin MacLeod | https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100851 |
| `audio/funky-chunk.mp3` | Funky Chunk — Kevin MacLeod | https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1500054 |

Downloaded unchanged from incompetech.com on 2026-10-09. Each track's official detail page
provides this attribution: "TITLE" Kevin MacLeod (incompetech.com), licensed under Creative
Commons: By Attribution 4.0 License (https://creativecommons.org/licenses/by/4.0/).
The game's About screen credits every title, author, source and licence.

Bass and drive is the default playlist; Funk and All tracks can be selected separately.
Playback uses a shuffle bag and 600 ms crossfades. Music and engine/effects have separate
saved speaker volume controls; speaker levels do not affect DualSense engine PCM.

## Engine recording

`public/assets/audio/motorcycle.mp3` is the user-supplied
`motorcycle-1000-cc-engine-start-idle.mp3`, copied without re-encoding. The original download
source and licence have not been supplied. Runtime loop selection and playback are described
in [dualsense.md](dualsense.md).

## Brand

`public/assets/brand/wordmark.svg` and `public/favicon.svg` are this project's own logo. The letters are
outlines of Roboto Condensed Bold Italic (SIL Open Font License 1.1). The PNG files next to them
(`preview.png` for link previews, `icon-512.png`, `apple-touch-icon.png`) are rendered from the SVG
sources with `node tools/render-brand.mjs`.

## Level packs

`mods-src/` mirrors the level packs published on [gdtr.net](https://gdtr.net/levels/) (996 packs as of
2026-10-08), fetched with `tools/mods/mirror.mjs`. The files are unchanged; names, authors and dates
come from the site's catalogue. The packs are the work of their authors, who are named in the game.

## Libraries

- [gifenc](https://github.com/mattdesl/gifenc) by Matt DesLauriers (MIT) encodes the animated GIF export.
