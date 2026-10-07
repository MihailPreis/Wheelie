# Replay format (`.gdr`), version 1

A replay holds the player's inputs, one per simulation tick, and enough to find the track and check
the result. Watching a replay means running the simulation again with the same inputs, so a replay
is only valid for the version of the physics it was recorded with.

The reader is `src/formats/replay.ts`. It treats every file as untrusted: all lengths are bounded and
anything inconsistent is rejected.

## Encoding

- **varint** — unsigned LEB128, at most 5 bytes, value below 2³².
- **signed** — a 32-bit integer zigzag-encoded (`(n << 1) ^ (n >> 31)`) and written as a varint.
- **uint32** — 4 bytes, little-endian.
- **text** — a varint byte length (at most 120) followed by UTF-8.

## Layout

| Field | Type | Notes |
|---|---|---|
| magic | 4 bytes | `47 44 52 1A` (`GDR`, then SUB) |
| format version | varint | `1` |
| physics version | varint | `PHYSICS_VERSION` of the game that recorded the run |
| flags | byte | bit 0: track data follows the header; bit 1: wheelie (front wheel never touched the ground) |
| pack | text | `original`, `gdtr-<id>` for a pack of the gdtr.net catalogue, `file-<hash>` for a player's own file |
| level | varint | 0 easy, 1 medium, 2 hard |
| track | varint | index within the level |
| league | varint | 0–3 |
| track hash | uint32 | FNV-1a over start, finish, point count and points of the track |
| track name | text | |
| player | text | |
| date | varint | seconds since the Unix epoch |
| outcome | byte | 0 abandoned, 1 crashed, 2 finished |
| time | varint | race time in milliseconds; 0 unless finished |
| final hash | uint32 | hash of the simulation state after the last tick |
| track data | optional | present if flag bit 0 is set, see below |
| ticks | varint | number of simulation ticks, at most 400 000 |
| input runs | bytes | see below |

### Track data

`startX`, `startY`, `finishX`, `finishY` as signed values, then the point count as a varint (at most
100 000), then for each point the difference of x and of y from the previous point (the first from
0, 0) as signed values. Coordinates are the 16.16 fixed-point values the simulation uses.

### Input runs

The input of one tick is a code `(throttle + 1) * 3 + (lean + 1)`, where throttle is 1 (accelerate),
0 or -1 (brake) and lean is 1 (forward), 0 or -1 (back). Equal consecutive ticks are stored as a run:

- one byte: the code in the low four bits and the run length (1–15) in the high four bits;
- or, if the high four bits are zero, the run length follows as a varint.

The run lengths must add up to exactly `ticks`, and nothing may follow the last run.

## Compatibility

Readers must keep accepting every published format version. A replay whose physics version differs
from the game's is not played back as if it matched.
