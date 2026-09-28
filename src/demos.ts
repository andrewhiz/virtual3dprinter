// Built-in sample "product photos", drawn procedurally so the app works before any upload.

import type { Mode } from './analyze';

export interface Demo {
  id: string;
  label: string;
  /** Build mode to use for this sample; omitted means let the analysis decide. */
  mode?: Mode;
  draw(g: CanvasRenderingContext2D, s: number): void;
}

const lathe = (g: CanvasRenderingContext2D, s: number, profile: (t: number) => number, top: number, bottom: number) => {
  const steps = 120;
  g.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    g.lineTo(s / 2 + profile(t) * s, top + (bottom - top) * t);
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    g.lineTo(s / 2 - profile(t) * s, top + (bottom - top) * t);
  }
  g.closePath();
};

export const DEMOS: Demo[] = [
  {
    id: 'vase',
    label: 'Vase',
    draw(g, s) {
      g.fillStyle = '#f5f5f2';
      g.fillRect(0, 0, s, s);
      const profile = (t: number) =>
        t < 0.06 ? 0.13 : 0.1 + 0.05 * Math.sin(t * 5.2 - 0.6) + 0.12 * Math.sin(t * Math.PI) ** 3;
      lathe(g, s, profile, s * 0.1, s * 0.92);
      const grad = g.createLinearGradient(0, s * 0.1, 0, s * 0.92);
      grad.addColorStop(0, '#2bb3a3');
      grad.addColorStop(0.55, '#1f6fb8');
      grad.addColorStop(1, '#233a8a');
      g.fillStyle = grad;
      g.fill();
      g.save();
      g.clip();
      g.fillStyle = 'rgba(255,214,120,0.9)';
      for (const y of [0.34, 0.38, 0.72]) g.fillRect(0, s * y, s, s * 0.018);
      g.restore();
    },
  },
  {
    id: 'suv',
    label: 'Boxy SUV',
    draw(g, s) {
      const P = (x: number, y: number): [number, number] => [x * s, y * s];
      const poly = (pts: [number, number][], fill: string) => {
        g.fillStyle = fill;
        g.beginPath();
        pts.forEach(([x, y], i) => (i ? g.lineTo(...P(x, y)) : g.moveTo(...P(x, y))));
        g.closePath();
        g.fill();
      };
      g.fillStyle = '#eceff2';
      g.fillRect(0, 0, s, s);
      const body = '#b8322a';
      // Roof rack.
      g.fillStyle = '#26282b';
      g.fillRect(...P(0.19, 0.215), s * 0.44, s * 0.022);
      for (const x of [0.22, 0.4, 0.58]) g.fillRect(...P(x, 0.225), s * 0.016, s * 0.04);
      // Cabin, body and hood.
      poly([[0.14, 0.52], [0.17, 0.255], [0.64, 0.255], [0.76, 0.47], [0.93, 0.5], [0.94, 0.7], [0.07, 0.7], [0.07, 0.52]], body);
      // Wheel arches.
      g.fillStyle = '#2a2b2e';
      for (const x of [0.26, 0.77]) {
        g.beginPath();
        g.arc(...P(x, 0.7), s * 0.13, Math.PI, 0);
        g.fill();
      }
      // Windows.
      poly([[0.19, 0.29], [0.33, 0.29], [0.33, 0.46], [0.18, 0.46]], '#9fc3dc');
      poly([[0.355, 0.29], [0.5, 0.29], [0.5, 0.46], [0.355, 0.46]], '#9fc3dc');
      poly([[0.525, 0.29], [0.625, 0.29], [0.71, 0.46], [0.525, 0.46]], '#9fc3dc');
      // Door seams, mirror, lights, bumpers, step.
      g.strokeStyle = 'rgba(0,0,0,0.28)';
      g.lineWidth = s * 0.006;
      for (const x of [0.345, 0.515]) {
        g.beginPath();
        g.moveTo(...P(x, 0.27));
        g.lineTo(...P(x, 0.64));
        g.stroke();
      }
      g.fillStyle = '#26282b';
      g.fillRect(...P(0.66, 0.42), s * 0.035, s * 0.035);
      g.fillRect(...P(0.9, 0.6), s * 0.06, s * 0.08);
      g.fillRect(...P(0.04, 0.6), s * 0.05, s * 0.08);
      g.fillRect(...P(0.38, 0.69), s * 0.26, s * 0.02);
      g.fillStyle = '#ffe08a';
      g.fillRect(...P(0.905, 0.515), s * 0.03, s * 0.04);
      g.fillStyle = '#e8412c';
      g.fillRect(...P(0.07, 0.52), s * 0.025, s * 0.06);
      // Wheels.
      for (const x of [0.26, 0.77]) {
        g.fillStyle = '#1b1c1e';
        g.beginPath();
        g.arc(...P(x, 0.72), s * 0.11, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#b9bec4';
        g.beginPath();
        g.arc(...P(x, 0.72), s * 0.055, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#6d7278';
        g.beginPath();
        g.arc(...P(x, 0.72), s * 0.018, 0, Math.PI * 2);
        g.fill();
      }
    },
  },
  {
    id: 'rocket',
    label: 'Rocket',
    draw(g, s) {
      g.fillStyle = '#1b2540';
      g.fillRect(0, 0, s, s);
      g.fillStyle = '#dfe7ff';
      for (const [x, y] of [[0.1, 0.12], [0.84, 0.2], [0.18, 0.62], [0.88, 0.7], [0.7, 0.08], [0.12, 0.88]]) {
        g.fillRect(x * s, y * s, 2, 2);
      }
      // Fins (mirrored).
      g.fillStyle = '#d6453d';
      for (const side of [-1, 1]) {
        g.beginPath();
        g.moveTo(s / 2 + side * s * 0.08, s * 0.56);
        g.lineTo(s / 2 + side * s * 0.23, s * 0.8);
        g.lineTo(s / 2 + side * s * 0.23, s * 0.88);
        g.lineTo(s / 2 + side * s * 0.08, s * 0.78);
        g.closePath();
        g.fill();
      }
      const profile = (t: number) => {
        if (t < 0.3) return 0.095 * Math.sin((t / 0.3) * (Math.PI / 2)) ** 0.8;
        if (t < 0.84) return 0.095;
        return 0.06 + 0.02 * ((t - 0.84) / 0.16);
      };
      lathe(g, s, profile, s * 0.06, s * 0.94);
      g.fillStyle = '#f1f1ee';
      g.fill();
      g.save();
      g.clip();
      g.fillStyle = '#d6453d';
      g.fillRect(0, 0, s, s * 0.2);
      g.fillRect(0, s * 0.62, s, s * 0.05);
      g.fillStyle = '#8a8f96';
      g.fillRect(0, s * 0.84, s, s * 0.1);
      g.restore();
      g.fillStyle = '#2f4f7f';
      g.beginPath();
      g.arc(s / 2, s * 0.38, s * 0.045, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#8ec5ff';
      g.beginPath();
      g.arc(s / 2, s * 0.38, s * 0.032, 0, Math.PI * 2);
      g.fill();
    },
  },
  {
    id: 'pawn',
    label: 'Chess pawn',
    draw(g, s) {
      g.fillStyle = '#e9ecef';
      g.fillRect(0, 0, s, s);
      const profile = (t: number) => {
        if (t < 0.22) return 0.075 * Math.sqrt(Math.max(0, 1 - ((t - 0.11) / 0.11) ** 2));
        if (t < 0.27) return 0.1;
        if (t < 0.8) return 0.045 + 0.1 * ((t - 0.27) / 0.53) ** 2.2;
        if (t < 0.87) return 0.19;
        return 0.22;
      };
      lathe(g, s, profile, s * 0.08, s * 0.94);
      g.fillStyle = '#8c1d2c';
      g.fill();
    },
  },
  {
    id: 'duck',
    label: 'Rubber duck',
    draw(g, s) {
      g.fillStyle = '#bfe3f5';
      g.fillRect(0, 0, s, s);
      g.fillStyle = '#ffcc1a';
      g.beginPath();
      g.ellipse(s * 0.47, s * 0.66, s * 0.33, s * 0.22, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(s * 0.72, s * 0.58);
      g.lineTo(s * 0.9, s * 0.44);
      g.lineTo(s * 0.8, s * 0.66);
      g.fill();
      g.beginPath();
      g.arc(s * 0.36, s * 0.35, s * 0.17, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ff7a1a';
      g.beginPath();
      g.moveTo(s * 0.2, s * 0.33);
      g.quadraticCurveTo(s * 0.06, s * 0.36, s * 0.09, s * 0.42);
      g.quadraticCurveTo(s * 0.16, s * 0.43, s * 0.23, s * 0.4);
      g.fill();
      g.fillStyle = '#1b1b1b';
      g.beginPath();
      g.arc(s * 0.31, s * 0.3, s * 0.025, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#f2b200';
      g.beginPath();
      g.ellipse(s * 0.52, s * 0.62, s * 0.14, s * 0.07, -0.3, 0, Math.PI * 2);
      g.fill();
    },
  },
  {
    id: 'postcard',
    label: 'Mountain postcard',
    mode: 'relief',
    draw(g, s) {
      const sky = g.createLinearGradient(0, 0, 0, s * 0.62);
      sky.addColorStop(0, '#f3b27a');
      sky.addColorStop(1, '#f7e2c0');
      g.fillStyle = sky;
      g.fillRect(0, 0, s, s);
      g.fillStyle = '#fff4dc';
      g.beginPath();
      g.arc(s * 0.7, s * 0.26, s * 0.08, 0, Math.PI * 2);
      g.fill();
      const ridge = (base: number, peaks: [number, number][], color: string) => {
        g.fillStyle = color;
        g.beginPath();
        g.moveTo(0, s);
        g.lineTo(0, base * s);
        for (const [x, y] of peaks) g.lineTo(x * s, y * s);
        g.lineTo(s, base * s);
        g.lineTo(s, s);
        g.fill();
      };
      ridge(0.55, [[0.12, 0.42], [0.3, 0.28], [0.44, 0.45], [0.6, 0.33], [0.82, 0.5]], '#8a7ca8');
      g.fillStyle = '#fbf8f2';
      g.beginPath();
      g.moveTo(s * 0.3, s * 0.28);
      g.lineTo(s * 0.35, s * 0.34);
      g.lineTo(s * 0.26, s * 0.33);
      g.fill();
      ridge(0.66, [[0.2, 0.5], [0.38, 0.6], [0.55, 0.46], [0.75, 0.58], [0.92, 0.52]], '#4d4a78');
      ridge(0.78, [[0.15, 0.7], [0.5, 0.74], [0.8, 0.68]], '#2b3350');
      g.fillStyle = '#7fa6c9';
      g.fillRect(0, s * 0.8, s, s * 0.2);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      for (let i = 0; i < 6; i++) g.fillRect(s * (0.1 + i * 0.14), s * (0.84 + (i % 3) * 0.04), s * 0.08, 2);
    },
  },
];

export function renderDemo(demo: Demo, size = 360): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  demo.draw(cv.getContext('2d') as CanvasRenderingContext2D, size);
  return cv;
}
