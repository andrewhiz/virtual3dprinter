// A small slicer: cuts a field model into layers, traces perimeters with marching squares,
// fills the inside with solid diagonal lines or a sparse infill pattern, and orders it all into
// nozzle moves.

import type { RGB } from './analyze';
import { infillPolylines, type InfillPattern } from './infill';
import type { Model } from './model';
import { douglasPeucker, MoveKind, packRGB, ToolpathBuilder, type Toolpath } from './toolpath';

export interface SliceOptions {
  layerHeight: number;
  lineWidth: number;
  /** 0..1, sparse infill density. */
  infillDensity: number;
  infillPattern: InfillPattern;
  perimeters: number;
  /** Solid layers at the bottom and top. */
  solidLayers: number;
  colorMode: 'photo' | 'filament';
  filamentColor: RGB;
  /** Nozzle speeds in mm/s for sparse infill and for travel; other lines scale from printSpeed. */
  printSpeed: number;
  travelSpeed: number;
}

export const DEFAULT_SLICE_OPTIONS: SliceOptions = {
  layerHeight: 0.8,
  lineWidth: 1.2,
  infillDensity: 0.25,
  infillPattern: 'lines',
  perimeters: 2,
  solidLayers: 2,
  colorMode: 'photo',
  filamentColor: [255, 140, 60],
  printSpeed: 80,
  travelSpeed: 180,
};

/** Speed of each kind of line relative to sparse infill: slicers slow down for what shows. */
const SPEED_FACTOR: Partial<Record<MoveKind, number>> = {
  [MoveKind.OuterWall]: 0.6,
  [MoveKind.InnerWall]: 0.8,
  [MoveKind.SolidInfill]: 0.9,
  [MoveKind.TopSurface]: 0.7,
};

interface Grid {
  gx: number;
  gy: number;
  ox: number;
  oy: number;
  c: number;
  v: Float32Array;
}

