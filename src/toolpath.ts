// The nozzle moves of a print, stored as parallel typed arrays (one entry per move) rather than an
// array of objects: a real G-code file can have millions of moves, and typed arrays keep that
// compact and can be handed to and from a Web Worker without copying.

import type { RGB } from './analyze';

/** What a move is for. Everything except Travel and Wipe deposits filament. */
export const MoveKind = {
  Travel: 0,
  OuterWall: 1,
  InnerWall: 2,
  SparseInfill: 3,
  SolidInfill: 4,
  TopSurface: 5,
  SkirtBrim: 6,
  Support: 7,
  Bridge: 8,
  Wipe: 9,
  Purge: 10,
} as const;
export type MoveKind = (typeof MoveKind)[keyof typeof MoveKind];

export const isExtrusion = (kind: number): boolean => kind !== MoveKind.Travel && kind !== MoveKind.Wipe;

/**
 * Something that happens between moves: `at` is the index of the move it comes before (`count`
 * for the end of the print). Temperatures are °C, fan is 0..1, dwell is seconds.
 */
export interface TimelineEvent {
  at: number;
  type: 'nozzle' | 'bed' | 'chamber' | 'fan' | 'dwell' | 'beep' | 'home' | 'probe' | 'retract';
  value: number;
}

export interface Toolpath {
  count: number;
  x0: Float32Array;
  y0: Float32Array;
  z0: Float32Array;
  x1: Float32Array;
  y1: Float32Array;
  z1: Float32Array;
  /** Line width and layer height in mm. */
  width: Float32Array;
  height: Float32Array;
  /** Speed in mm/s. */
  feed: Float32Array;
  kind: Uint8Array;
  layer: Uint32Array;
  /** 0xRRGGBB. */
  color: Uint32Array;
  layerCount: number;
  /** Sorted by `at`. */
  events: TimelineEvent[];
}

/** One move as a plain object, for building toolpaths and for tests. */
export interface Move {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  width: number;
  height: number;
  feed: number;
  kind: MoveKind;
  layer: number;
  color: number;
}

export const packRGB = (c: RGB): number =>
  (clampByte(c[0]) << 16) | (clampByte(c[1]) << 8) | clampByte(c[2]);
const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

export function unpackRGB(c: number): RGB {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}

/** Collects moves into a Toolpath, growing its arrays as needed. */
export class ToolpathBuilder {
  private n = 0;
  private cap: number;
  private p: Omit<Toolpath, 'count' | 'layerCount' | 'events'>;
  readonly events: TimelineEvent[] = [];
  layerCount = 0;

  constructor(capacity = 1024) {
    this.cap = Math.max(1, capacity);
    this.p = allocate(this.cap);
  }

  get count(): number {
    return this.n;
  }

  push(m: Move): void {
    if (this.n === this.cap) this.grow();
    const p = this.p, i = this.n++;
    p.x0[i] = m.x0;
    p.y0[i] = m.y0;
    p.z0[i] = m.z0;
    p.x1[i] = m.x1;
    p.y1[i] = m.y1;
    p.z1[i] = m.z1;
    p.width[i] = m.width;
    p.height[i] = m.height;
    p.feed[i] = m.feed;
    p.kind[i] = m.kind;
    p.layer[i] = m.layer;
    p.color[i] = m.color;
    if (m.layer + 1 > this.layerCount) this.layerCount = m.layer + 1;
  }

  /** Add an event before the next move pushed. */
  event(type: TimelineEvent['type'], value = 0): void {
    this.events.push({ at: this.n, type, value });
  }

  build(): Toolpath {
    const n = this.n, p = this.p;
    return {
      count: n,
      x0: p.x0.slice(0, n),
      y0: p.y0.slice(0, n),
      z0: p.z0.slice(0, n),
      x1: p.x1.slice(0, n),
      y1: p.y1.slice(0, n),
      z1: p.z1.slice(0, n),
      width: p.width.slice(0, n),
      height: p.height.slice(0, n),
      feed: p.feed.slice(0, n),
      kind: p.kind.slice(0, n),
      layer: p.layer.slice(0, n),
      color: p.color.slice(0, n),
      layerCount: this.layerCount,
      events: this.events.slice(),
    };
  }

  private grow(): void {
    const old = this.p;
    this.cap *= 2;
    this.p = allocate(this.cap);
    for (const key of Object.keys(old) as (keyof typeof old)[]) {
      (this.p[key] as Float32Array | Uint8Array | Uint32Array).set(old[key]);
    }
  }
}

