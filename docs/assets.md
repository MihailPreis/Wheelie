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

| Here | Source | Licence |
|---|---|---|
| `audio/go.ogg` | "Go" from the album *Three Red Hearts* by Abstraction (Benjamin Burnes), from the [Music Loop Bundle](https://tallbeard.itch.io/music-loop-bundle) published by Tallbeard Studios | CC0 1.0 (public domain) |

The file is the original Ogg Vorbis, unmodified: it is authored to loop seamlessly, and re-encoding
or converting it to MP3 would add a gap at the loop point.

## Brand

`public/assets/brand/wordmark.svg` and `public/favicon.svg` are this project's own logo. The letters are
outlines of Roboto Condensed Bold Italic (SIL Open Font License 1.1). The PNG files next to them
(`preview.png` for link previews, `icon-512.png`, `apple-touch-icon.png`) are rendered from the SVG
sources with `node tools/render-brand.mjs`.

## Level packs

`mods-src/` mirrors the level packs published on [gdtr.net](https://gdtr.net/levels/) (996 packs as of
2026-10-08), fetched with `tools/mods/mirror.mjs`. The files are unchanged; names, authors and dates
come from the site's catalogue. The packs are the work of their authors, who are named in the game.
