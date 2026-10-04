import { describe, expect, it } from 'vitest';
import { INFILL_PATTERNS, infillPolylines } from './infill';
import type { Model } from './model';
import { DEFAULT_SLICE_OPTIONS, slice } from './slicer';
import { MoveKind, moveLength } from './toolpath';

const R = 40, H = 12;
const cylinder: Model = {
  mode: 'revolve',
  sizeX: 2 * R,
  sizeY: 2 * R,
  sizeZ: H,
  field: (x, y, z) => (z < 0 || z > H ? -1 : R - Math.hypot(x, y)),
  color: () => [255, 0, 0],
};
const o = DEFAULT_SLICE_OPTIONS;
/** Where sparse infill may go: inside the inner wall. */
const inner = R - (o.lineWidth * o.perimeters - o.lineWidth * 0.3);

describe('infill patterns', () => {
  for (const { id } of INFILL_PATTERNS) {
    for (const density of [0.15, 0.3]) {
      it(`${id} at ${density * 100}% stays inside and uses about the requested plastic`, () => {
        const p = slice(cylinder, { ...o, infillDensity: density, infillPattern: id });
        let len = 0;
        const layers = new Set<number>();
        for (let i = 0; i < p.count; i++) {
          if (p.kind[i] !== MoveKind.SparseInfill) continue;
          len += moveLength(p, i);
          layers.add(p.layer[i]);
          for (const [x, y] of [[p.x0[i], p.y0[i]], [p.x1[i], p.y1[i]]]) expect(Math.hypot(x, y)).toBeLessThan(inner + 0.3);
        }
        expect(layers.size).toBe(p.layerCount - 2 * o.solidLayers);
        const coverage = ((len / layers.size) * o.lineWidth) / (Math.PI * inner ** 2);
        expect(Math.abs(coverage - density) / density, `coverage ${coverage.toFixed(3)}`).toBeLessThan(0.25);
      });
    }
  }

  it('keeps solid layers as lines whatever the pattern', () => {
    const lines = slice(cylinder, { ...o, infillPattern: 'lines' });
    const gyroid = slice(cylinder, { ...o, infillPattern: 'gyroid' });
    const solidLen = (p: typeof lines) => {
      let len = 0;
      for (let i = 0; i < p.count; i++) if (p.kind[i] === MoveKind.SolidInfill) len += moveLength(p, i);
      return len;
    };
    expect(solidLen(gyroid)).toBeCloseTo(solidLen(lines), 6);
  });

  it('draws the gyroid as continuous curves that shift from layer to layer', () => {
    const step = 0.5;
    const a = infillPolylines('gyroid', 0.4, 4, 20, step);
    const b = infillPolylines('gyroid', 2.4, 4, 20, step);
    expect(a.length).toBeGreaterThan(0);
    for (const pts of a) {
      for (let i = 2; i < pts.length; i += 2) {
        expect(Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1])).toBeLessThan(step * 4);
      }
    }
    expect(b[0]).not.toEqual(a[0]);
  });

  it('builds honeycomb rows from hexagon edges of equal length', () => {
    const [row] = infillPolylines('honeycomb', 0, 3, 10, 0.5);
    const lens: number[] = [];
    for (let i = 2; i < row.length; i += 2) lens.push(Math.hypot(row[i] - row[i - 2], row[i + 1] - row[i - 1]));
    for (const l of lens) expect(l).toBeCloseTo(lens[0], 6);
  });
});