/** Moves sit at the top of their layer: z is the nozzle height while printing it. */
export function slice(model: Model, o: SliceOptions): Toolpath {
  const lw = o.lineWidth;
  const lh = o.layerHeight;
  const c = Math.max(Math.max(model.sizeX, model.sizeY) / 120, 0.25, lw * 0.35);
  const gx = Math.ceil((model.sizeX + 4 * c) / c) + 1;
  const gy = Math.ceil((model.sizeY + 4 * c) / c) + 1;
  const grid: Grid = {
    gx,
    gy,
    ox: -((gx - 1) * c) / 2,
    oy: -((gy - 1) * c) / 2,
    c,
    v: new Float32Array(gx * gy),
  };

  const layerCount = Math.max(1, Math.ceil(model.sizeZ / lh - 1e-6));
  const out = new ToolpathBuilder(4096);
  out.layerCount = layerCount;
  const filament = packRGB(o.filamentColor);
  let nx = 0, ny = 0;

  for (let k = 0; k < layerCount; k++) {
    const zs = Math.min((k + 0.5) * lh, model.sizeZ - 1e-3);
    const z = (k + 1) * lh;
    let max = -Infinity;
    for (let j = 0; j < gy; j++) {
      for (let i = 0; i < gx; i++) {
        const border = i === 0 || j === 0 || i === gx - 1 || j === gy - 1;
        const val = border ? -1e3 : model.field(grid.ox + i * c, grid.oy + j * c, zs);
        grid.v[j * gx + i] = val;
        if (val > max) max = val;
      }
    }
    if (max <= lw * 0.5) continue;

    const emit = (x1: number, y1: number, kind: MoveKind) => {
      const len = Math.hypot(x1 - nx, y1 - ny);
      if (len < 1e-4) return;
      const travel = kind === MoveKind.Travel;
      const color = !travel && o.colorMode === 'photo' ? packRGB(model.color((nx + x1) / 2, (ny + y1) / 2, zs)) : filament;
      out.push({
        x0: nx, y0: ny, z0: z, x1, y1, z1: z,
        width: lw, height: lh, feed: travel ? o.travelSpeed : o.printSpeed * (SPEED_FACTOR[kind] ?? 1),
        kind, layer: k, color,
      });
      nx = x1;
      ny = y1;
    };

    // Perimeters, outermost first.
    for (let p = 0; p < o.perimeters; p++) {
      const loops = contours(grid, lw * (p + 0.5))
        .map((l) => simplifyLoop(l, c * 0.15))
        .filter((l) => loopLength(l) > lw * 3);
      const remaining = loops.slice();
      while (remaining.length) {
        let bestLoop = 0, bestPt = 0, bestD = Infinity;
        remaining.forEach((l, li) => {
          for (let q = 0; q < l.length; q += 2) {
            const d = (l[q] - nx) ** 2 + (l[q + 1] - ny) ** 2;
            if (d < bestD) {
              bestD = d;
              bestLoop = li;
              bestPt = q / 2;
            }
          }
        });
        const loop = remaining.splice(bestLoop, 1)[0];
        const n = loop.length / 2;
        emit(loop[bestPt * 2], loop[bestPt * 2 + 1], MoveKind.Travel);
        for (let s = 1; s <= n; s++) {
          const q = ((bestPt + s) % n) * 2;
          emit(loop[q], loop[q + 1], p === 0 ? MoveKind.OuterWall : MoveKind.InnerWall);
        }
      }
    }

    // Infill. Solid layers (and the "lines" pattern) are diagonal lines, direction alternating
    // each layer, in boustrophedon order; other patterns are clipped polylines.
    const top = k >= layerCount - o.solidLayers;
    const solid = top || k < o.solidLayers;
    const fill = top ? MoveKind.TopSurface : solid ? MoveKind.SolidInfill : MoveKind.SparseInfill;
    const spacing = solid ? lw : lw / Math.max(0.05, Math.min(1, o.infillDensity));
    const iso = lw * o.perimeters - lw * 0.3;
    if (!solid && o.infillPattern !== 'lines') {
      const R = Math.hypot(model.sizeX, model.sizeY) / 2 + c;
      const polys =
        o.infillPattern === 'concentric'
          ? concentric(grid, iso, spacing, lw)
          : infillPolylines(o.infillPattern, zs, spacing, R, c * 0.5);
      const runs: number[][] = [];
      for (const poly of polys) {
        for (const run of clipPolyline(grid, iso, poly, c * 0.5)) {
          if (polylineLength(run) > lw * 0.75) runs.push(simplifyPolyline(run, c * 0.15));
        }
      }
      // Nearest run next, from whichever end is closer.
      while (runs.length) {
        let best = 0, bestD = Infinity, rev = false;
        runs.forEach((r, i) => {
          const ds = (r[0] - nx) ** 2 + (r[1] - ny) ** 2;
          const de = (r[r.length - 2] - nx) ** 2 + (r[r.length - 1] - ny) ** 2;
          if (ds < bestD) [bestD, best, rev] = [ds, i, false];
          if (de < bestD) [bestD, best, rev] = [de, i, true];
        });
        const run = runs.splice(best, 1)[0];
        const pts = rev ? reversePoints(run) : run;
        emit(pts[0], pts[1], MoveKind.Travel);
        for (let q = 2; q < pts.length; q += 2) emit(pts[q], pts[q + 1], fill);
      }
      continue;
    }
    const ang = k % 2 ? -Math.PI / 4 : Math.PI / 4;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const R = Math.hypot(model.sizeX, model.sizeY) / 2 + c;
    const step = c * 0.5;
    let flip = false;
    for (let off = -R + ((k * spacing * 0.37) % spacing); off <= R; off += spacing) {
      const bx = -dy * off, by = dx * off;
      const segs: number[] = [];
      let inside = false, start = 0;
      let prev = sampleGrid(grid, bx - dx * R, by - dy * R) - iso;
      for (let t = -R + step; t <= R; t += step) {
        const cur = sampleGrid(grid, bx + dx * t, by + dy * t) - iso;
        if ((prev > 0) !== (cur > 0)) {
          const tc = t - step + (step * prev) / (prev - cur);
          if (!inside) start = tc;
          else if (tc - start > lw * 0.5) segs.push(start, tc);
          inside = !inside;
        }
        prev = cur;
      }
      if (!segs.length) continue;
      const order: number[] = [];
      for (let s = 0; s < segs.length; s += 2) order.push(segs[s], segs[s + 1]);
      if (flip) order.reverse();
      for (let s = 0; s < order.length; s += 2) {
        emit(bx + dx * order[s], by + dy * order[s], MoveKind.Travel);
        emit(bx + dx * order[s + 1], by + dy * order[s + 1], fill);
      }
      flip = !flip;
    }
  }

  return out.build();
}

