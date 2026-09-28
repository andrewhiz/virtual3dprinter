// Draws a shaded three-quarter view of a mesh into a 2D canvas, for thumbnails and the
// "What we found" preview. Painter's algorithm; large meshes are sampled.

import type { RGB } from './analyze';

const MAX_DRAWN = 40000;

export function drawMeshPreview(cv: HTMLCanvasElement, positions: Float32Array, upAxis: 'z' | 'y', color: RGB, bg = '#1d2024'): void {
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  const S = cv.width;
  g.fillStyle = bg;
  g.fillRect(0, 0, S, S);
  const n = Math.floor(positions.length / 9);
  if (!n) return;
  const step = Math.max(1, Math.ceil(n / MAX_DRAWN));
  const yaw = -Math.PI / 4, el = 0.5;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), ce = Math.cos(el), se = Math.sin(el);

  // Project: rotate about Z, then view from the front, raised by `el`.
  const count = Math.ceil(n / step);
  const sx = new Float32Array(count * 3), sY = new Float32Array(count * 3), depth = new Float32Array(count);
  const shade = new Float32Array(count);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const L = [-0.35, -0.55, 0.76];
  let k = 0;
  for (let t = 0; t < n; t += step, k++) {
    const p: number[][] = [];
    for (let v = 0; v < 3; v++) {
      const o = t * 9 + v * 3;
      let x = positions[o], y = positions[o + 1], z = positions[o + 2];
      if (upAxis === 'y') [y, z] = [-z, y];
      const x1 = x * cy - y * sy, y1 = x * sy + y * cy;
      p.push([x1, y1, z]);
      const px = x1, py = -(z * ce + y1 * se);
      sx[k * 3 + v] = px;
      sY[k * 3 + v] = py;
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
    const ux = p[1][0] - p[0][0], uy = p[1][1] - p[0][1], uz = p[1][2] - p[0][2];
    const vx = p[2][0] - p[0][0], vy = p[2][1] - p[0][1], vz = p[2][2] - p[0][2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    shade[k] = 0.38 + 0.62 * Math.abs(nx * L[0] + ny * L[1] + nz * L[2]);
    depth[k] = ((p[0][1] + p[1][1] + p[2][1]) / 3) * ce - ((p[0][2] + p[1][2] + p[2][2]) / 3) * se;
  }
  const order = Array.from({ length: k }, (_, i) => i).sort((a, b) => depth[b] - depth[a]);
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const sc = (S * 0.84) / span;
  const offX = S / 2 - ((minX + maxX) / 2) * sc, offY = S / 2 - ((minY + maxY) / 2) * sc;
  for (const i of order) {
    const f = shade[i];
    g.fillStyle = `rgb(${Math.round(color[0] * f)},${Math.round(color[1] * f)},${Math.round(color[2] * f)})`;
    g.strokeStyle = g.fillStyle;
    g.lineWidth = 0.6;
    g.beginPath();
    g.moveTo(offX + sx[i * 3] * sc, offY + sY[i * 3] * sc);
    g.lineTo(offX + sx[i * 3 + 1] * sc, offY + sY[i * 3 + 1] * sc);
    g.lineTo(offX + sx[i * 3 + 2] * sc, offY + sY[i * 3 + 2] * sc);
    g.closePath();
    g.fill();
    g.stroke();
  }
}
