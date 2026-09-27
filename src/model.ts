// Turns a 2D silhouette into a printable 3D solid, described as a signed field:
// field(x, y, z) > 0 inside the part, measured roughly in millimetres from the surface.
// Coordinates: x/y on the bed centred at 0, z up from the bed.

import { PAD, type Analysis, type Mode, type RGB } from './analyze';

export interface ModelOptions {
  mode: Mode;
  /** Target size of the longest printed dimension that follows the photo's height. */
  sizeMm: number;
  /** Standee depth. */
  thicknessMm: number;
  /** Relief height above the base plate. */
  reliefMm: number;
  maxFootprintMm: number;
}

export interface Model {
  mode: Mode;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  field(x: number, y: number, z: number): number;
  color(x: number, y: number, z: number): RGB;
}

export const DEFAULT_MODEL_OPTIONS: ModelOptions = {
  mode: 'revolve',
  sizeMm: 90,
  thicknessMm: 14,
  reliefMm: 8,
  maxFootprintMm: 190,
};

export function buildModel(a: Analysis, opts: ModelOptions): Model {
  switch (opts.mode) {
    case 'revolve':
      return revolveModel(a, opts);
    case 'standee':
      return standeeModel(a, opts);
    case 'relief':
      return reliefModel(a, opts);
  }
}

function bilinear(arr: Float32Array, w: number, h: number, px: number, py: number): number {
  const x = Math.min(w - 1.001, Math.max(0, px - 0.5));
  const y = Math.min(h - 1.001, Math.max(0, py - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const i = y0 * w + x0;
  const top = arr[i] * (1 - fx) + arr[i + 1] * fx;
  const bot = arr[i + w] * (1 - fx) + arr[i + w + 1] * fx;
  return top * (1 - fy) + bot * fy;
}

/** Silhouette distance in pixels at a continuous pixel coordinate; keeps falling off outside the image. */
function sampleSdf(a: Analysis, px: number, py: number): number {
  const cx = Math.min(a.width - 0.5, Math.max(0.5, px));
  const cy = Math.min(a.height - 0.5, Math.max(0.5, py));
  return bilinear(a.sdf, a.width, a.height, cx, cy) - Math.hypot(px - cx, py - cy);
}

function pixelColor(a: Analysis, px: number, py: number): RGB {
  const x = Math.min(a.width - 1, Math.max(0, Math.floor(px)));
  const y = Math.min(a.height - 1, Math.max(0, Math.floor(py)));
  const i = y * a.width + x;
  if (!a.mask[i]) return a.dominant;
  return [a.rgb[i * 3], a.rgb[i * 3 + 1], a.rgb[i * 3 + 2]];
}

/** Lathe the silhouette around its vertical axis: vases, bottles, cups, chess pieces. */
function revolveModel(a: Analysis, o: ModelOptions): Model {
  const { width: W, height: H, mask } = a;
  const bh = H - PAD * 2;

  let sx = 0, n = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      sx += (i % W) + 0.5;
      n++;
    }
  }
  const cx = n ? sx / n : W / 2;

  const radius = new Float32Array(H);
  const center = new Float32Array(H);
  let maxR = 0.5;
  for (let y = 0; y < H; y++) {
    const row = y * W;
    const c = Math.min(W - 1, Math.max(0, Math.floor(cx)));
    if (mask[row + c]) {
      let l = c, r = c;
      while (l > 0 && mask[row + l - 1]) l--;
      while (r < W - 1 && mask[row + r + 1]) r++;
      radius[y] = (r + 1 - l) / 2;
      center[y] = (l + r + 1) / 2;
    } else {
      let cnt = 0, sum = 0;
      for (let x = 0; x < W; x++) {
        if (mask[row + x]) {
          cnt++;
          sum += x + 0.5;
        }
      }
      radius[y] = cnt / 2;
      center[y] = cnt ? sum / cnt : cx;
    }
    if (radius[y] > maxR) maxR = radius[y];
  }

  const pxMm = Math.min(o.sizeMm / bh, o.maxFootprintMm / (2 * maxR));
  const sizeZ = bh * pxMm;
  const rowAt = (z: number) => PAD + bh - z / pxMm;
  const interp = (arr: Float32Array, py: number) => {
    const y = Math.min(PAD + bh - 1, Math.max(PAD, py - 0.5));
    const y0 = Math.floor(y);
    const y1 = Math.min(PAD + bh - 1, y0 + 1);
    const f = y - y0;
    return arr[y0] * (1 - f) + arr[y1] * f;
  };

  return {
    mode: 'revolve',
    sizeX: 2 * maxR * pxMm,
    sizeY: 2 * maxR * pxMm,
    sizeZ,
    field: (x, y, z) => {
      if (z < 0 || z > sizeZ) return -1;
      return interp(radius, rowAt(z)) * pxMm - Math.hypot(x, y);
    },
    color: (x, _y, z) => {
      const py = rowAt(z);
      return pixelColor(a, interp(center, py) + x / pxMm, py);
    },
  };
}

/** Stand the silhouette upright and give it depth, like a cut-out standee or a thick cookie. */
function standeeModel(a: Analysis, o: ModelOptions): Model {
  const bw = a.width - PAD * 2;
  const bh = a.height - PAD * 2;
  const pxMm = Math.min(o.sizeMm / bh, o.maxFootprintMm / bw);
  const colMid = PAD + bw / 2;
  const half = o.thicknessMm / 2;
  const sizeZ = bh * pxMm;
  const px = (x: number) => colMid + x / pxMm;
  const py = (z: number) => PAD + bh - z / pxMm;

  return {
    mode: 'standee',
    sizeX: bw * pxMm,
    sizeY: o.thicknessMm,
    sizeZ,
    field: (x, y, z) => {
      if (z < 0 || z > sizeZ) return -1;
      return Math.min(sampleSdf(a, px(x), py(z)) * pxMm, half - Math.abs(y));
    },
    color: (x, _y, z) => pixelColor(a, px(x), py(z)),
  };
}

/** Lay the photo flat and raise darker areas higher: a relief plaque. */
function reliefModel(a: Analysis, o: ModelOptions): Model {
  const bw = a.width - PAD * 2;
  const bh = a.height - PAD * 2;
  const longest = Math.min(o.sizeMm * 1.6, o.maxFootprintMm);
  const pxMm = longest / Math.max(bw, bh);
  const colMid = PAD + bw / 2;
  const rowMid = PAD + bh / 2;
  const base = Math.max(1.6, o.reliefMm * 0.25);
  const sizeZ = base + o.reliefMm;
  const px = (x: number) => colMid + x / pxMm;
  const py = (y: number) => rowMid - y / pxMm;

  return {
    mode: 'relief',
    sizeX: bw * pxMm,
    sizeY: bh * pxMm,
    sizeZ,
    field: (x, y, z) => {
      if (z < 0) return -1;
      const X = px(x), Y = py(y);
      const lum = bilinear(a.luminance, a.width, a.height, X, Y);
      const top = base + o.reliefMm * (1 - lum);
      return Math.min(sampleSdf(a, X, Y) * pxMm, top - z);
    },
    color: (x, y) => pixelColor(a, px(x), py(y)),
  };
}
