// Procedurally generated 3D-model samples, so people can try the 3D-file path without a file.
// Each is a closed triangle soup in millimetres, Z up.

import type { RGB } from './analyze';
import type { MeshData } from './meshModel';

type Ring = { z: number; pts: [number, number][] };

export interface MeshSample {
  id: string;
  label: string;
  color: RGB;
  build(): Float32Array;
}

class Soup {
  private v: number[] = [];
  tri(a: [number, number, number], b: [number, number, number], c: [number, number, number]): void {
    this.v.push(...a, ...b, ...c);
  }
  /** Side walls between consecutive rings with equal vertex counts. */
  walls(rings: Ring[]): void {
    for (let r = 0; r + 1 < rings.length; r++) {
      const A = rings[r], B = rings[r + 1];
      const n = A.pts.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const a0: [number, number, number] = [...A.pts[i], A.z];
        const a1: [number, number, number] = [...A.pts[j], A.z];
        const b0: [number, number, number] = [...B.pts[i], B.z];
        const b1: [number, number, number] = [...B.pts[j], B.z];
        this.tri(a0, a1, b1);
        this.tri(a0, b1, b0);
      }
    }
  }
  /** Fan cap over a ring. */
  cap(ring: Ring): void {
    let cx = 0, cy = 0;
    for (const [x, y] of ring.pts) {
      cx += x;
      cy += y;
    }
    cx /= ring.pts.length;
    cy /= ring.pts.length;
    const n = ring.pts.length;
    for (let i = 0; i < n; i++) {
      this.tri([cx, cy, ring.z], [...ring.pts[i], ring.z], [...ring.pts[(i + 1) % n], ring.z]);
    }
  }
  /** Flat annulus between an outer and inner ring at the same height. */
  annulus(outer: Ring, inner: Ring): void {
    const n = outer.pts.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.tri([...outer.pts[i], outer.z], [...outer.pts[j], outer.z], [...inner.pts[j], inner.z]);
      this.tri([...outer.pts[i], outer.z], [...inner.pts[j], inner.z], [...inner.pts[i], inner.z]);
    }
  }
  done(): Float32Array {
    return new Float32Array(this.v);
  }
}

const ring = (z: number, n: number, r: (a: number) => number, twist = 0): Ring => ({
  z,
  pts: Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const rr = r(a);
    return [Math.cos(a + twist) * rr, Math.sin(a + twist) * rr] as [number, number];
  }),
});

export const MESH_SAMPLES: MeshSample[] = [
  {
    id: 'twist',
    label: 'Twisted vase',
    color: [124, 92, 255],
    build() {
      const s = new Soup();
      const rings: Ring[] = [];
      const H = 110, steps = 60;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const bulge = 26 + 10 * Math.sin(t * Math.PI * 1.1) - 6 * t;
        rings.push(ring(t * H, 150, (a) => bulge * (1 + 0.16 * Math.cos(5 * a)), t * Math.PI * 0.6));
      }
      s.walls(rings);
      s.cap(rings[0]);
      s.cap(rings[rings.length - 1]);
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
      const H = 12;
      const o0 = ring(0, n, outerR), o1 = ring(H, n, outerR);
      const i0 = ring(0, n, () => 7), i1 = ring(H, n, () => 7);
      s.walls([o0, o1]);
      s.walls([i0, i1]);
      s.annulus(o0, i0);
      s.annulus(o1, i1);
      // Hub.
      const h0 = ring(H, n, () => 14), h1 = ring(H + 6, n, () => 14), hi = ring(H + 6, n, () => 7), hin = ring(H, n, () => 7);
      s.walls([h0, h1]);
      s.walls([hin, hi]);
      s.annulus(h1, hi);
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
      const outer: Ring[] = [], inner: Ring[] = [];
      for (let k = 0; k <= 10; k++) {
        const t = k / 10;
        const tw = t * Math.PI / 6;
        outer.push(ring(t * H, n, hex(36), tw));
        inner.push(ring(floor + t * (H - floor), n, hex(32.5), floor / H * Math.PI / 6 + t * (1 - floor / H) * Math.PI / 6));
      }
      s.walls(outer);
      s.walls(inner);
      s.cap(outer[0]);
      s.cap(inner[0]);
      s.annulus(outer[outer.length - 1], inner[inner.length - 1]);
      return s.done();
    },
  },
];

export function sampleMesh(sample: MeshSample): MeshData {
  return { positions: sample.build(), color: sample.color, name: sample.id, format: 'Sample', upAxis: 'z' };
}
