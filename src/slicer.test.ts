import { describe, expect, it } from 'vitest';
import { analyzeImage } from './analyze';
import { buildModel, DEFAULT_MODEL_OPTIONS, type Model } from './model';
import { DEFAULT_SLICE_OPTIONS, loopLength, MoveKind, simplifyLoop, slice } from './slicer';

const cylinder = (r: number, h: number): Model => ({
  mode: 'revolve',
  sizeX: 2 * r,
  sizeY: 2 * r,
  sizeZ: h,
  field: (x, y, z) => (z < 0 || z > h ? -1 : r - Math.hypot(x, y)),
  color: () => [255, 0, 0],
});

describe('slice', () => {
  it('cuts a cylinder into the expected number of layers', () => {
    const r = slice(cylinder(20, 10), { ...DEFAULT_SLICE_OPTIONS, layerHeight: 1 });
    expect(r.layerCount).toBe(10);
    const layers = new Set(r.moves.map((m) => m.layer));
    expect(layers.size).toBe(10);
  });

  it('traces the outer wall at half a line width inside the surface', () => {
    const o = { ...DEFAULT_SLICE_OPTIONS, layerHeight: 1, perimeters: 1 };
    const r = slice(cylinder(20, 1), o);
    const wall = r.moves.filter((m) => m.kind === MoveKind.Perimeter);
    const len = wall.reduce((s, m) => s + Math.hypot(m.x1 - m.x0, m.y1 - m.y0), 0);
    const expected = 2 * Math.PI * (20 - o.lineWidth / 2);
    expect(Math.abs(len - expected) / expected).toBeLessThan(0.02);
    for (const m of wall) expect(Math.hypot(m.x1, m.y1)).toBeCloseTo(20 - o.lineWidth / 2, 0);
  });

  it('keeps infill inside the part', () => {
    const r = slice(cylinder(15, 3), DEFAULT_SLICE_OPTIONS);
    const infill = r.moves.filter((m) => m.kind === MoveKind.Infill);
    expect(infill.length).toBeGreaterThan(0);
    for (const m of infill) {
      expect(Math.hypot(m.x0, m.y0)).toBeLessThan(15);
      expect(Math.hypot(m.x1, m.y1)).toBeLessThan(15);
    }
  });

  it('chains moves so each starts where the last ended', () => {
    const r = slice(cylinder(10, 2), DEFAULT_SLICE_OPTIONS);
    for (let i = 1; i < r.moves.length; i++) {
      expect(r.moves[i].x0).toBeCloseTo(r.moves[i - 1].x1, 6);
      expect(r.moves[i].y0).toBeCloseTo(r.moves[i - 1].y1, 6);
    }
  });

  it('slices a revolved photo into a round part of the requested height', () => {
    const w = 60, h = 90;
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let y = 10; y < 80; y++) for (let x = 15; x < 45; x++) data.set([40, 90, 200, 255], (y * w + x) * 4);
    const model = buildModel(analyzeImage({ width: w, height: h, data }), { ...DEFAULT_MODEL_OPTIONS, mode: 'revolve', sizeMm: 70 });
    expect(model.sizeZ).toBeCloseTo(70, 0);
    expect(model.sizeX).toBeCloseTo(30, 0);
    const r = slice(model, DEFAULT_SLICE_OPTIONS);
    expect(r.layerCount).toBe(Math.ceil(70 / DEFAULT_SLICE_OPTIONS.layerHeight));
    expect(r.extrudeCount).toBeGreaterThan(1000);
  });
});

describe('simplifyLoop', () => {
  it('collapses collinear points on a square', () => {
    const pts: number[] = [];
    for (let i = 0; i < 10; i++) pts.push(i, 0);
    for (let i = 0; i < 10; i++) pts.push(10, i);
    for (let i = 10; i > 0; i--) pts.push(i, 10);
    for (let i = 10; i > 0; i--) pts.push(0, i);
    const s = simplifyLoop(pts, 0.01);
    expect(s.length / 2).toBe(4);
    expect(loopLength(s)).toBeCloseTo(40, 6);
  });
});
