import type { Suit } from '@shared/types';

/** 9×9 pixel maps for each suit, drawn as crisp SVG rects. */
const MAPS: Record<Suit, string[]> = {
  hearts: [
    '.XX...XX.',
    'XXXX.XXXX',
    'XXXXXXXXX',
    'XXXXXXXXX',
    '.XXXXXXX.',
    '..XXXXX..',
    '...XXX...',
    '....X....',
    '.........',
  ],
  diamonds: [
    '....X....',
    '...XXX...',
    '..XXXXX..',
    '.XXXXXXX.',
    'XXXXXXXXX',
    '.XXXXXXX.',
    '..XXXXX..',
    '...XXX...',
    '....X....',
  ],
  spades: [
    '....X....',
    '...XXX...',
    '..XXXXX..',
    '.XXXXXXX.',
    'XXXXXXXXX',
    'XXXXXXXXX',
    '.XX.X.XX.',
    '....X....',
    '...XXX...',
  ],
  clubs: [
    '...XXX...',
    '..XXXXX..',
    '..XXXXX..',
    'XXX.X.XXX',
    'XXXXXXXXX',
    'XXXXXXXXX',
    'XXX.X.XXX',
    '....X....',
    '...XXX...',
  ],
};

/** Merge horizontal runs so each suit is only a handful of rects. */
const RUNS: Record<Suit, { x: number; y: number; w: number }[]> = Object.fromEntries(
  (Object.keys(MAPS) as Suit[]).map((suit) => {
    const runs: { x: number; y: number; w: number }[] = [];
    MAPS[suit].forEach((row, y) => {
      let x = 0;
      while (x < row.length) {
        if (row[x] === 'X') {
          let w = 1;
          while (row[x + w] === 'X') w++;
          runs.push({ x, y, w });
          x += w;
        } else x++;
      }
    });
    return [suit, runs];
  }),
) as never;

export function PixelSuit({ suit, size = 18, className, title }: { suit: Suit; size?: number; className?: string; title?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 9 9"
      shapeRendering="crispEdges"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {RUNS[suit].map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill="currentColor" />
      ))}
    </svg>
  );
}
