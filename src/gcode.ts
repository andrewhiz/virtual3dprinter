// Cosmetic G-code for the on-screen ticker. Coordinates are shifted onto a 220 mm bed.

import { MoveKind, moveLength, type Toolpath } from './toolpath';

const BED_CENTER = 110;
const FILAMENT_AREA = Math.PI * 0.875 * 0.875; // 1.75 mm filament

export class GcodeWriter {
  private e = 0;
  private layer = -1;

  reset(): void {
    this.e = 0;
    this.layer = -1;
  }

  header(): string[] {
    return ['; Virtual 3D Printer', 'M140 S60 ; bed', 'M104 S210 ; nozzle', 'G28 ; home', 'G90', 'M83'];
  }

  /** The G-code lines for move i of the toolpath. */
  lines(p: Toolpath, i: number): string[] {
    const out: string[] = [];
    if (p.layer[i] !== this.layer) {
      this.layer = p.layer[i];
      out.push(`;LAYER:${this.layer}`, `G1 Z${p.z1[i].toFixed(2)} F600`);
    }
    const x = (p.x1[i] + BED_CENTER).toFixed(2);
    const y = (p.y1[i] + BED_CENTER).toFixed(2);
    const f = Math.round(p.feed[i] * 60);
    const kind = p.kind[i];
    if (kind === MoveKind.Travel) {
      out.push(`G0 X${x} Y${y} F${f}`);
    } else {
      const de = (moveLength(p, i) * p.width[i] * p.height[i]) / FILAMENT_AREA;
      this.e += de;
      const tag = kind === MoveKind.OuterWall || kind === MoveKind.InnerWall ? ' ; wall' : '';
      out.push(`G1 X${x} Y${y} E${de.toFixed(4)} F${f}${tag}`);
    }
    return out;
  }

  get filamentUsedMm(): number {
    return this.e;
  }
}
