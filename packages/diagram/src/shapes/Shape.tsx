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

/** The outline of a node: an SVG drawn at the node's size. Decorative — the node carries the name. */
export function Shape({ shape, width: w, height: h, color }: ShapeProps) {
  const line = { stroke: color, strokeWidth: STROKE };
  // A light tint of the outline colour (color-mix: every current browser; works with CSS variables).
  const fill = `color-mix(in srgb, ${color} 8%, white)`;
  const inset = STROKE / 2;

  const outlines: Record<DiagramShape, () => ReactElement> = {
    rectangle: () => (
      <rect
        x={inset}
        y={inset}
        width={w - STROKE}
        height={h - STROKE}
        rx={3}
        fill={fill}
        {...line}
      />
    ),
    rounded: () => (
      <rect
        x={inset}
        y={inset}
        width={w - STROKE}
        height={h - STROKE}
        rx={10}
        fill={fill}
        {...line}
      />
    ),
    dashed: () => (
      <rect
        x={inset}
        y={inset}
        width={w - STROKE}
        height={h - STROKE}
        rx={10}
        fill={fill}
        strokeDasharray="6 4"
        {...line}
      />
    ),
    cylinder: () => {
      const rim = Math.min(9, h / 6);
      const rx = w / 2 - inset;
      return (
        <>
          <path
            d={`M${inset} ${rim} A${rx} ${rim} 0 0 1 ${w - inset} ${rim} V${h - rim} A${rx} ${rim} 0 0 1 ${inset} ${h - rim} Z`}
            fill={fill}
            {...line}
          />
          <path
            d={`M${inset} ${rim} A${rx} ${rim} 0 0 0 ${w - inset} ${rim}`}
            fill="none"
            {...line}
          />
        </>
      );
    },
    queue: () => {
      const bar = h - 16;
      return (
        <>
          <rect
            x={inset}
            y={8}
            width={w - STROKE}
            height={bar}
            rx={bar / 2}
            fill={fill}
            {...line}
          />
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
    },
    hexagon: () => {
      const cut = h / 2;
      return (
        <polygon
          points={`${cut},${inset} ${w - cut},${inset} ${w - inset},${h / 2} ${w - cut},${h - inset} ${cut},${h - inset} ${inset},${h / 2}`}
          fill={fill}
          {...line}
        />
      );
    },
    ellipse: () => (
      <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - inset} ry={h / 2 - inset} fill={fill} {...line} />
    ),
    device: () => (
      <>
        <rect x={inset} y={inset} width={w - STROKE} height={h - 12} rx={6} fill={fill} {...line} />
        <rect x={w / 2 - 20} y={h - 9} width={40} height={7} rx={2} fill={color} />
      </>
    ),
  };

  return (
    <svg width={w} height={h} aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}>
      {outlines[shape]()}
    </svg>
  );
}
