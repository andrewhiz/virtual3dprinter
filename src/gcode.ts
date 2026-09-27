// Cosmetic G-code for the on-screen ticker. Coordinates are shifted onto a 220 mm bed.

import { MoveKind, type Move } from './slicer';

const BED_CENTER = 110;
const FILAMENT_AREA = Math.PI * 0.875 * 0.875; // 1.75 mm filament

export class GcodeWriter {
  private e = 0;
  private layer = -1;

  constructor(private readonly lineWidth: number, private readonly layerHeight: number) {}

  reset(): void {
    this.e = 0;
    this.layer = -1;
  }

  header(): string[] {
    return ['; Virtual 3D Printer', 'M140 S60 ; bed', 'M104 S210 ; nozzle', 'G28 ; home', 'G90', 'M83'];
  }

  lines(m: Move): string[] {
    const out: string[] = [];
    if (m.layer !== this.layer) {
      this.layer = m.layer;
      out.push(`;LAYER:${m.layer}`, `G1 Z${m.z.toFixed(2)} F600`);
    }
    const x = (m.x1 + BED_CENTER).toFixed(2);
    const y = (m.y1 + BED_CENTER).toFixed(2);
    if (m.kind === MoveKind.Travel) {
      out.push(`G0 X${x} Y${y} F9000`);
    } else {
      const len = Math.hypot(m.x1 - m.x0, m.y1 - m.y0);
      const de = (len * this.lineWidth * this.layerHeight) / FILAMENT_AREA;
      this.e += de;
      const tag = m.kind === MoveKind.Perimeter ? ' ; wall' : '';
      out.push(`G1 X${x} Y${y} E${de.toFixed(4)} F3600${tag}`);
    }
    return out;
  }

  get filamentUsedMm(): number {
    return this.e;
  }
}
