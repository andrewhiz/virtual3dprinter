import { describe, expect, it } from 'vitest';
import { Playhead } from './playback';
import { DEFAULT_SLICE_OPTIONS, slice } from './slicer';
import { MoveKind, ToolpathBuilder, toolpathStats, type Move, type TimelineEvent, type Toolpath } from './toolpath';

const PARK = 30;

const move = (over: Partial<Move>): Move => ({
  x0: 0, y0: 0, z0: 0.2, x1: 10, y1: 0, z1: 0.2,
  width: 0.4, height: 0.2, feed: 10,
  kind: MoveKind.OuterWall, layer: 0, color: 0,
  ...over,
});

/** Three 10 mm moves at 10 mm/s with a 2 s dwell before the second and a beep at the end. */
function simple(): Toolpath {
  const b = new ToolpathBuilder();
  b.push(move({ x0: 0, x1: 10 }));
  b.event('dwell', 2);
  b.push(move({ x0: 10, x1: 10, y1: 10, kind: MoveKind.Travel }));
  b.push(move({ x0: 10, y0: 10, x1: 0, y1: 10 }));
  b.event('beep');
  return b.build();
}

const cylinder = slice(
  {
    mode: 'revolve',
    sizeX: 30,
    sizeY: 30,
    sizeZ: 6,
    field: (x, y, z) => (z < 0 || z > 6 ? -1 : 15 - Math.hypot(x, y)),
    color: () => [200, 100, 50],
  },
  { ...DEFAULT_SLICE_OPTIONS, layerHeight: 1 },
);

describe('Playhead', () => {
  it('starts parked and takes the whole print time, dwells included', () => {
    const ph = new Playhead(simple(), PARK);
    expect(ph.head).toEqual({ x: 0, y: 0, z: PARK });
    expect(ph.totalSeconds).toBeCloseTo(5);
    ph.advance(4.99);
    expect(ph.finished).toBe(false);
    ph.advance(0.02);
    expect(ph.finished).toBe(true);
    expect(ph.seconds).toBeCloseTo(5);
    expect(ph.head).toEqual({ x: 0, y: 0, z: expect.closeTo(0.2 + PARK) });
  });

  it('moves the nozzle part-way along a move', () => {
    const ph = new Playhead(simple(), PARK);
    const r = ph.advance(0.25);
    expect(r).toEqual({ from: 0, to: 0, extruding: true, extrudedMm: expect.closeTo(2.5) });
    expect(ph.fraction).toBeCloseTo(0.25);
    expect(ph.head.x).toBeCloseTo(2.5);
    expect(ph.head.z).toBeCloseTo(0.2);
  });

  it('waits out a dwell without moving', () => {
    const ph = new Playhead(simple(), PARK);
    ph.advance(1.5); // first move done, a quarter of the way through the dwell
    expect(ph.index).toBe(1);
    expect(ph.done).toBe(0);
    expect([ph.head.x, ph.head.y]).toEqual([10, 0]);
    ph.advance(1);
    expect(ph.head.y).toBe(0);
    const r = ph.advance(1); // the last 0.5 s of dwell, then 0.5 s of travel
    expect(r.extruding).toBe(false);
    expect(ph.head.y).toBeCloseTo(5);
  });

  it('fires each event once, in order, as playback passes it', () => {
    const ph = new Playhead(simple(), PARK);
    const seen: TimelineEvent['type'][] = [];
    for (let t = 0; t < 60; t++) ph.advance(0.1, (e) => seen.push(e.type));
    expect(seen).toEqual(['dwell', 'beep']);
  });

  it('seeking to a move matches playing up to it', () => {
    const played = new Playhead(cylinder, PARK);
    const seeked = new Playhead(cylinder, PARK);
    const total = played.totalSeconds;
    for (let k = 0; k < 500 && !played.finished; k++) {
      played.advance(total / 500 + 1e-9);
      if (played.done !== 0) continue;
      seeked.seek(played.index);
      expect(seeked.seconds).toBeCloseTo(played.seconds, 6);
      expect(seeked.head).toEqual(played.head);
    }
    seeked.seek(cylinder.count);
    expect(seeked.finished).toBe(true);
    expect(seeked.seconds).toBeCloseTo(toolpathStats(cylinder).seconds);
  });

  it('replays events after a backwards seek', () => {
    const ph = new Playhead(simple(), PARK);
    const seen: string[] = [];
    ph.advance(10, (e) => seen.push(e.type));
    ph.seek(0);
    ph.advance(10, (e) => seen.push(e.type));
    expect(seen).toEqual(['dwell', 'beep', 'dwell', 'beep']);
  });

  it('runs at the per-move feed', () => {
    const b = new ToolpathBuilder();
    b.push(move({ x1: 10, feed: 100 }));
    b.push(move({ x0: 10, x1: 20, feed: 5, kind: MoveKind.Travel }));
    const ph = new Playhead(b.build(), PARK);
    expect(ph.totalSeconds).toBeCloseTo(0.1 + 2);
    ph.advance(0.1);
    expect(ph.index).toBe(1);
  });
});
