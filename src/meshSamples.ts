// Procedurally generated 3D-model samples: closed triangle soups in millimetres, Z up, with
// outward-facing triangles. Parts may overlap (duck head into body, mug handle into wall);
// the mesh slicer's non-zero fill merges them.

import { ShapeUtils, Vector2 } from 'three';
import type { RGB } from './analyze';
import type { MeshData } from './meshModel';

type V3 = [number, number, number];
type V2 = [number, number];

export interface MeshSample {
  id: string;
  label: string;
  color: RGB;
  build(): Float32Array;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

class Soup {
  private v: number[] = [];

  /** Add a triangle, flipped if needed so it faces away from `inside` (towards it if `inward`). */
  tri(a: V3, b: V3, c: V3, inside: V3, inward = false): void {
    const n = cross(sub(b, a), sub(c, a));
    const centroid: V3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    const out = dot(n, sub(centroid, inside)) >= 0;
    if (out !== inward) this.v.push(...a, ...b, ...c);
    else this.v.push(...a, ...c, ...b);
  }

  /** Solid of revolution from a profile of [radius, z] with z ascending; closed with caps. */
  lathe(profile: V2[], segments = 64, opts: { inward?: boolean; capBottom?: boolean; capTop?: boolean } = {}): void {
    const { inward = false, capBottom = true, capTop = true } = opts;
    const ring = (r: number, z: number): V3[] =>
      Array.from({ length: segments }, (_, i) => {
        const a = (i / segments) * Math.PI * 2;
        return [Math.cos(a) * r, Math.sin(a) * r, z];
      });
    const rings = profile.map(([r, z]) => ring(r, z));
    for (let k = 0; k + 1 < rings.length; k++) {
      const zMid = (profile[k][1] + profile[k + 1][1]) / 2;
      const axis: V3 = [0, 0, zMid];
      for (let i = 0; i < segments; i++) {
        const j = (i + 1) % segments;
        const [a0, a1, b0, b1] = [rings[k][i], rings[k][j], rings[k + 1][i], rings[k + 1][j]];
        if (profile[k][0] > 1e-6) this.tri(a0, a1, b1, axis, inward);
        if (profile[k + 1][0] > 1e-6) this.tri(a0, b1, b0, axis, inward);
      }
    }
    const capAt = (k: number, below: boolean) => {
      if (profile[k][0] <= 1e-6) return;
      const z = profile[k][1];
      const c: V3 = [0, 0, z];
      const inside: V3 = [0, 0, below ? z + 1 : z - 1];
      for (let i = 0; i < segments; i++) this.tri(c, rings[k][i], rings[k][(i + 1) % segments], inside, inward);
    };
    if (capBottom) capAt(0, true);
    if (capTop) capAt(profile.length - 1, false);
  }

  /** Flat annulus at height z between radii (for rims). `up` = face +z. */
  annulus(r0: number, r1: number, z: number, up: boolean, segments = 64): void {
    const inside: V3 = [0, 0, up ? z - 1 : z + 1];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2, b = ((i + 1) / segments) * Math.PI * 2;
      const p = (r: number, t: number): V3 => [Math.cos(t) * r, Math.sin(t) * r, z];
      this.tri(p(r0, a), p(r0, b), p(r1, b), inside);
      this.tri(p(r0, a), p(r1, b), p(r1, a), inside);
    }
  }

