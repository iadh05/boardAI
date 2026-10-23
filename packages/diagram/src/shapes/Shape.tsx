import type { ReactElement } from 'react';
import type { DiagramShape } from '../types.ts';

export type ShapeProps = {
  shape: DiagramShape;
  width: number;
  height: number;
  /** Outline colour; the fill is a light tint of it. */
  color: string;
};

const STROKE = 2;
const INSET = STROKE / 2;

/** What every outline is drawn with: the node's size, its colour, the fill and the stroke. */
type Pen = {
  w: number;
  h: number;
  color: string;
  fill: string;
  line: { stroke: string; strokeWidth: number };
};

/** A rectangle inside the stroke, with rounded corners. */
const box = ({ w, h, fill, line }: Pen, rx: number, dashed = false) => (
  <rect
    x={INSET}
    y={INSET}
    width={w - STROKE}
    height={h - STROKE}
    rx={rx}
    fill={fill}
    {...(dashed ? { strokeDasharray: '6 4' } : {})}
    {...line}
  />
);

const cylinder = ({ w, h, fill, line }: Pen) => {
  const rim = Math.min(9, h / 6);
  const rx = w / 2 - INSET;
  return (
    <>
      <path
        d={`M${INSET} ${rim} A${rx} ${rim} 0 0 1 ${w - INSET} ${rim} V${h - rim} A${rx} ${rim} 0 0 1 ${INSET} ${h - rim} Z`}
        fill={fill}
        {...line}
      />
      <path d={`M${INSET} ${rim} A${rx} ${rim} 0 0 0 ${w - INSET} ${rim}`} fill="none" {...line} />
    </>
  );
};

const queue = ({ w, h, color, fill, line }: Pen) => {
  const bar = h - 16;
  return (
    <>
      <rect x={INSET} y={8} width={w - STROKE} height={bar} rx={bar / 2} fill={fill} {...line} />
      {[0.3, 0.45, 0.6, 0.75].map((f) => (
        <line
          key={f}
          x1={w * f}
          y1={12}
          x2={w * f}
          y2={h - 12}
          stroke={color}
          strokeOpacity={0.35}
        />
      ))}
    </>
  );
};

const hexagon = ({ w, h, fill, line }: Pen) => {
  const cut = h / 2;
  return (
    <polygon
      points={`${cut},${INSET} ${w - cut},${INSET} ${w - INSET},${h / 2} ${w - cut},${h - INSET} ${cut},${h - INSET} ${INSET},${h / 2}`}
      fill={fill}
      {...line}
    />
  );
};

const ellipse = ({ w, h, fill, line }: Pen) => (
  <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - INSET} ry={h / 2 - INSET} fill={fill} {...line} />
);

const device = ({ w, h, color, fill, line }: Pen) => (
  <>
    <rect x={INSET} y={INSET} width={w - STROKE} height={h - 12} rx={6} fill={fill} {...line} />
    <rect x={w / 2 - 20} y={h - 9} width={40} height={7} rx={2} fill={color} />
  </>
);

const OUTLINES: Record<DiagramShape, (pen: Pen) => ReactElement> = {
  rectangle: (pen) => box(pen, 3),
  rounded: (pen) => box(pen, 10),
  dashed: (pen) => box(pen, 10, true),
  cylinder,
  queue,
  hexagon,
  ellipse,
  device,
};

/** The outline of a node: an SVG drawn at the node's size. Decorative — the node carries the name. */
export function Shape({ shape, width: w, height: h, color }: ShapeProps) {
  // A light tint of the outline colour (color-mix: every current browser; works with CSS variables).
  const fill = `color-mix(in srgb, ${color} 8%, white)`;
  const pen: Pen = { w, h, color, fill, line: { stroke: color, strokeWidth: STROKE } };
  return (
    <svg width={w} height={h} aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}>
      {OUTLINES[shape](pen)}
    </svg>
  );
}
