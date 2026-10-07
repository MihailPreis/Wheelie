# Asset sources

Everything under `public/assets/` is copied unchanged from the Android port of Gravity Defied
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
