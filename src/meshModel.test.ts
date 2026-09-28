import { describe, expect, it } from 'vitest';
import { loadMeshFile } from './meshLoad';
import { buildMeshModel, meshBounds, type MeshData } from './meshModel';
import { MESH_SAMPLES, sampleMesh } from './meshSamples';
import { DEFAULT_SLICE_OPTIONS, MoveKind, slice } from './slicer';

/** Axis-aligned box as a triangle soup, deliberately with mixed winding. */
function box(w: number, d: number, h: number): Float32Array {
  const v = (x: number, y: number, z: number) => [x * w, y * d, z * h];
  const quads = [
    [v(0, 0, 0), v(1, 0, 0), v(1, 1, 0), v(0, 1, 0)],
    [v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)],
    [v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)],
    [v(0, 1, 0), v(1, 1, 0), v(1, 1, 1), v(0, 1, 1)],
    [v(0, 0, 0), v(0, 1, 0), v(0, 1, 1), v(0, 0, 1)],
    [v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)],
  ];
  const out: number[] = [];
  for (const [a, b, c, e] of quads) out.push(...a, ...b, ...c, ...a, ...c, ...e);
  return new Float32Array(out);
}

const opts = { sizeMm: 20, maxFootprintMm: 200, maxHeightMm: 200, upAxis: 'z' as const, color: [255, 0, 0] as [number, number, number] };

describe('buildMeshModel', () => {
  it('scales a cube to the requested size and sits it on the bed', () => {
    const mesh: MeshData = { positions: box(10, 10, 10), color: null, name: 'cube', format: 'STL', upAxis: 'z' };
    const m = buildMeshModel(mesh, opts);
    expect(m.sizeX).toBeCloseTo(20);
    expect(m.sizeZ).toBeCloseTo(20);
    expect(m.field(0, 0, 10)).toBeGreaterThan(8);
    expect(m.field(15, 0, 10)).toBeLessThan(0);
    expect(m.field(0, 0, 25)).toBeLessThan(0);
  });

  it('slices a cube into square walls of the right length', () => {
    const mesh: MeshData = { positions: box(20, 20, 4), color: null, name: 'cube', format: 'STL', upAxis: 'z' };
    const m = buildMeshModel(mesh, opts);
    const r = slice(m, { ...DEFAULT_SLICE_OPTIONS, layerHeight: 1, perimeters: 1 });
    const wall = r.moves.filter((mv) => mv.kind === MoveKind.Perimeter && mv.layer === 1);
    const len = wall.reduce((s, mv) => s + Math.hypot(mv.x1 - mv.x0, mv.y1 - mv.y0), 0);
    const expected = 4 * (20 - DEFAULT_SLICE_OPTIONS.lineWidth);
    expect(Math.abs(len - expected) / expected).toBeLessThan(0.05);
  });

  it('rotates Y-up files so their height becomes Z', () => {
    const tall = box(10, 40, 10); // 40 along Y
    expect(meshBounds(tall, 'y').z).toBeCloseTo(40);
    const m = buildMeshModel({ positions: tall, color: null, name: 'obj', format: 'OBJ', upAxis: 'y' }, { ...opts, sizeMm: 40, upAxis: 'y' });
    expect(m.sizeZ).toBeCloseTo(40);
  });

  it('keeps the inside of the pencil cup hollow', () => {
    const cup = MESH_SAMPLES.find((s) => s.id === 'cup');
    if (!cup) throw new Error('cup sample missing');
    const m = buildMeshModel(sampleMesh(cup), { ...opts, sizeMm: 95 });
    expect(m.field(0, 0, 1)).toBeGreaterThan(0); // solid floor
    expect(m.field(0, 0, 50)).toBeLessThan(0); // hollow middle
    expect(m.field(34, 0, 50)).toBeGreaterThan(0); // wall
  });

  it('builds every 3D sample into a sliceable model', () => {
    for (const s of MESH_SAMPLES) {
      const m = buildMeshModel(sampleMesh(s), { ...opts, sizeMm: 80 });
      const r = slice(m, { ...DEFAULT_SLICE_OPTIONS, layerHeight: 2 });
      expect(r.extrudeCount, s.id).toBeGreaterThan(100);
    }
  });
});

describe('loadMeshFile', () => {
  it('reads an ASCII STL', async () => {
    const tri = (a: number[], b: number[], c: number[]) =>
      `facet normal 0 0 0\n outer loop\n  vertex ${a.join(' ')}\n  vertex ${b.join(' ')}\n  vertex ${c.join(' ')}\n endloop\nendfacet\n`;
    const text = `solid t\n${tri([0, 0, 0], [10, 0, 0], [0, 10, 0])}${tri([0, 0, 0], [0, 10, 0], [0, 0, 10])}endsolid t\n`;
    const mesh = await loadMeshFile(new File([text], 'part.stl'));
    expect(mesh.format).toBe('STL');
    expect(mesh.upAxis).toBe('z');
    expect(mesh.positions.length).toBe(18);
  });

  it('rejects unsupported files with a clear message', async () => {
    await expect(loadMeshFile(new File(['x'], 'part.step'))).rejects.toThrow(/STL, OBJ, 3MF or PLY/);
  });
});
