import type { Kind } from './board.ts';

// One SVG per kind — the "architecture diagram" look (draw.io / AWS style), shared by both engines.
const COLOR: Record<Kind, string> = {
  client: '#0284c7', cdn: '#0284c7', loadBalancer: '#7c3aed', api: '#4f46e5', service: '#4f46e5',
  cache: '#d97706', database: '#059669', storage: '#059669', queue: '#ea580c', custom: '#64748b',
};

export function KindShape({ kind, label, width, height }: { kind: Kind; label: string; width: number; height: number }) {
  const c = COLOR[kind];
  const w = width;
  const h = height;
  const text = (
    <text x={w / 2} y={h / 2 + 5} textAnchor="middle" fontSize={13} fontWeight={600} fill="#0f172a" fontFamily="system-ui">
      {label}
    </text>
  );
  let shape;
  switch (kind) {
    case 'database':
    case 'storage':
      shape = (
        <>
          <path d={`M1 10 A ${w / 2 - 1} 9 0 0 1 ${w - 1} 10 V ${h - 10} A ${w / 2 - 1} 9 0 0 1 1 ${h - 10} Z`} fill="#ecfdf5" stroke={c} strokeWidth={2} />
          <path d={`M1 10 A ${w / 2 - 1} 9 0 0 0 ${w - 1} 10`} fill="none" stroke={c} strokeWidth={2} />
        </>
      );
      break;
    case 'queue':
      shape = (
        <>
          <rect x={1} y={8} width={w - 2} height={h - 16} rx={(h - 16) / 2} fill="#fff7ed" stroke={c} strokeWidth={2} />
          {[0.3, 0.45, 0.6, 0.75].map((f) => (
            <line key={f} x1={w * f} y1={12} x2={w * f} y2={h - 12} stroke={c} strokeOpacity={0.35} />
          ))}
        </>
      );
      break;
    case 'custom':
      shape = <rect x={1} y={1} width={w - 2} height={h - 2} rx={10} fill="#f8fafc" stroke={c} strokeWidth={2} strokeDasharray="6 4" />;
      break;
    case 'client':
      shape = (
        <>
          <rect x={1} y={1} width={w - 2} height={h - 12} rx={6} fill="#f0f9ff" stroke={c} strokeWidth={2} />
          <rect x={w / 2 - 20} y={h - 10} width={40} height={8} rx={2} fill={c} />
        </>
      );
      break;
    case 'loadBalancer':
      shape = <polygon points={`${h / 2},1 ${w - h / 2},1 ${w - 1},${h / 2} ${w - h / 2},${h - 1} ${h / 2},${h - 1} 1,${h / 2}`} fill="#f5f3ff" stroke={c} strokeWidth={2} />;
      break;
    case 'cache':
      shape = <rect x={1} y={1} width={w - 2} height={h - 2} rx={8} fill="#fffbeb" stroke={c} strokeWidth={2} />;
      break;
    case 'cdn':
      shape = <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - 1} ry={h / 2 - 1} fill="#f0f9ff" stroke={c} strokeWidth={2} />;
      break;
    default:
      shape = <rect x={1} y={1} width={w - 2} height={h - 2} rx={4} fill="#eef2ff" stroke={c} strokeWidth={2} />;
  }
  return (
    <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
      {shape}
      <rect x={6} y={6} width={6} height={6} rx={1} fill={c} />
      {text}
    </svg>
  );
}
