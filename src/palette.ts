// Preview colours: one per line type (based on the colour-blind-safe Okabe–Ito set) and a
// slow-to-fast gradient for speed. Pure, so the legend and the scene share them.

import { MoveKind } from './toolpath';

export type ViewMode = 'filament' | 'type' | 'speed';

/** 0xRRGGBB for each MoveKind. */
export const KIND_COLORS: Record<MoveKind, number> = {
  [MoveKind.Travel]: 0x5fd3e6,
  [MoveKind.OuterWall]: 0xe69f00,
  [MoveKind.InnerWall]: 0xf0e442,
  [MoveKind.SparseInfill]: 0xd55e00,
  [MoveKind.SolidInfill]: 0xcc79a7,
  [MoveKind.TopSurface]: 0x56b4e9,
  [MoveKind.SkirtBrim]: 0x009e73,
  [MoveKind.Support]: 0xa0a4aa,
  [MoveKind.Bridge]: 0x0072b2,
  [MoveKind.Wipe]: 0x6e7681,
  [MoveKind.Purge]: 0x8c6d4f,
};

const SPEED_STOPS = [0x3b4cc0, 0x4fb3c8, 0x8fd36b, 0xf2c14e, 0xd7301f];

/** Colour for a speed `t` from 0 (slowest) to 1 (fastest). */
export function speedColor(t: number): number {
  const x = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0)) * (SPEED_STOPS.length - 1);
  const i = Math.min(SPEED_STOPS.length - 2, Math.floor(x));
  const f = x - i, a = SPEED_STOPS[i], b = SPEED_STOPS[i + 1];
  const mix = (shift: number) => Math.round(((a >> shift) & 255) * (1 - f) + ((b >> shift) & 255) * f);
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

export const toCss = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
