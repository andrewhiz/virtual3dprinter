import { describe, expect, it } from 'vitest';
import { KIND_COLORS, speedColor, toCss } from './palette';
import { isExtrusion, MOVE_KIND_LABELS } from './toolpath';

describe('palette', () => {
  it('gives every printed line type its own colour', () => {
    const printed = MOVE_KIND_LABELS.filter(([k]) => isExtrusion(k)).map(([k]) => KIND_COLORS[k]);
    expect(new Set(printed).size).toBe(printed.length);
  });

  it('runs the speed scale from blue to red and clamps outside 0..1', () => {
    expect(toCss(speedColor(0))).toBe('#3b4cc0');
    expect(toCss(speedColor(1))).toBe('#d7301f');
    expect(speedColor(-3)).toBe(speedColor(0));
    expect(speedColor(7)).toBe(speedColor(1));
    expect(speedColor(Number.NaN)).toBe(speedColor(0));
  });
});
