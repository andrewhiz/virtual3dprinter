import { describe, expect, it } from 'vitest';
import {
  douglasPeucker,
  extrusionFeedRange,
  extrusionsBefore,
  fitToBudget,
  isExtrusion,
  layerStarts,
  moveAt,
  MoveKind,
  packRGB,
  segmentTransform,
  statsByKind,
  ToolpathBuilder,
  toolpathStats,
  unpackRGB,
  type Move,
  type Toolpath,
} from './toolpath';

const move = (over: Partial<Move>): Move => ({
  x0: 0, y0: 0, z0: 0.2, x1: 10, y1: 0, z1: 0.2,
  width: 0.4, height: 0.2, feed: 50,
  kind: MoveKind.OuterWall, layer: 0, color: 0xff8800,
  ...over,
});

/** A circle of radius r traced as n tiny extrusions, plus a travel to it. */
function circle(n: number, r = 20): Toolpath {
  const b = new ToolpathBuilder(16);
  b.push(move({ x0: 0, y0: 0, x1: r, y1: 0, kind: MoveKind.Travel, feed: 150 }));
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
    b.push(move({ x0: Math.cos(a0) * r, y0: Math.sin(a0) * r, x1: Math.cos(a1) * r, y1: Math.sin(a1) * r }));
  }
  return b.build();
}

/** Apply a segmentTransform matrix to a point. */
const apply = (e: Float64Array, x: number, y: number, z: number) => [
  e[0] * x + e[1] * y + e[2] * z + e[3],
  e[4] * x + e[5] * y + e[6] * z + e[7],
  e[8] * x + e[9] * y + e[10] * z + e[11],
];

describe('ToolpathBuilder', () => {
  it('grows past its capacity and keeps every move', () => {
    const b = new ToolpathBuilder(2);
    for (let i = 0; i < 100; i++) b.push(move({ x1: i, layer: Math.floor(i / 10) }));
    const p = b.build();
    expect(p.count).toBe(100);
    expect(p.x1.length).toBe(100);
    const m = moveAt(p, 57);
    expect(m.x1).toBe(57);
    expect(m.z0).toBeCloseTo(0.2);
    expect(m.layer).toBe(5);
    expect(m.color).toBe(0xff8800);
    expect(p.layerCount).toBe(10);
  });

  it('places events before the next move', () => {
    const b = new ToolpathBuilder();
    b.event('nozzle', 210);
    b.push(move({}));
    b.event('dwell', 2);
    b.push(move({}));
    b.event('beep');
    expect(b.build().events.map((e) => [e.type, e.at])).toEqual([['nozzle', 0], ['dwell', 1], ['beep', 2]]);
  });

  it('packs colours as 0xRRGGBB, rounding and clamping', () => {
    expect(packRGB([255, 136, 0])).toBe(0xff8800);
    expect(packRGB([300, -4, 1.6])).toBe(0xff0002);
    expect(unpackRGB(0x123456)).toEqual([0x12, 0x34, 0x56]);
  });
});

describe('toolpathStats', () => {
  it('sums lengths, volume and time, including dwells', () => {
    const b = new ToolpathBuilder();
    b.push(move({ kind: MoveKind.Travel, x1: 30, feed: 150 }));
    b.event('dwell', 1.5);
    b.push(move({ x0: 30, x1: 30, y1: 40 })); // 40 mm at 50 mm/s
    b.push(move({ x0: 30, y0: 40, x1: 30, y1: 40, z1: 2.2, kind: MoveKind.Wipe })); // 2 mm straight up
    const s = toolpathStats(b.build());
    expect(s.extrudeCount).toBe(1);
    expect(s.extrudeMm).toBeCloseTo(40);
    expect(s.travelMm).toBeCloseTo(32);
    expect(s.volumeMm3).toBeCloseTo(40 * 0.4 * 0.2);
    expect(s.seconds).toBeCloseTo(30 / 150 + 1.5 + 40 / 50 + 2 / 50);
  });

  it('counts the extrusions before each move', () => {
    const p = circle(4);
    expect(Array.from(extrusionsBefore(p))).toEqual([0, 0, 1, 2, 3, 4]);
  });
});