  /** Extrude a simple 2D polygon (any winding, may be concave) along w. */
  prism(poly: V2[], origin: V3, U: V3, V: V3, W: V3, thickness: number): void {
    const at = (u: number, v: number, w: number): V3 => [
      origin[0] + U[0] * u + V[0] * v + W[0] * w,
      origin[1] + U[1] * u + V[1] * v + W[1] * w,
      origin[2] + U[2] * u + V[2] * v + W[2] * w,
    ];
    const pts = ShapeUtils.isClockWise(poly.map(([u, v]) => new Vector2(u, v))) ? [...poly].reverse() : poly;
    const h = thickness / 2;
    const N = cross(U, V);
    // Sides: CCW polygon in (U, V), so each edge's outward normal is edge × (U × V).
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const a0 = at(...pts[i], -h), b0 = at(...pts[j], -h), b1 = at(...pts[j], h), a1 = at(...pts[i], h);
      const edge = sub(b0, a0);
      const outward = cross(edge, N);
      const inside: V3 = [a0[0] - outward[0], a0[1] - outward[1], a0[2] - outward[2]];
      this.tri(a0, b0, b1, inside);
      this.tri(a0, b1, a1, inside);
    }
    const faces = ShapeUtils.triangulateShape(pts.map(([u, v]) => new Vector2(u, v)), []);
    const c = at(pts[0][0], pts[0][1], 0);
    for (const [i, j, k] of faces) {
      this.tri(at(...pts[i], h), at(...pts[j], h), at(...pts[k], h), c);
      this.tri(at(...pts[i], -h), at(...pts[j], -h), at(...pts[k], -h), c);
    }
  }

  /** Ellipsoid centred at c with radii r. */
  ellipsoid(c: V3, r: V3, segments = 40, rings = 24): void {
    for (let k = 0; k < rings; k++) {
      const p0 = (k / rings) * Math.PI, p1 = ((k + 1) / rings) * Math.PI;
      for (let i = 0; i < segments; i++) {
        const t0 = (i / segments) * Math.PI * 2, t1 = ((i + 1) / segments) * Math.PI * 2;
        const pt = (p: number, t: number): V3 => [
          c[0] + r[0] * Math.sin(p) * Math.cos(t),
          c[1] + r[1] * Math.sin(p) * Math.sin(t),
          c[2] - r[2] * Math.cos(p),
        ];
        if (k > 0) this.tri(pt(p0, t0), pt(p0, t1), pt(p1, t1), c);
        if (k < rings - 1) this.tri(pt(p0, t0), pt(p1, t1), pt(p1, t0), c);
      }
    }
  }

  /** Torus (or a closed arc of one) in the x-z plane, hole along y, centred at c. */
  torusXZ(c: V3, R: number, r: number, from = 0, to = Math.PI * 2, segU = 48, segV = 16): void {
    const P = (u: number, v: number): V3 => [
      c[0] + (R + r * Math.cos(v)) * Math.cos(u),
      c[1] + r * Math.sin(v),
      c[2] + (R + r * Math.cos(v)) * Math.sin(u),
    ];
    const core = (u: number): V3 => [c[0] + R * Math.cos(u), c[1], c[2] + R * Math.sin(u)];
    for (let i = 0; i < segU; i++) {
      const u0 = from + ((to - from) * i) / segU, u1 = from + ((to - from) * (i + 1)) / segU;
      const um = (u0 + u1) / 2;
      for (let j = 0; j < segV; j++) {
        const v0 = (j / segV) * Math.PI * 2, v1 = ((j + 1) / segV) * Math.PI * 2;
        this.tri(P(u0, v0), P(u1, v0), P(u1, v1), core(um));
        this.tri(P(u0, v0), P(u1, v1), P(u0, v1), core(um));
      }
    }
    // An arc must be closed at both ends, or the slicer can't tell inside from outside.
    if (Math.abs(to - from - Math.PI * 2) > 1e-9) {
      for (const [u, inward] of [[from, 0.01], [to, -0.01]] as const) {
        const inside = core(u + inward);
        for (let j = 0; j < segV; j++) {
          const v0 = (j / segV) * Math.PI * 2, v1 = ((j + 1) / segV) * Math.PI * 2;
          this.tri(core(u), P(u, v0), P(u, v1), inside);
        }
      }
    }
  }

  /** Walls between star-shaped rings around the z axis (twisted/non-round profiles). */
  rings(rings: { z: number; pts: V2[] }[], inward = false): void {
    for (let k = 0; k + 1 < rings.length; k++) {
      const A = rings[k], B = rings[k + 1];
      const axis: V3 = [0, 0, (A.z + B.z) / 2];
      const n = A.pts.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const a0: V3 = [...A.pts[i], A.z], a1: V3 = [...A.pts[j], A.z];
        const b0: V3 = [...B.pts[i], B.z], b1: V3 = [...B.pts[j], B.z];
        this.tri(a0, a1, b1, axis, inward);
        this.tri(a0, b1, b0, axis, inward);
      }
    }
  }

  /** Flat cap over a star-shaped ring; `up` = face +z. */
  ringCap(ring: { z: number; pts: V2[] }, up: boolean): void {
    const c: V3 = [0, 0, ring.z];
    const inside: V3 = [0, 0, up ? ring.z - 1 : ring.z + 1];
    const n = ring.pts.length;
    for (let i = 0; i < n; i++) this.tri(c, [...ring.pts[i], ring.z], [...ring.pts[(i + 1) % n], ring.z], inside);
  }

  /** Flat band between two star-shaped rings at the same z (e.g. a rim); `up` = face +z. */
  ringBand(outer: { z: number; pts: V2[] }, inner: { z: number; pts: V2[] }, up: boolean): void {
    const inside: V3 = [0, 0, up ? outer.z - 1 : outer.z + 1];
    const n = outer.pts.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const o0: V3 = [...outer.pts[i], outer.z], o1: V3 = [...outer.pts[j], outer.z];
      const i0: V3 = [...inner.pts[i], inner.z], i1: V3 = [...inner.pts[j], inner.z];
      this.tri(o0, o1, i1, inside);
      this.tri(o0, i1, i0, inside);
    }
  }

  done(): Float32Array {
    return new Float32Array(this.v);
  }
}

