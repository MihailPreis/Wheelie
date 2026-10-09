import { expect, it } from 'vitest';
import { surfaceFace, surfaceIndex, visibleSurfaceLine } from './track-surface';

const face = surfaceFace([
  { x: 0, y: 0, depth: 0 },
  { x: 10, y: 0, depth: 0 },
  { x: 10, y: 10, depth: 1 },
  { x: 0, y: 10, depth: 1 },
]);

it('hides only the part of a distant line covered by a closer surface', () => {
  const visible = visibleSurfaceLine({ x: -5, y: 5, depth: 1 }, { x: 15, y: 5, depth: 1 }, [face], -1);
  expect(visible.map(([a, b]) => [a.x, b.x])).toEqual([
    [-5, 0],
    [10, 15],
  ]);
});

it('keeps a closer line and a shared edge at equal depth visible', () => {
  for (const depth of [0.25, 0.5]) {
    const from = { x: -5, y: 5, depth };
    const to = { x: 15, y: 5, depth };
    expect(visibleSurfaceLine(from, to, [face], -1)).toEqual([[from, to]]);
  }
});

it('clips a connector where its depth crosses the covering surface', () => {
  const visible = visibleSurfaceLine({ x: 0, y: 5, depth: 0 }, { x: 10, y: 5, depth: 1 }, [face], -1);
  expect(visible).toHaveLength(1);
  expect(visible[0]?.[1].x).toBeCloseTo(5, 4);
});

it('ignores its own face and degenerate triangles', () => {
  const from = { x: 0, y: 5, depth: 1 };
  const to = { x: 10, y: 5, depth: 1 };
  expect(visibleSurfaceLine(from, to, [face], 0)).toEqual([[from, to]]);
  const degenerate = surfaceFace([from, to, to, from]);
  expect(visibleSurfaceLine(from, to, [degenerate], -1)).toEqual([[from, to]]);
});

it('indexes only overlapping faces while retaining original face indices', () => {
  const shifted = surfaceFace(
    face.points.map((point) => ({ ...point, x: point.x + 30 })) as unknown as typeof face.points,
  );
  const faces = [shifted, face];
  const candidates = surfaceIndex(faces);
  expect(candidates(-5, 5)).toEqual([1]);
  expect(candidates(10, 30)).toEqual([1, 0]);
  expect(candidates(11, 29)).toEqual([]);
  const from = { x: -5, y: 5, depth: 1 };
  const to = { x: 15, y: 5, depth: 1 };
  expect(visibleSurfaceLine(from, to, faces, -1, candidates(-5, 15))).toEqual(visibleSurfaceLine(from, to, faces, -1));
});
