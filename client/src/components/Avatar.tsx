/** Deterministic 5×5 mirrored pixel avatar generated from a nickname. */
const PALETTE = ['#e0b04b', '#7fc8a9', '#e58f65', '#b39ddb', '#90caf9', '#f48fb1', '#c5e1a5', '#ffcc80'];

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function Avatar({ name, size = 36, team }: { name: string; size?: number; team?: 0 | 1 }) {
  const h = hash(name || '?');
  const color = PALETTE[h % PALETTE.length];
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      if ((h >> (y * 3 + x)) & 1) {
        cells.push({ x, y });
        if (x < 2) cells.push({ x: 4 - x, y });
      }
    }
  }
  return (
    <svg
      className={`avatar ${team === 0 ? 'avatar--red' : team === 1 ? 'avatar--blue' : ''}`}
      width={size}
      height={size}
      viewBox="-1 -1 7 7"
      shapeRendering="crispEdges"
      aria-hidden
    >
      <rect x="-1" y="-1" width="7" height="7" fill="#24170e" />
      {cells.map((c, i) => (
        <rect key={i} x={c.x} y={c.y} width="1" height="1" fill={color} />
      ))}
    </svg>
  );
}