function allocate(n: number): Omit<Toolpath, 'count' | 'layerCount' | 'events'> {
  return {
    x0: new Float32Array(n),
    y0: new Float32Array(n),
    z0: new Float32Array(n),
    x1: new Float32Array(n),
    y1: new Float32Array(n),
    z1: new Float32Array(n),
    width: new Float32Array(n),
    height: new Float32Array(n),
    feed: new Float32Array(n),
    kind: new Uint8Array(n),
    layer: new Uint32Array(n),
    color: new Uint32Array(n),
  };
}

export function moveAt(p: Toolpath, i: number): Move {
  return {
    x0: p.x0[i],
    y0: p.y0[i],
    z0: p.z0[i],
    x1: p.x1[i],
    y1: p.y1[i],
    z1: p.z1[i],
    width: p.width[i],
    height: p.height[i],
    feed: p.feed[i],
    kind: p.kind[i] as MoveKind,
    layer: p.layer[i],
    color: p.color[i],
  };
}

export function moveLength(p: Toolpath, i: number): number {
  return Math.hypot(p.x1[i] - p.x0[i], p.y1[i] - p.y0[i], p.z1[i] - p.z0[i]);
}

/** Seconds the nozzle spends on move i (zero for a zero-length move). */
export function moveSeconds(p: Toolpath, i: number): number {
  const len = moveLength(p, i);
  return len > 0 ? len / Math.max(p.feed[i], 1e-3) : 0;
}

/**
 * Where to draw move i, `frac` of the way along, as the top three rows of a row-major 4×4 matrix
 * (written into `out`). It maps a unit-length, unit-diameter cylinder lying along x onto the
 * move: stretched along it (plus a little overlap at the ends), `width` across it horizontally
 * and `height` up, hanging below the move's line because moves run along the top of their layer.
 */
export function segmentTransform(p: Toolpath, i: number, frac: number, out: Float64Array): Float64Array {
  const x0 = p.x0[i], y0 = p.y0[i], z0 = p.z0[i];
  const dx = p.x1[i] - x0, dy = p.y1[i] - y0, dz = p.z1[i] - z0;
  const len = Math.hypot(dx, dy, dz);
  const l = len * frac;
  // Unit vectors: u along the move, s across it (kept horizontal), v = u × s, "up".
  let ux = 1, uy = 0, uz = 0;
  if (len > 1e-9) {
    ux = dx / len;
    uy = dy / len;
    uz = dz / len;
  }
  let sx = -uy, sy = ux;
  const sl = Math.hypot(sx, sy);
  if (sl < 1e-6) {
    sx = 0;
    sy = 1;
  } else {
    sx /= sl;
    sy /= sl;
  }
  const vx = -uz * sy, vy = uz * sx, vz = ux * sy - uy * sx;
  const w = p.width[i], h = p.height[i];
  const along = Math.max(0.01, l + w * 0.45), up = h * 1.05;
  out[0] = ux * along; out[1] = sx * w; out[2] = vx * up; out[3] = x0 + (ux * l) / 2;
  out[4] = uy * along; out[5] = sy * w; out[6] = vy * up; out[7] = y0 + (uy * l) / 2;
  out[8] = uz * along; out[9] = 0; out[10] = vz * up; out[11] = z0 + (uz * l) / 2 - h / 2;
  return out;
}

export interface ToolpathStats {
  extrudeCount: number;
  extrudeMm: number;
  travelMm: number;
  /** Deposited plastic in mm³. */
  volumeMm3: number;
  /** Print time, including dwells. */
  seconds: number;
}

export function toolpathStats(p: Toolpath): ToolpathStats {
  const s: ToolpathStats = { extrudeCount: 0, extrudeMm: 0, travelMm: 0, volumeMm3: 0, seconds: 0 };
  for (let i = 0; i < p.count; i++) {
    const len = moveLength(p, i);
    s.seconds += moveSeconds(p, i);
    if (isExtrusion(p.kind[i])) {
      s.extrudeCount++;
      s.extrudeMm += len;
      s.volumeMm3 += len * p.width[i] * p.height[i];
    } else {
      s.travelMm += len;
    }
  }
  for (const e of p.events) if (e.type === 'dwell') s.seconds += e.value;
  return s;
}

/** before[i] = how many extrusion moves come before move i (length count + 1). */
export function extrusionsBefore(p: Toolpath): Uint32Array {
  const out = new Uint32Array(p.count + 1);
  for (let i = 0; i < p.count; i++) out[i + 1] = out[i] + (isExtrusion(p.kind[i]) ? 1 : 0);
  return out;
}

