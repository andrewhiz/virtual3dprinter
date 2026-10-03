// Turns a triangle mesh (STL / OBJ / 3MF / PLY) into a sliceable field model.
// Each layer is cut with a horizontal plane and the cross-section is filled along scanlines.
// Filling uses the non-zero winding rule from each triangle's facing, so overlapping parts
// (a handle through a mug wall) merge into one solid; rows whose winding doesn't balance
// (inconsistently oriented files) fall back to even-odd. A 2D signed distance field then lets
// the slicer inset walls exactly as it does for photo models.

import { signedDistance, type RGB } from './analyze';
import type { Model } from './model';

export interface MeshData {
  /** Triangle soup: 9 floats (3 vertices) per triangle. */
  positions: Float32Array;
  color: RGB | null;
  name: string;
  format: string;
  /** Which axis points up in the file's coordinates. */
  upAxis: 'z' | 'y';
  /** Longest side to load at, in mm (built-in samples that read best at a set size). */
  printSize?: number;
}

export interface MeshModelOptions {
  /** Longest printed side in mm. */
  sizeMm: number;
  maxFootprintMm: number;
  maxHeightMm: number;
  upAxis: 'z' | 'y';
  color: RGB;
}

export interface MeshBounds {
  x: number;
  y: number;
  z: number;
}

/** Size of the mesh in its own units once the chosen axis points up. */
export function meshBounds(positions: Float32Array, upAxis: 'z' | 'y'): MeshBounds {
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    const p = orient(positions[i], positions[i + 1], positions[i + 2], upAxis);
    for (let k = 0; k < 3; k++) {
      if (p[k] < mn[k]) mn[k] = p[k];
      if (p[k] > mx[k]) mx[k] = p[k];
    }
  }
  return { x: mx[0] - mn[0], y: mx[1] - mn[1], z: mx[2] - mn[2] };
}

/** Drops triangles with NaN or infinite coordinates, which broken exporters sometimes write. */
export function dropNonFinite(positions: Float32Array): Float32Array {
  const n = Math.floor(positions.length / 9);
  let keep = 0;
  const ok = new Uint8Array(n);
  for (let t = 0; t < n; t++) {
    let finite = true;
    for (let k = t * 9; k < t * 9 + 9 && finite; k++) finite = Number.isFinite(positions[k]);
    ok[t] = finite ? 1 : 0;
    keep += ok[t];
  }
  if (keep === n && positions.length === n * 9) return positions;
  const out = new Float32Array(keep * 9);
  for (let t = 0, o = 0; t < n; t++) {
    if (!ok[t]) continue;
    out.set(positions.subarray(t * 9, t * 9 + 9), o);
    o += 9;
  }
  return out;
}

function orient(x: number, y: number, z: number, up: 'z' | 'y'): [number, number, number] {
  return up === 'z' ? [x, y, z] : [x, -z, y];
}

