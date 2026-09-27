// Built-in sample "product photos", drawn procedurally so the app works before any upload.

export interface Demo {
  id: string;
  label: string;
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
];

export function renderDemo(demo: Demo, size = 360): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  demo.draw(cv.getContext('2d') as CanvasRenderingContext2D, size);
  return cv;
}