/** Rings of infill following the inner wall inwards, `spacing` apart, as closed polylines. */
function concentric(g: Grid, iso: number, spacing: number, lw: number): number[][] {
  const out: number[][] = [];
  for (let level = iso + spacing / 2; out.length < 400; level += spacing) {
    const loops = contours(g, level).filter((l) => loopLength(l) > lw * 3);
    if (!loops.length) break;
    for (const l of loops) out.push([...l, l[0], l[1]]);
  }
  return out;
}

/**
 * The parts of a polyline inside the layer (field above `iso`), walking it in steps of at most
 * `step` and cutting where it crosses the edge.
 */
function clipPolyline(g: Grid, iso: number, pts: number[], step: number): number[][] {
  const runs: number[][] = [];
  let px = pts[0], py = pts[1];
  let pv = sampleGrid(g, px, py) - iso;
  let cur: number[] | null = pv > 0 ? [px, py] : null;
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2], ay = pts[i - 1], bx = pts[i], by = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let j = 1; j <= n; j++) {
      const qx = ax + ((bx - ax) * j) / n, qy = ay + ((by - ay) * j) / n;
      const qv = sampleGrid(g, qx, qy) - iso;
      if ((pv > 0) !== (qv > 0)) {
        const t = pv / (pv - qv);
        const cx = px + (qx - px) * t, cy = py + (qy - py) * t;
        if (cur) {
          cur.push(cx, cy);
          runs.push(cur);
          cur = null;
        } else {
          cur = [cx, cy];
        }
      }
      if (cur && j === n) cur.push(qx, qy);
      px = qx;
      py = qy;
      pv = qv;
    }
  }
  if (cur && cur.length >= 4) runs.push(cur);
  return runs;
}

function polylineLength(pts: number[]): number {
  let len = 0;
  for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  return len;
}

function simplifyPolyline(pts: number[], eps: number): number[] {
  const xyz: number[] = [];
  for (let i = 0; i < pts.length; i += 2) xyz.push(pts[i], pts[i + 1], 0);
  return douglasPeucker(xyz, eps).flatMap((k) => [pts[k * 2], pts[k * 2 + 1]]);
}

function reversePoints(pts: number[]): number[] {
  const out: number[] = [];
  for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i], pts[i + 1]);
  return out;
}

function sampleGrid(g: Grid, x: number, y: number): number {
  const fx = (x - g.ox) / g.c, fy = (y - g.oy) / g.c;
  if (fx < 0 || fy < 0 || fx >= g.gx - 1 || fy >= g.gy - 1) return -1e3;
  const i = Math.floor(fx), j = Math.floor(fy);
  const tx = fx - i, ty = fy - j;
  const k = j * g.gx + i;
  const a = g.v[k] * (1 - tx) + g.v[k + 1] * tx;
  const b = g.v[k + g.gx] * (1 - tx) + g.v[k + g.gx + 1] * tx;
  return a * (1 - ty) + b * ty;
}

