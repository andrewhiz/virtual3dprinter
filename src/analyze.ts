// Image analysis: find the product in a photo, measure its silhouette and colours.
// Pure functions over RGBA pixel buffers so they run in Node tests and the browser alike.

export type RGB = [number, number, number];
export type Mode = 'revolve' | 'standee' | 'relief';

export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export interface Analysis {
  /** Cropped, padded working image dimensions. */
  width: number;
  height: number;
  /** 1 = object pixel. */
  mask: Uint8Array;
  /** Signed distance to the silhouette edge in pixels, positive inside. */
  sdf: Float32Array;
  /** 3 bytes per pixel. */
  rgb: Uint8Array;
  /** 0..1 per pixel. */
  luminance: Float32Array;
  dominant: RGB;
  /** Left/right mirror agreement of the silhouette, 0..1. */
  symmetry: number;
  /** Fraction of the source image covered by the object. */
  coverage: number;
  method: 'alpha' | 'background' | 'fallback';
  suggestedMode: Mode;
  /** Object bounding box in source pixels. */
  crop: { x: number; y: number; w: number; h: number };
  /** Full-size mask, for the preview overlay. */
  sourceMask: Uint8Array;
}

/** Transparent padding around the crop so every silhouette is closed. */
export const PAD = 2;

export function analyzeImage(img: RGBAImage): Analysis {
  const { width: w, height: h, data } = img;
  const n = w * h;

  let transparent = 0;
  for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 128) transparent++;

  let mask: Uint8Array = new Uint8Array(n);
  let method: Analysis['method'];
  if (transparent > n * 0.01) {
    method = 'alpha';
    for (let i = 0; i < n; i++) mask[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
  } else {
    method = 'background';
    const bg = borderMedian(img);
    const dist = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const dr = data[i * 4] - bg[0];
      const dg = data[i * 4 + 1] - bg[1];
      const db = data[i * 4 + 2] - bg[2];
      dist[i] = Math.sqrt(dr * dr + dg * dg + db * db);
    }
    const t = Math.max(otsu(dist, 450), 28);
    for (let i = 0; i < n; i++) mask[i] = dist[i] > t ? 1 : 0;
  }

  mask = erode(dilate(mask, w, h), w, h);
  fillHoles(mask, w, h);
  mask = largestComponent(mask, w, h);

  let count = 0;
  for (let i = 0; i < n; i++) count += mask[i];
  let coverage = count / n;
  if (coverage < 0.005 || coverage > 0.985) {
    // Nothing separable from the background: treat the whole photo as the object.
    method = 'fallback';
    mask.fill(1);
    count = n;
    coverage = 1;
  }

  // Bounding box.
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const W = bw + PAD * 2;
  const H = bh + PAD * 2;

  const cmask = new Uint8Array(W * H);
  const rgb = new Uint8Array(W * H * 3);
  const luminance = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = x0 + x - PAD;
      const sy = y0 + y - PAD;
      const inside = sx >= 0 && sy >= 0 && sx < w && sy < h;
      const cx = Math.min(w - 1, Math.max(0, sx));
      const cy = Math.min(h - 1, Math.max(0, sy));
      const si = cy * w + cx;
      const di = y * W + x;
      cmask[di] = inside ? mask[si] : 0;
      const r = data[si * 4], g = data[si * 4 + 1], b = data[si * 4 + 2];
      rgb[di * 3] = r;
      rgb[di * 3 + 1] = g;
      rgb[di * 3 + 2] = b;
      luminance[di] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    }
  }

  const sdf = signedDistance(cmask, W, H);
  const dominant = dominantColor(cmask, rgb);
  const symmetry = mirrorSymmetry(cmask, W, H);

  const suggestedMode: Mode =
    method === 'fallback' ? 'relief' : symmetry >= 0.9 ? 'revolve' : 'standee';

  return {
    width: W,
    height: H,
    mask: cmask,
    sdf,
    rgb,
    luminance,
    dominant,
    symmetry,
    coverage,
    method,
    suggestedMode,
    crop: { x: x0, y: y0, w: bw, h: bh },
    sourceMask: mask,
  };
}

function borderMedian(img: RGBAImage): RGB {
  const { width: w, height: h, data } = img;
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  const push = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    rs.push(data[i]);
    gs.push(data[i + 1]);
    bs.push(data[i + 2]);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    push(0, y);
    push(w - 1, y);
  }
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1];
  return [med(rs), med(gs), med(bs)];
}

