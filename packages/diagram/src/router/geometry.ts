import type { DiagramPosition } from '../types.ts';

const fmt = (p: DiagramPosition) => `${p.x} ${p.y}`;

/** An SVG path through orthogonal points, with each corner rounded (radius capped to fit). */
export const roundedPath = (points: readonly DiagramPosition[], radius = 6): string => {
  const [start, ...rest] = points;
  if (!start) return '';
  let path = `M ${fmt(start)}`;
  for (let i = 0; i < rest.length; i++) {
    const corner = rest[i];
    const prev = points[i];
    const next = rest[i + 1];
    if (!corner || !prev) continue;
    if (!next) {
      path += ` L ${fmt(corner)}`;
      continue;
    }
    const r = Math.min(
      radius,
      Math.hypot(corner.x - prev.x, corner.y - prev.y) / 2,
      Math.hypot(next.x - corner.x, next.y - corner.y) / 2,
    );
    const toward = (from: DiagramPosition, to: DiagramPosition): DiagramPosition => {
      const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
      return { x: from.x + ((to.x - from.x) / len) * r, y: from.y + ((to.y - from.y) / len) * r };
    };
    path += ` L ${fmt(toward(corner, prev))} Q ${fmt(corner)} ${fmt(toward(corner, next))}`;
  }
  return path;
};

/** Where an edge label goes: the middle of the longest segment. */
export const labelPoint = (points: readonly DiagramPosition[]): DiagramPosition => {
  let best: DiagramPosition = points[0] ?? { x: 0, y: 0 };
  let longest = -1;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > longest) {
      longest = length;
      best = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  }
  return best;
};
