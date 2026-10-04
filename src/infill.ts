// Sparse infill patterns as unclipped polylines covering a square around the bed origin. The
// slicer clips them to the inside of each layer. Every pattern takes the same `spacing` (the gap
// lines infill would leave at this density) and scales itself so the plastic used per layer is
// about the same, which keeps the density slider meaning the same thing for every pattern.

export type InfillPattern = 'lines' | 'grid' | 'triangles' | 'gyroid' | 'honeycomb' | 'concentric';

export const INFILL_PATTERNS: { id: InfillPattern; label: string }[] = [
  { id: 'lines', label: 'Lines' },
  { id: 'grid', label: 'Grid' },
  { id: 'triangles', label: 'Triangles' },
  { id: 'gyroid', label: 'Gyroid' },
  { id: 'honeycomb', label: 'Honeycomb' },
  { id: 'concentric', label: 'Concentric' },
];

/**
 * Polylines (flat [x, y, x, y, ...]) for one layer, covering [-R, R]² at least. `z` is the layer's
 * height in mm (the gyroid changes with it); `step` is the sampling step for curves.
 * Lines and concentric infill are drawn by the slicer itself and return nothing here.
 */
export function infillPolylines(pattern: InfillPattern, z: number, spacing: number, R: number, step: number): number[][] {
  switch (pattern) {
    case 'grid':
      return [...parallel(Math.PI / 4, spacing * 2, R), ...parallel(-Math.PI / 4, spacing * 2, R)];
    case 'triangles':
      return [0, Math.PI / 3, (2 * Math.PI) / 3].flatMap((a) => parallel(a, spacing * 3, R));
    case 'gyroid':
      return gyroid(z, spacing, R, step);
    case 'honeycomb':
      return honeycomb(spacing, R);
    default:
      return [];
  }
}

/** Parallel lines at angle `a`, `gap` apart, through the origin's lattice (so layers stack). */
function parallel(a: number, gap: number, R: number): number[][] {
  const dx = Math.cos(a), dy = Math.sin(a);
  const L = R * Math.SQRT2;
  const out: number[][] = [];
  for (let off = -Math.ceil(L / gap) * gap; off <= L; off += gap) {
    const bx = -dy * off, by = dx * off;
    out.push([bx - dx * L, by - dy * L, bx + dx * L, by + dy * L]);
  }
  return out;
}

/**
 * Cross-section of the gyroid sin(wx)cos(wy) + sin(wy)cos(wz) + sin(wz)cos(wx) = 0 at height z.
 * Where |cos wz| >= |sin wz| it is solved for y along x (always solvable there), otherwise for x
 * along y, as Cura does; each gives two families of wavy curves.
 */
function gyroid(z: number, spacing: number, R: number, step: number): number[][] {
  // Neighbouring curves sit pi / w apart; the curves are wavy, so pack them a little looser.
  const w = Math.PI / (spacing * 1.15);
  const sz = Math.sin(w * z), cz = Math.cos(w * z);
  const alongX = Math.abs(cz) >= Math.abs(sz);
  const out: number[][] = [];
  const n0 = Math.floor((-R * w) / (2 * Math.PI)) - 1, n1 = Math.ceil((R * w) / (2 * Math.PI)) + 1;
  for (const sign of [1, -1]) {
    for (let n = n0; n <= n1; n++) {
      const pts: number[] = [];
      for (let u = -R; u <= R + step / 2; u += step) {
        // Along x: A cos(wy) + B sin(wy) = C with A = sin(wx), B = cos(wz), C = -sin(wz)cos(wx).
        // Along y: A cos(wx) + B sin(wx) = C with A = cos(wy), B = sin(wz), C = -sin(wy)cos(wz).
        const A = alongX ? Math.sin(w * u) : Math.cos(w * u);
        const B = alongX ? cz : sz;
        const C = alongX ? -sz * Math.cos(w * u) : -Math.sin(w * u) * cz;
        const N = Math.hypot(A, B);
        const v = (Math.atan2(B, A) + sign * Math.acos(Math.max(-1, Math.min(1, C / N))) + 2 * Math.PI * n) / w;
        if (alongX) pts.push(u, v);
        else pts.push(v, u);
      }
      out.push(pts);
    }
  }
  return out;
}

/**
 * Flat-topped hexagons from zigzag rows: each row traces half a band of cells, and the row above
 * it is its mirror image, so together they close the hexagons.
 */
function honeycomb(spacing: number, R: number): number[][] {
  // A full row is 4a of line per 3a across, two rows every 2h: that matches `spacing` when
  // a = 8 spacing / (3√3).
  const a = (8 * spacing) / (3 * Math.sqrt(3));
  const h = (Math.sqrt(3) / 2) * a;
  const out: number[][] = [];
  const x0 = Math.floor(-R / (3 * a)) * 3 * a;
  for (let m = Math.floor(-R / (2 * h)) - 1; m <= Math.ceil(R / (2 * h)) + 1; m++) {
    const yb = m * 2 * h;
    for (const dir of [1, -1]) {
      const pts: number[] = [];
      for (let x = x0; x <= R + 3 * a; x += 3 * a) {
        pts.push(x, yb, x + a / 2, yb + dir * h, x + 1.5 * a, yb + dir * h, x + 2 * a, yb);
      }
      out.push(pts);
    }
  }
  return out;
}
