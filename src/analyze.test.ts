import { describe, expect, it } from 'vitest';
import { analyzeImage, type RGBAImage } from './analyze';

function image(w: number, h: number, paint: (x: number, y: number) => [number, number, number, number]): RGBAImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(paint(x, y), (y * w + x) * 4);
  return { width: w, height: h, data };
}

describe('analyzeImage', () => {
  it('finds a red disc on white and suggests revolving it', () => {
    const img = image(100, 100, (x, y) => (Math.hypot(x - 50, y - 50) < 30 ? [220, 30, 30, 255] : [250, 250, 250, 255]));
    const a = analyzeImage(img);
    expect(a.method).toBe('background');
    expect(a.coverage).toBeGreaterThan(0.25);
    expect(a.coverage).toBeLessThan(0.31);
    expect(a.symmetry).toBeGreaterThan(0.95);
    expect(a.suggestedMode).toBe('revolve');
    expect(a.dominant[0]).toBeGreaterThan(200);
    expect(a.crop.w).toBeGreaterThan(55);
    expect(a.crop.w).toBeLessThan(64);
  });

  it('uses the alpha channel when the photo is a cut-out', () => {
    const img = image(80, 80, (x, y) => (x > 20 && x < 60 && y > 10 && y < 70 ? [10, 120, 200, 255] : [0, 0, 0, 0]));
    const a = analyzeImage(img);
    expect(a.method).toBe('alpha');
    expect(a.crop).toEqual({ x: 21, y: 11, w: 39, h: 59 });
  });

  it('treats a lopsided shape as a standee', () => {
    // An "L": tall bar on the left, foot to the right.
    const img = image(100, 100, (x, y) =>
      (x > 20 && x < 40 && y > 10 && y < 90) || (x >= 40 && x < 85 && y > 70 && y < 90) ? [30, 160, 60, 255] : [255, 255, 255, 255],
    );
    const a = analyzeImage(img);
    expect(a.symmetry).toBeLessThan(0.8);
    expect(a.suggestedMode).toBe('standee');
  });

  it('fills holes so a ring prints as a solid silhouette', () => {
    const img = image(60, 60, (x, y) => {
      const r = Math.hypot(x - 30, y - 30);
      return r < 20 && r > 12 ? [0, 0, 0, 255] : [255, 255, 255, 255];
    });
    const a = analyzeImage(img);
    const cx = Math.floor(a.width / 2), cy = Math.floor(a.height / 2);
    expect(a.mask[cy * a.width + cx]).toBe(1);
  });

  it('falls back to a relief when nothing stands out', () => {
    const img = image(40, 40, () => [128, 128, 128, 255]);
    const a = analyzeImage(img);
    expect(a.method).toBe('fallback');
    expect(a.suggestedMode).toBe('relief');
  });

  it('uses the whole picture when asked, even if an object stands out', () => {
    const img = image(50, 50, (x, y) => (Math.hypot(x - 25, y - 25) < 10 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const a = analyzeImage(img, { wholeImage: true });
    expect(a.method).toBe('fallback');
    expect(a.crop).toEqual({ x: 0, y: 0, w: 50, h: 50 });
  });

  it('produces a signed distance field that is positive inside', () => {
    const img = image(50, 50, (x, y) => (x >= 10 && x < 40 && y >= 10 && y < 40 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const a = analyzeImage(img);
    const mid = Math.floor(a.height / 2) * a.width + Math.floor(a.width / 2);
    expect(a.sdf[mid]).toBeGreaterThan(10);
    expect(a.sdf[0]).toBeLessThan(0);
  });
});