export function buildMeshModel(mesh: MeshData, o: MeshModelOptions): Model {
  const src = mesh.positions;
  const n = Math.floor(src.length / 9);
  if (!n) throw new Error('The file has no triangles.');

  // Orient, then measure.
  const pos = new Float32Array(n * 9);
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n * 3; i++) {
    const p = orient(src[i * 3], src[i * 3 + 1], src[i * 3 + 2], o.upAxis);
    for (let k = 0; k < 3; k++) {
      pos[i * 3 + k] = p[k];
      if (p[k] < mn[k]) mn[k] = p[k];
      if (p[k] > mx[k]) mx[k] = p[k];
    }
  }
  const ext = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  const longest = Math.max(ext[0], ext[1], ext[2]) || 1;
  let s = o.sizeMm / longest;
  s = Math.min(s, o.maxFootprintMm / Math.max(ext[0], ext[1], 1e-9), o.maxHeightMm / Math.max(ext[2], 1e-9));
  const cx = (mn[0] + mx[0]) / 2, cy = (mn[1] + mx[1]) / 2;
  for (let i = 0; i < n * 3; i++) {
    pos[i * 3] = (pos[i * 3] - cx) * s;
    pos[i * 3 + 1] = (pos[i * 3 + 1] - cy) * s;
    pos[i * 3 + 2] = (pos[i * 3 + 2] - mn[2]) * s;
  }
  const sizeX = ext[0] * s, sizeY = ext[1] * s, sizeZ = ext[2] * s;

  // Which way each triangle faces along +x: entering the solid (+1), leaving (-1), or edge-on /
  // degenerate (0, counts for even-odd only).
  const triDir = new Int8Array(n);
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const ux = pos[o + 3] - pos[o], uy = pos[o + 4] - pos[o + 1], uz = pos[o + 5] - pos[o + 2];
    const vx = pos[o + 6] - pos[o], vy = pos[o + 7] - pos[o + 1], vz = pos[o + 8] - pos[o + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    triDir[t] = len < 1e-12 || Math.abs(nx) < len * 1e-6 ? 0 : nx < 0 ? 1 : -1;
  }

  // Bucket triangles by height so each layer only looks at the ones it can cut.
  const bins = Math.max(32, Math.min(2048, Math.ceil(n / 40)));
  const binOf = (z: number) => Math.min(bins - 1, Math.max(0, Math.floor((z / (sizeZ || 1)) * bins)));
  const counts = new Uint32Array(bins + 1);
  const triLo = new Uint16Array(n), triHi = new Uint16Array(n);
  for (let t = 0; t < n; t++) {
    const z0 = pos[t * 9 + 2], z1 = pos[t * 9 + 5], z2 = pos[t * 9 + 8];
    triLo[t] = binOf(Math.min(z0, z1, z2));
    triHi[t] = binOf(Math.max(z0, z1, z2));
    for (let b = triLo[t]; b <= triHi[t]; b++) counts[b + 1]++;
  }
  for (let b = 0; b < bins; b++) counts[b + 1] += counts[b];
  const binTris = new Uint32Array(counts[bins]);
  const fill = counts.slice(0, bins);
  for (let t = 0; t < n; t++) for (let b = triLo[t]; b <= triHi[t]; b++) binTris[fill[b]++] = t;

  // Layer grid.
  const c = Math.max(Math.max(sizeX, sizeY) / 180, 0.2);
  const gw = Math.ceil(sizeX / c) + 6;
  const gh = Math.ceil(sizeY / c) + 6;
  const ox = -sizeX / 2 - 3 * c;
  const oy = -sizeY / 2 - 3 * c;
  const mask = new Uint8Array(gw * gh);
  const rows: number[][] = Array.from({ length: gh }, () => []);
  let layerZ = NaN;
  let sdf: Float32Array = new Float32Array(gw * gh);

  const computeLayer = (z: number) => {
    layerZ = z;
    mask.fill(0);
    for (const r of rows) r.length = 0;
    const b = binOf(z);
    const pts: number[] = [];
    for (let k = counts[b]; k < counts[b + 1]; k++) {
      const tri = binTris[k];
      const t = tri * 9;
      pts.length = 0;
      for (let e = 0; e < 3; e++) {
        const a = t + e * 3, d = t + ((e + 1) % 3) * 3;
        const za = pos[a + 2], zd = pos[d + 2];
        if ((za <= z) === (zd <= z)) continue;
        const f = (z - za) / (zd - za);
        pts.push(pos[a] + (pos[d] - pos[a]) * f, pos[a + 1] + (pos[d + 1] - pos[a + 1]) * f);
      }
      if (pts.length !== 4) continue;
      // Record where this cut segment crosses each grid row centre.
      const [x1, y1, x2, y2] = pts;
      const ylo = Math.min(y1, y2), yhi = Math.max(y1, y2);
      const j0 = Math.max(0, Math.ceil((ylo - oy) / c - 0.5));
      const j1 = Math.min(gh - 1, Math.floor((yhi - oy) / c - 0.5));
      for (let j = j0; j <= j1; j++) {
        const yc = oy + (j + 0.5) * c;
        if (yc < ylo || yc >= yhi) continue;
        rows[j].push(x1 + ((yc - y1) / (y2 - y1)) * (x2 - x1), triDir[tri]);
      }
    }
    const order: number[] = [];
    for (let j = 0; j < gh; j++) {
      const row = rows[j];
      const m = row.length / 2;
      if (m < 2) continue;
      order.length = 0;
      let net = 0;
      for (let k = 0; k < m; k++) {
        order.push(k);
        net += row[k * 2 + 1];
      }
      order.sort((p, q) => row[p * 2] - row[q * 2]);
      // A closed, consistently oriented mesh always returns to zero winding along a row.
      const nonZero = net === 0;
      let w = 0, parity = 0;
      for (let k = 0; k + 1 < m; k++) {
        w += row[order[k] * 2 + 1];
        parity ^= 1;
        if (!(nonZero ? w !== 0 : parity === 1)) continue;
        const i0 = Math.max(0, Math.ceil((row[order[k] * 2] - ox) / c - 0.5));
        const i1 = Math.min(gw - 1, Math.floor((row[order[k + 1] * 2] - ox) / c - 0.5));
        for (let i = i0; i <= i1; i++) mask[j * gw + i] = 1;
      }
    }
    sdf = signedDistance(mask, gw, gh);
  };

  const sample = (x: number, y: number): number => {
    const fx = (x - ox) / c - 0.5, fy = (y - oy) / c - 0.5;
    const cxl = Math.min(gw - 1.001, Math.max(0, fx));
    const cyl = Math.min(gh - 1.001, Math.max(0, fy));
    const i = Math.floor(cxl), j = Math.floor(cyl);
    const tx = cxl - i, ty = cyl - j;
    const k = j * gw + i;
    const top = sdf[k] * (1 - tx) + sdf[k + 1] * tx;
    const bot = sdf[k + gw] * (1 - tx) + sdf[k + gw + 1] * tx;
    const outside = Math.hypot(fx - cxl, fy - cyl);
    return (top * (1 - ty) + bot * ty - outside) * c;
  };

  return {
    mode: 'standee',
    sizeX,
    sizeY,
    sizeZ,
    field: (x, y, z) => {
      if (z < 0 || z > sizeZ) return -1;
      if (z !== layerZ) computeLayer(z);
      return sample(x, y);
    },
    color: () => o.color,
  };
}