/** Otsu's threshold over values in [0, maxVal]. */
export function otsu(values: Float32Array, maxVal: number): number {
  const bins = 256;
  const hist = new Float64Array(bins);
  for (const v of values) hist[Math.min(bins - 1, Math.floor((v / maxVal) * bins))]++;
  const total = values.length;
  let sumAll = 0;
  for (let i = 0; i < bins; i++) sumAll += i * hist[i];
  let wB = 0, sumB = 0, best = 0, bestVar = -1;
  for (let i = 0; i < bins; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      best = i;
    }
  }
  return ((best + 1) / bins) * maxVal;
}

function morph(mask: Uint8Array, w: number, h: number, grow: boolean): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = grow ? 0 : 1;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const m = mask[yy * w + xx];
          if (grow && m) v = 1;
          if (!grow && !m) v = 0;
        }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

const dilate = (m: Uint8Array, w: number, h: number) => morph(m, w, h, true);
const erode = (m: Uint8Array, w: number, h: number) => morph(m, w, h, false);

/** Background pixels not reachable from the border are holes: fill them. */
function fillHoles(mask: Uint8Array, w: number, h: number): void {
  const seen = new Uint8Array(mask.length);
  const stack: number[] = [];
  const seed = (i: number) => {
    if (!mask[i] && !seen[i]) {
      seen[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop() as number;
    const x = i % w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (i >= w) seed(i - w);
    if (i < w * (h - 1)) seed(i + w);
  }
  for (let i = 0; i < mask.length; i++) if (!mask[i] && !seen[i]) mask[i] = 1;
}

function largestComponent(mask: Uint8Array, w: number, h: number): Uint8Array {
  const label = new Int32Array(mask.length);
  let next = 0, bestLabel = 0, bestSize = 0;
  const stack: number[] = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s]) continue;
    next++;
    let size = 0;
    label[s] = next;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop() as number;
      size++;
      const x = i % w;
      const visit = (j: number) => {
        if (mask[j] && !label[j]) {
          label[j] = next;
          stack.push(j);
        }
      };
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (i >= w) visit(i - w);
      if (i < w * (h - 1)) visit(i + w);
    }
    if (size > bestSize) {
      bestSize = size;
      bestLabel = next;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = label[i] === bestLabel && bestLabel ? 1 : 0;
  return out;
}

/** Two-pass chamfer distance to the nearest pixel where `mask === target`. */
function chamfer(mask: Uint8Array, w: number, h: number, target: number): Float32Array {
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] === target ? 0 : 1e9;
  const S = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 1);
        if (x > 0) v = Math.min(v, d[i - w - 1] + S);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + S);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 1);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + S);
        if (x > 0) v = Math.min(v, d[i + w - 1] + S);
      }
      d[i] = v;
    }
  }
  return d;
}

export function signedDistance(mask: Uint8Array, w: number, h: number): Float32Array {
  const toOutside = chamfer(mask, w, h, 0);
  const toInside = chamfer(mask, w, h, 1);
  const sdf = new Float32Array(w * h);
  for (let i = 0; i < sdf.length; i++) {
    sdf[i] = mask[i] ? toOutside[i] - 0.5 : -(toInside[i] - 0.5);
  }
  return sdf;
}

function dominantColor(mask: Uint8Array, rgb: Uint8Array): RGB {
  const counts = new Uint32Array(4096);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    counts[((rgb[i * 3] >> 4) << 8) | ((rgb[i * 3 + 1] >> 4) << 4) | (rgb[i * 3 + 2] >> 4)]++;
  }
  let best = 0;
  for (let b = 1; b < 4096; b++) if (counts[b] > counts[best]) best = b;
  let r = 0, g = 0, bl = 0, k = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const bin = ((rgb[i * 3] >> 4) << 8) | ((rgb[i * 3 + 1] >> 4) << 4) | (rgb[i * 3 + 2] >> 4);
    if (bin !== best) continue;
    r += rgb[i * 3];
    g += rgb[i * 3 + 1];
    bl += rgb[i * 3 + 2];
    k++;
  }
  if (!k) return [200, 200, 200];
  return [Math.round(r / k), Math.round(g / k), Math.round(bl / k)];
}

function mirrorSymmetry(mask: Uint8Array, w: number, h: number): number {
  let sx = 0, n = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      sx += (i % w) + 0.5;
      n++;
    }
  }
  if (!n) return 0;
  const cx = sx / n;
  let match = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const mx = Math.floor(2 * cx - (x + 0.5));
      if (mx >= 0 && mx < w && mask[y * w + mx]) match++;
    }
  }
  return match / n;
}