const starRing = (z: number, n: number, r: (a: number) => number, twist = 0) => ({
  z,
  pts: Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const rr = r(a);
    return [Math.cos(a + twist) * rr, Math.sin(a + twist) * rr] as V2;
  }),
});

/** Sample a smooth profile function into [radius, z] pairs. */
const profileOf = (height: number, steps: number, r: (t: number) => number): V2[] =>
  Array.from({ length: steps + 1 }, (_, k) => [Math.max(0, r(k / steps)), (k / steps) * height] as V2);

export const MESH_SAMPLES: MeshSample[] = [
  {
    id: 'vase',
    label: 'Vase',
    color: [31, 159, 176],
    build() {
      const s = new Soup();
      const H = 110, wall = 2.4, floor = 3;
      const r = (t: number) => 20 + 16 * Math.sin(t * Math.PI * 0.95) ** 1.6 - 9 * t + 5 * Math.max(0, t - 0.85) / 0.15;
      s.lathe(profileOf(H, 60, r), 96, { capTop: false });
      const inner = profileOf(H - floor, 60, (t) => r((floor + t * (H - floor)) / H) - wall).map(([rr, z]) => [rr, z + floor] as V2);
      s.lathe(inner, 96, { inward: true, capTop: false });
      s.annulus(r(1) - wall, r(1), H, true, 96);
      return s.done();
    },
  },
  {
    id: 'suv',
    label: 'Boxy SUV',
    color: [184, 50, 42],
    build() {
      const s = new Soup();
      // Side profile in (x, z), front at +x; extruded across the width (y).
      const body: V2[] = [
        [-44, 13], [44, 13], [46, 27], [31, 30], [18, 31], [6, 46], [-40, 47], [-44, 44],
      ];
      const X: V3 = [1, 0, 0], Z: V3 = [0, 0, 1], Y: V3 = [0, 1, 0];
      s.prism(body, [0, 0, 0], X, Z, Y, 34);
      // Roof rack and bumpers.
      s.prism([[-34, 47], [0, 47], [0, 50], [-34, 50]], [0, 0, 0], X, Z, Y, 26);
      s.prism([[44, 13], [49, 13], [49, 20], [44, 20]], [0, 0, 0], X, Z, Y, 34);
      s.prism([[-49, 13], [-44, 13], [-44, 20], [-49, 20]], [0, 0, 0], X, Z, Y, 34);
      // Wheels sit just outside the body sides.
      for (const x of [-26, 27]) {
        for (const side of [-1, 1]) {
          const wheel = profileOf(7, 1, () => 12);
          const cy = side * (17 + 3.5);
          // Lathe along y: build around z, then rotate (x, y, z) -> (x, z, -y) about the x axis.
          const t = new Soup();
          t.lathe(wheel, 36);
          const pts = t.done();
          for (let i = 0; i < pts.length; i += 9) {
            const tri: V3[] = [0, 1, 2].map((k) => {
              const px = pts[i + k * 3], py = pts[i + k * 3 + 1], pz = pts[i + k * 3 + 2] - 3.5;
              return [x + px, cy + pz, 12 - py] as V3;
            });
            s.tri(tri[0], tri[1], tri[2], [x, cy, 12]);
          }
        }
      }
      return s.done();
    },
  },
  {
    id: 'rocket',
    label: 'Rocket',
    color: [214, 69, 61],
    build() {
      const s = new Soup();
      const r = (t: number) => {
        if (t < 0.06) return 10 + (t / 0.06) * 3;
        if (t < 0.7) return 13;
        return 13 * Math.max(0, Math.cos(((t - 0.7) / 0.3) * (Math.PI / 2))) ** 0.7;
      };
      s.lathe(profileOf(110, 70, r), 64);
      // Three fins touching the body surface.
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + Math.PI / 2;
        const U: V3 = [Math.cos(a), Math.sin(a), 0];
        const W: V3 = [-Math.sin(a), Math.cos(a), 0];
        s.prism([[12.6, 8], [30, 0], [30, 10], [12.6, 40]], [0, 0, 0], U, [0, 0, 1], W, 3);
      }
      return s.done();
    },
  },
  {
    id: 'pawn',
    label: 'Chess pawn',
    color: [140, 29, 44],
    build() {
      const s = new Soup();
      const profile: V2[] = [
        [16, 0], [16, 3], [14.5, 4.5], [14.5, 6.5], [12, 8.5], [8.5, 13], [7, 20], [6, 28], [9.5, 30.5],
        [9.5, 32.5], [6.5, 33.5],
      ];
      // Ball head, starting at collar width.
      const R = 8.2, p0 = 0.3 * Math.PI, zc = 34 + R * Math.cos(p0);
      for (let k = 0; k <= 16; k++) {
        const p = p0 + (k / 16) * (Math.PI - p0);
        profile.push([R * Math.sin(p), zc - R * Math.cos(p)]);
      }
      s.lathe(profile, 72);
      return s.done();
    },
  },
  {
    id: 'duck',
    label: 'Rubber duck',
    color: [255, 204, 26],
    build() {
      const s = new Soup();
      s.ellipsoid([0, 0, 17], [30, 22, 18]);
      s.ellipsoid([-26, 0, 26], [9, 8, 9], 24, 14); // tail
      s.ellipsoid([16, 0, 42], [15, 14, 15]);
      s.ellipsoid([31, 0, 40], [9, 7, 3.5], 24, 12); // beak
      return s.done();
    },
  },
  {
    id: 'mug',
    label: 'Coffee mug',
    color: [58, 123, 213],
    build() {
      const s = new Soup();
      const H = 90, R = 36, wall = 4, floor = 5;
      s.lathe([[R, 0], [R, H]], 96, { capTop: false });
      s.lathe([[R - wall, floor], [R - wall, H]], 96, { inward: true, capTop: false });
      s.annulus(R - wall, R, H, true, 96);
      // Handle: a closed arc of a torus whose ends sink into the wall.
      s.torusXZ([R + 4, 0, 46], 22, 4.5, -Math.PI * 0.58, Math.PI * 0.58);
      return s.done();
    },
  },
  {
    id: 'twist',
    label: 'Twisted vase',
    color: [124, 92, 255],
    build() {
      const s = new Soup();
      const rings = [];
      const H = 110, steps = 60;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const bulge = 26 + 10 * Math.sin(t * Math.PI * 1.1) - 6 * t;
        rings.push(starRing(t * H, 150, (a) => bulge * (1 + 0.16 * Math.cos(5 * a)), t * Math.PI * 0.6));
      }
      s.rings(rings);
      s.ringCap(rings[0], false);
      s.ringCap(rings[rings.length - 1], true);
      return s.done();
    },
  },
  {
    id: 'gear',
    label: 'Spur gear',
    color: [240, 180, 40],
    build() {
      const s = new Soup();
      const teeth = 18, n = teeth * 12;
      const outerR = (a: number) => {
        const phase = ((a / (Math.PI * 2)) * teeth) % 1;
        const tooth = phase < 0.18 ? phase / 0.18 : phase < 0.5 ? 1 : phase < 0.68 ? 1 - (phase - 0.5) / 0.18 : 0;
        return 34 + 5 * tooth;
      };
      const H = 12, hub = 6;
      const o0 = starRing(0, n, outerR), o1 = starRing(H, n, outerR);
      const i0 = starRing(0, n, () => 7), i1 = starRing(H + hub, n, () => 7);
      const h0 = starRing(H, n, () => 14), h1 = starRing(H + hub, n, () => 14);
      s.rings([o0, o1]);
      s.rings([h0, h1]);
      s.rings([i0, i1], true);
      s.ringBand(o0, i0, false);
      s.ringBand(o1, h0, true);
      s.ringBand(h1, i1, true);
      return s.done();
    },
  },
  {
    id: 'cup',
    label: 'Hex pencil cup',
    color: [40, 190, 160],
    build() {
      const s = new Soup();
      const hex = (r: number) => (a: number) => r / Math.cos(((a + Math.PI / 6) % (Math.PI / 3)) - Math.PI / 6);
      const H = 95, floor = 3, n = 6 * 16;
      const outer = [], inner = [];
      for (let k = 0; k <= 10; k++) {
        const t = k / 10;
        outer.push(starRing(t * H, n, hex(36), (t * Math.PI) / 6));
        const zi = floor + t * (H - floor);
        inner.push(starRing(zi, n, hex(32.5), ((zi / H) * Math.PI) / 6));
      }
      s.rings(outer);
      s.rings(inner, true);
      s.ringCap(outer[0], false);
      s.ringCap(inner[0], true);
      s.ringBand(outer[outer.length - 1], inner[inner.length - 1], true);
      return s.done();
    },
  },
];

export function sampleMesh(sample: MeshSample): MeshData {
  return { positions: sample.build(), color: sample.color, name: sample.id, format: 'Sample', upAxis: 'z' };
}
