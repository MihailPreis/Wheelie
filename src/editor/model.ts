import { FILE_COORDINATE_LIMIT, FILE_UNIT, MAX_TRACK_POINTS, type TrackData } from '../formats/mrg';

/**
 * A track as the editor holds it. Coordinates are in file units — the whole numbers a level pack
 * stores, one of which is one dp on screen at the game's normal scale — with y pointing up.
 * Everything here keeps the track within what the pack format and the original game accept.
 */
export interface EditorTrack {
  name: string;
  /** The ground, left to right; x strictly increases. */
  points: { x: number; y: number }[];
  /** Where the bike is put down. */
  start: { x: number; y: number };
  finishX: number;
}

export const MIN_POINTS = 2;
/** Far below the format's 32767: the game checks every segment in view on every tick. */
export const MAX_POINTS = 2000;
export const NAME_LENGTH = 39;
/** How far above the ground the bike is put down, as in the original tracks. */
const START_HEIGHT = 18;
const LIMIT = FILE_COORDINATE_LIMIT;

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, Math.round(value)));

export function templateTrack(name: string): EditorTrack {
  const points = [
    [-320, 60],
    [-260, 10],
    [-200, 0],
    [-60, 0],
    [0, 12],
    [60, 0],
    [220, 0],
    [300, -30],
    [420, -30],
    [480, 0],
    [700, 0],
    [760, 40],
    [820, 90],
  ].map(([x, y]) => ({ x: x as number, y: y as number }));
  return { name, points, start: { x: -160, y: START_HEIGHT }, finishX: 660 };
}

/** Height of the ground at `x`; beyond the ends, the height of the nearest end. */
export function groundY(track: EditorTrack, x: number): number {
  const points = track.points;
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return 0;
  if (x <= first.x) return first.y;
  if (x >= last.x) return last.y;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as { x: number; y: number };
    const b = points[i] as { x: number; y: number };
    if (x <= b.x) return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
  }
  return last.y;
}

/**
 * Keeps the start and the finish where the game can use them: the start over the ground and
 * between the ends, the finish to the right of the start and before the last point.
 */
export function settle(track: EditorTrack): void {
  const first = track.points[0];
  const last = track.points[track.points.length - 1];
  if (!first || !last) return;
  track.start.x = clamp(track.start.x, first.x + 1, last.x - 2);
  track.start.y = clamp(track.start.y, Math.ceil(groundY(track, track.start.x)) + 8, LIMIT);
  track.finishX = clamp(track.finishX, track.start.x + 1, last.x - 1);
}

/** Moves a point, as far as its neighbours allow. */
export function movePoint(track: EditorTrack, index: number, x: number, y: number): void {
  const point = track.points[index];
  if (!point) return;
  const left = track.points[index - 1]?.x ?? -LIMIT - 1;
  const right = track.points[index + 1]?.x ?? LIMIT + 1;
  point.x = clamp(x, left + 1, right - 1);
  point.y = clamp(y, -LIMIT, LIMIT);
  settle(track);
}

/** Adds a point; returns its index, or -1 if there is no room for it there. */
export function insertPoint(track: EditorTrack, x: number, y: number): number {
  if (track.points.length >= MAX_POINTS) return -1;
  const px = clamp(x, -LIMIT, LIMIT);
  if (track.points.some((point) => point.x === px)) return -1;
  const index = track.points.findIndex((point) => point.x > px);
  const at = index < 0 ? track.points.length : index;
  track.points.splice(at, 0, { x: px, y: clamp(y, -LIMIT, LIMIT) });
  settle(track);
  return at;
}

export function removePoint(track: EditorTrack, index: number): boolean {
  if (track.points.length <= MIN_POINTS + 1 || !track.points[index]) return false;
  track.points.splice(index, 1);
  settle(track);
  return true;
}

export function cloneTrack(track: EditorTrack): EditorTrack {
  return {
    name: track.name,
    points: track.points.map((point) => ({ ...point })),
    start: { ...track.start },
    finishX: track.finishX,
  };
}

/** The track in the form the game and the pack writer take. */
export function toTrackData(track: EditorTrack): TrackData {
  const points = new Int32Array(track.points.length * 2);
  track.points.forEach((point, index) => {
    points[index * 2] = point.x * FILE_UNIT;
    points[index * 2 + 1] = point.y * FILE_UNIT;
  });
  return {
    startX: track.start.x * FILE_UNIT,
    startY: track.start.y * FILE_UNIT,
    finishX: track.finishX * FILE_UNIT,
    finishY: 0,
    points,
    pointCount: track.points.length,
    truncated: false,
  };
}

/** Takes an existing track into the editor. Null if it is too large or too small to edit. */
export function fromTrackData(name: string, data: TrackData): EditorTrack | null {
  if (data.pointCount < MIN_POINTS + 1 || data.pointCount > Math.min(MAX_POINTS, MAX_TRACK_POINTS)) return null;
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < data.pointCount; i++) {
    points.push({
      x: Math.round((data.points[i * 2] as number) / FILE_UNIT),
      y: Math.round((data.points[i * 2 + 1] as number) / FILE_UNIT),
    });
  }
  const track: EditorTrack = {
    name: name.slice(0, NAME_LENGTH),
    points,
    start: { x: Math.round(data.startX / FILE_UNIT), y: Math.round(data.startY / FILE_UNIT) },
    finishX: Math.round(data.finishX / FILE_UNIT),
  };
  settle(track);
  return track;
}

/** Whether a stored value is a track the editor can open. */
export function isEditorTrack(value: unknown): value is EditorTrack {
  const track = value as Partial<EditorTrack> | null;
  const whole = (number: unknown) =>
    typeof number === 'number' && Number.isInteger(number) && Math.abs(number) <= LIMIT;
  if (typeof track !== 'object' || track === null || typeof track.name !== 'string') return false;
  if (!Array.isArray(track.points) || track.points.length < MIN_POINTS + 1 || track.points.length > MAX_POINTS)
    return false;
  if (!track.start || !whole(track.start.x) || !whole(track.start.y) || !whole(track.finishX)) return false;
  return track.points.every(
    (point, index, all) =>
      point && whole(point.x) && whole(point.y) && (index === 0 || point.x > (all[index - 1]?.x ?? 0)),
  );
}
