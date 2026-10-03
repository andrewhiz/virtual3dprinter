// Plays a toolpath back in time: where the nozzle is, which moves are finished, and which timeline
// events have fired. Pure, so playback and seeking can be tested without a renderer.

import { isExtrusion, moveLength, moveSeconds, type TimelineEvent, type Toolpath } from './toolpath';

export interface AdvanceResult {
  /** Moves from..to-1 finished during this step. */
  from: number;
  to: number;
  /** The nozzle laid down filament during this step. */
  extruding: boolean;
  /** Filament path length laid down during this step, in mm. */
  extrudedMm: number;
}

export class Playhead {
  /** The move in progress (count once finished). */
  index = 0;
  /** Distance covered along the move in progress, in mm. */
  done = 0;
  /** Print time elapsed, in seconds. */
  seconds = 0;
  /** Nozzle tip in bed coordinates. */
  readonly head = { x: 0, y: 0, z: 0 };

  private dwell = 0;
  private nextEvent = 0;
  /** startTime[i] = seconds before move i starts, including dwells (length count + 1). */
  private startTime: Float64Array;

  /** `parkZ` is how high the nozzle waits above the bed before and after the print. */
  constructor(readonly path: Toolpath, private readonly parkZ: number) {
    const t = new Float64Array(path.count + 1);
    let e = 0, acc = 0;
    for (let i = 0; i <= path.count; i++) {
      while (e < path.events.length && path.events[e].at <= i) {
        if (path.events[e].type === 'dwell') acc += path.events[e].value;
        e++;
      }
      t[i] = acc;
      if (i < path.count) acc += moveSeconds(path, i);
    }
    this.startTime = t;
    this.seek(0);
  }

  get totalSeconds(): number {
    return this.startTime[this.path.count];
  }

  get finished(): boolean {
    return this.index >= this.path.count;
  }

  /** How far along the move in progress the nozzle is, 0..1. */
  get fraction(): number {
    if (this.finished) return 1;
    const len = moveLength(this.path, this.index);
    return len > 0 ? Math.min(1, this.done / len) : 0;
  }

  /** Jump to the start of move `index` (0 = before the print, count = finished). */
  seek(index: number): void {
    const p = this.path;
    this.index = Math.max(0, Math.min(p.count, Math.floor(index)));
    this.done = 0;
    this.dwell = 0;
    this.seconds = this.startTime[this.index];
    this.nextEvent = 0;
    while (this.nextEvent < p.events.length && p.events[this.nextEvent].at < this.index) this.nextEvent++;
    this.placeHead();
  }

  /** Run the printer for `dt` seconds of print time. */
  advance(dt: number, onEvent?: (e: TimelineEvent) => void): AdvanceResult {
    const p = this.path;
    const from = this.index;
    let budget = dt, extruding = false, extrudedMm = 0;
    while (budget > 0 && this.index < p.count) {
      if (this.done === 0) this.fireEvents(this.index, onEvent);
      if (this.dwell > 0) {
        const t = Math.min(this.dwell, budget);
        this.dwell -= t;
        budget -= t;
        this.seconds += t;
        continue;
      }
      const i = this.index;
      const len = moveLength(p, i);
      const v = Math.max(p.feed[i], 1e-3);
      const need = (len - this.done) / v;
      const ext = isExtrusion(p.kind[i]);
      if (ext) extruding = true;
      if (need <= budget) {
        budget -= need;
        this.seconds += need;
        if (ext) extrudedMm += len - this.done;
        this.index++;
        this.done = 0;
      } else {
        this.done += budget * v;
        this.seconds += budget;
        if (ext) extrudedMm += budget * v;
        budget = 0;
      }
    }
    if (this.index >= p.count) {
      this.fireEvents(p.count, onEvent);
      this.seconds = this.totalSeconds;
    }
    this.placeHead();
    return { from, to: this.index, extruding, extrudedMm };
  }

  private fireEvents(at: number, onEvent?: (e: TimelineEvent) => void): void {
    const ev = this.path.events;
    while (this.nextEvent < ev.length && ev[this.nextEvent].at <= at) {
      const e = ev[this.nextEvent++];
      if (e.type === 'dwell') this.dwell += e.value;
      onEvent?.(e);
    }
  }

  private placeHead(): void {
    const p = this.path, i = this.index;
    if (i >= p.count) {
      // Parked above the finished part.
      this.head.x = 0;
      this.head.y = 0;
      this.head.z = (p.count ? p.z1[p.count - 1] : 0) + this.parkZ;
    } else if (i === 0 && this.done === 0) {
      this.head.x = 0;
      this.head.y = 0;
      this.head.z = this.parkZ;
    } else {
      const f = this.fraction;
      this.head.x = p.x0[i] + (p.x1[i] - p.x0[i]) * f;
      this.head.y = p.y0[i] + (p.y1[i] - p.y0[i]) * f;
      this.head.z = p.z0[i] + (p.z1[i] - p.z0[i]) * f;
    }
  }
}