/** Marching squares at `iso`, chained into closed loops of flat [x, y, x, y, ...] points. */
export function contours(g: Grid, iso: number): number[][] {
  const { gx, gy, v } = g;
  const segA: number[] = [];
  const segB: number[] = [];
  const add = (e0: number, e1: number) => {
    segA.push(e0);
    segB.push(e1);
  };

  for (let j = 0; j < gy - 1; j++) {
    for (let i = 0; i < gx - 1; i++) {
      const n = j * gx + i;
      const a = v[n], b = v[n + 1], cc = v[n + gx + 1], d = v[n + gx];
      const code = (a > iso ? 1 : 0) | (b > iso ? 2 : 0) | (cc > iso ? 4 : 0) | (d > iso ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const B = n * 2, T = (n + gx) * 2, L = n * 2 + 1, Rt = (n + 1) * 2 + 1;
      const centerIn = (a + b + cc + d) / 4 > iso;
      switch (code) {
        case 1: case 14: add(L, B); break;
        case 2: case 13: add(B, Rt); break;
        case 3: case 12: add(L, Rt); break;
        case 4: case 11: add(Rt, T); break;
        case 6: case 9: add(B, T); break;
        case 7: case 8: add(L, T); break;
        case 5:
          if (centerIn) { add(B, Rt); add(L, T); } else { add(L, B); add(Rt, T); }
          break;
        case 10:
          if (centerIn) { add(L, B); add(Rt, T); } else { add(B, Rt); add(L, T); }
          break;
      }
    }
  }

  const byEdge = new Map<number, number[]>();
  const link = (e: number, s: number) => {
    const list = byEdge.get(e);
    if (list) list.push(s);
    else byEdge.set(e, [s]);
  };
  for (let s = 0; s < segA.length; s++) {
    link(segA[s], s);
    link(segB[s], s);
  }

  const point = (e: number, out: number[]) => {
    const node = e >> 1;
    const horizontal = (e & 1) === 0;
    const other = horizontal ? node + 1 : node + gx;
    const v0 = v[node], v1 = v[other];
    const t = v1 === v0 ? 0.5 : (iso - v0) / (v1 - v0);
    const i = node % gx, j = Math.floor(node / gx);
    out.push(g.ox + (i + (horizontal ? t : 0)) * g.c, g.oy + (j + (horizontal ? 0 : t)) * g.c);
  };

  const used = new Uint8Array(segA.length);
  const loops: number[][] = [];
  for (let s0 = 0; s0 < segA.length; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const first = segA[s0];
    const pts: number[] = [];
    point(first, pts);
    let edge = segB[s0];
    while (edge !== first) {
      point(edge, pts);
      const next = (byEdge.get(edge) ?? []).find((s) => !used[s]);
      if (next === undefined) break;
      used[next] = 1;
      edge = segA[next] === edge ? segB[next] : segA[next];
    }
    if (pts.length >= 6) loops.push(pts);
  }
  return loops;
}

/** Drop points that sit within `eps` of the straight line between their neighbours. */
export function simplifyLoop(pts: number[], eps: number): number[] {
  const n = pts.length / 2;
  if (n < 4) return pts;
  const out: number[] = [pts[0], pts[1]];
  let i = 0;
  while (i < n) {
    let best = i + 1;
    for (let j = i + 2; j <= n && j - i <= 48; j++) {
      const jj = (j % n) * 2;
      const ax = pts[i * 2], ay = pts[i * 2 + 1], bx = pts[jj], by = pts[jj + 1];
      const len = Math.hypot(bx - ax, by - ay) || 1e-9;
      let ok = true;
      for (let k = i + 1; k < j; k++) {
        const px = pts[k * 2], py = pts[k * 2 + 1];
        if (Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len > eps) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
      best = j;
    }
    if (best >= n) break;
    out.push(pts[best * 2], pts[best * 2 + 1]);
    i = best;
  }
  return out;
}

export function loopLength(pts: number[]): number {
  let len = 0;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = ((i + 1) % n) * 2;
    len += Math.hypot(pts[j] - pts[i * 2], pts[j + 1] - pts[i * 2 + 1]);
  }
  return len;
}