describe('segmentTransform', () => {
  const out = new Float64Array(12);
  const one = (m: Move) => {
    const b = new ToolpathBuilder();
    b.push(m);
    return b.build();
  };

  it('lays a flat move along its line, hanging one layer below it', () => {
    const p = one(move({ x0: 5, y0: 5, x1: 5, y1: 15, z0: 1, z1: 1 }));
    const e = segmentTransform(p, 0, 1, out);
    const ext = 0.4 * 0.45; // ends overlap by a little under half a line width
    const [ax, ay, az] = apply(e, -0.5, 0, 0);
    const [bx, by] = apply(e, 0.5, 0, 0);
    expect([ax, ay, az]).toEqual([expect.closeTo(5), expect.closeTo(5 - ext / 2), expect.closeTo(0.9)]);
    expect([bx, by]).toEqual([expect.closeTo(5), expect.closeTo(15 + ext / 2)]);
    // Width is horizontal, height is vertical.
    expect(Math.hypot(e[1], e[5], e[9])).toBeCloseTo(0.4);
    expect(e[9]).toBe(0);
    expect([e[2], e[6], e[10]]).toEqual([expect.closeTo(0), expect.closeTo(0), expect.closeTo(0.21)]);
  });

  it('follows a climbing move in 3D, with the cross-section square to it', () => {
    const p = one(move({ x0: 0, y0: 0, z0: 0, x1: 3, y1: 4, z1: 12 })); // length 13
    const e = segmentTransform(p, 0, 1, out);
    const along = [e[0], e[4], e[8]], side = [e[1], e[5], e[9]], up = [e[2], e[6], e[10]];
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(dot(along, side)).toBeCloseTo(0);
    expect(dot(along, up)).toBeCloseTo(0);
    expect(dot(side, up)).toBeCloseTo(0);
    expect(side[2]).toBe(0);
    expect(up[2]).toBeGreaterThan(0);
    // The axis runs from start to end (plus the end overlap), shifted down half a layer.
    const mid = apply(e, 0, 0, 0);
    expect(mid).toEqual([expect.closeTo(1.5), expect.closeTo(2), expect.closeTo(6 - 0.1)]);
    expect(Math.hypot(...along)).toBeCloseTo(13 + 0.4 * 0.45);
  });

  it('draws part of a move from its start', () => {
    const p = one(move({ x0: 0, x1: 10 }));
    const e = segmentTransform(p, 0, 0.25, out);
    expect(e[0]).toBeCloseTo(2.5 + 0.4 * 0.45);
    expect(e[3]).toBeCloseTo(1.25);
  });

  it('handles straight-up and zero-length moves', () => {
    for (const m of [move({ x1: 0, z1: 5 }), move({ x1: 0 })]) {
      const e = segmentTransform(one(m), 0, 1, out);
      for (const v of e) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('fitToBudget', () => {
  it('leaves a path that already fits untouched', () => {
    const p = circle(100);
    const r = fitToBudget(p, 100);
    expect(r.tolerance).toBe(0);
    expect(r.path).toBe(p);
  });

  it('simplifies runs until they fit, keeping the shape and travels', () => {
    const p = circle(5000);
    const r = fitToBudget(p, 400);
    expect(r.tolerance).toBeGreaterThan(0);
    const q = r.path;
    let extrusions = 0;
    for (let i = 0; i < q.count; i++) {
      if (!isExtrusion(q.kind[i])) continue;
      extrusions++;
      // Every simplified point is still on the circle (within the tolerance).
      expect(Math.abs(Math.hypot(q.x1[i], q.y1[i]) - 20)).toBeLessThan(r.tolerance + 1e-3);
    }
    expect(extrusions).toBeLessThanOrEqual(400);
    expect(q.kind[0]).toBe(MoveKind.Travel);
    expect(toolpathStats(q).extrudeMm).toBeCloseTo(toolpathStats(p).extrudeMm, 0);
    // Still one connected loop.
    for (let i = 2; i < q.count; i++) expect([q.x0[i], q.y0[i]]).toEqual([q.x1[i - 1], q.y1[i - 1]]);
  });

  it('never merges across an event, and keeps events in place', () => {
    const b = new ToolpathBuilder();
    for (let k = 0; k < 1000; k++) {
      if (k === 500) b.event('fan', 1);
      b.push(move({ x0: k * 0.01, x1: (k + 1) * 0.01 }));
    }
    const r = fitToBudget(b.build(), 10);
    expect(r.path.count).toBe(2);
    expect(r.path.events).toEqual([{ at: 1, type: 'fan', value: 1 }]);
    expect(r.path.x0[1]).toBeCloseTo(5);
  });
});

describe('douglasPeucker', () => {
  it('keeps corners and drops points on straight lines', () => {
    const pts = [0, 0, 0, 1, 0, 0, 2, 0, 0, 2, 1, 0, 2, 2, 0];
    expect(douglasPeucker(pts, 0.01)).toEqual([0, 2, 4]);
  });
});

describe('layer and kind summaries', () => {
  const b = new ToolpathBuilder();
  b.layerCount = 4;
  b.push(move({ layer: 0, kind: MoveKind.Travel, feed: 150 }));
  b.push(move({ layer: 0 }));
  b.push(move({ layer: 2, kind: MoveKind.SparseInfill, feed: 100 }));
  b.push(move({ layer: 2, kind: MoveKind.Wipe, feed: 5 }));
  const p = b.build();

  it('finds where each layer starts, including empty ones', () => {
    expect(Array.from(layerStarts(p))).toEqual([0, 2, 2, 4, 4]);
  });

  it('splits length, plastic and time by kind', () => {
    const s = statsByKind(p);
    expect(s[MoveKind.OuterWall]).toEqual({ mm: expect.closeTo(10), volumeMm3: expect.closeTo(10 * 0.4 * 0.2), seconds: expect.closeTo(0.2) });
    expect(s[MoveKind.Travel].volumeMm3).toBe(0);
    expect(s[MoveKind.SparseInfill].seconds).toBeCloseTo(0.1);
  });

  it('reports the speed range of extrusions only', () => {
    expect(extrusionFeedRange(p)).toEqual([50, 100]);
    expect(extrusionFeedRange(new ToolpathBuilder().build())).toEqual([0, 0]);
  });
});