/**
 * Fit a toolpath under `maxExtrusions` drawn segments by simplifying runs of connected extrusions
 * (same kind, layer, width, height and speed) with Douglas–Peucker, doubling the tolerance until it
 * fits. Returns the path untouched (tolerance 0) when it already fits. A run is never merged across
 * an event, so events keep their place.
 */
export function fitToBudget(p: Toolpath, maxExtrusions: number): { path: Toolpath; tolerance: number } {
  let count = 0;
  for (let i = 0; i < p.count; i++) if (isExtrusion(p.kind[i])) count++;
  if (count <= maxExtrusions) return { path: p, tolerance: 0 };
  let best = p;
  let used = 0;
  for (let tol = 0.01; tol <= 2; tol *= 2) {
    best = simplifyRuns(p, tol);
    used = tol;
    let n = 0;
    for (let i = 0; i < best.count; i++) if (isExtrusion(best.kind[i])) n++;
    if (n <= maxExtrusions) break;
  }
  return { path: best, tolerance: used };
}

function simplifyRuns(p: Toolpath, tol: number): Toolpath {
  const b = new ToolpathBuilder(p.count);
  b.layerCount = p.layerCount;
  const eventAt = new Set(p.events.map((e) => e.at));
  const remap = new Int32Array(p.count + 1);
  const pts: number[] = [];
  let i = 0;
  while (i < p.count) {
    remap[i] = b.count;
    let j = i + 1;
    if (isExtrusion(p.kind[i])) {
      while (j < p.count && !eventAt.has(j) && continues(p, j - 1, j)) {
        remap[j] = b.count;
        j++;
      }
    }
    if (j - i === 1) {
      b.push(moveAt(p, i));
    } else {
      pts.length = 0;
      pts.push(p.x0[i], p.y0[i], p.z0[i]);
      for (let k = i; k < j; k++) pts.push(p.x1[k], p.y1[k], p.z1[k]);
      const keep = douglasPeucker(pts, tol);
      const m = moveAt(p, i);
      for (let k = 0; k + 1 < keep.length; k++) {
        const a = keep[k] * 3, c = keep[k + 1] * 3;
        m.x0 = pts[a];
        m.y0 = pts[a + 1];
        m.z0 = pts[a + 2];
        m.x1 = pts[c];
        m.y1 = pts[c + 1];
        m.z1 = pts[c + 2];
        // The colour of the segment's first original move.
        m.color = p.color[i + keep[k]];
        b.push(m);
      }
    }
    i = j;
  }
  remap[p.count] = b.count;
  const out = b.build();
  out.events = p.events.map((e) => ({ ...e, at: remap[e.at] }));
  return out;
}

function continues(p: Toolpath, a: number, b: number): boolean {
  return (
    p.kind[b] === p.kind[a] &&
    p.layer[b] === p.layer[a] &&
    p.width[b] === p.width[a] &&
    p.height[b] === p.height[a] &&
    p.feed[b] === p.feed[a] &&
    p.x0[b] === p.x1[a] &&
    p.y0[b] === p.y1[a] &&
    p.z0[b] === p.z1[a]
  );
}

/** Indices of the points to keep from a flat [x, y, z, ...] polyline. */
export function douglasPeucker(pts: number[], tol: number): number[] {
  const n = pts.length / 3;
  if (n <= 2) return Array.from({ length: n }, (_, k) => k);
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [0, n - 1];
  while (stack.length) {
    const hi = stack.pop() as number;
    const lo = stack.pop() as number;
    let worst = -1, worstD = tol;
    for (let k = lo + 1; k < hi; k++) {
      const d = pointSegmentDistance(pts, k, lo, hi);
      if (d > worstD) {
        worstD = d;
        worst = k;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push(lo, worst, worst, hi);
    }
  }
  const out: number[] = [];
  for (let k = 0; k < n; k++) if (keep[k]) out.push(k);
  return out;
}

function pointSegmentDistance(pts: number[], k: number, a: number, b: number): number {
  const ax = pts[a * 3], ay = pts[a * 3 + 1], az = pts[a * 3 + 2];
  const dx = pts[b * 3] - ax, dy = pts[b * 3 + 1] - ay, dz = pts[b * 3 + 2] - az;
  const px = pts[k * 3] - ax, py = pts[k * 3 + 1] - ay, pz = pts[k * 3 + 2] - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / len2)) : 0;
  return Math.hypot(px - dx * t, py - dy * t, pz - dz * t);
}
