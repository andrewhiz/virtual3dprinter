// The printer's own control panel: a live status screen and physical, clickable buttons.
// Built facing -y (towards the viewer), width along x, height along z.

import * as THREE from 'three';
import type { ControlAction, PanelState } from './types';

export type ScreenStyle = 'lcd' | 'touch' | 'oled';

export interface Panel {
  group: THREE.Group;
  buttons: THREE.Object3D[];
  knob: THREE.Object3D | null;
  update(s: PanelState): void;
  press(button: THREE.Object3D): void;
  tick(dt: number): void;
}

const BUTTONS: { action: ControlAction; icon: string; label: string }[] = [
  { action: 'restart', icon: 'restart', label: 'Restart print' },
  { action: 'toggle', icon: 'play', label: 'Play or pause' },
  { action: 'finish', icon: 'skip', label: 'Skip to the finished part' },
  { action: 'slower', icon: 'minus', label: 'Slower' },
  { action: 'faster', icon: 'plus', label: 'Faster' },
  { action: 'light', icon: 'light', label: 'Toggle light' },
];

export function buildPanel(opts: { style: ScreenStyle; accent: string; knob: boolean; width?: number }): Panel {
  const group = new THREE.Group();
  const W = opts.width ?? 120;
  const screenW = opts.knob ? W * 0.62 : W * 0.86;
  const screenH = screenW / 2;
  const H = screenH + 34;

  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(W, 16, H),
    new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.5, metalness: 0.2 }),
  );
  housing.castShadow = true;
  group.add(housing);
  const bezel = new THREE.Mesh(
    new THREE.BoxGeometry(screenW + 6, 2, screenH + 6),
    new THREE.MeshStandardMaterial({ color: 0x0b0c0d, roughness: 0.3 }),
  );
  const screenX = opts.knob ? -W / 2 + screenW / 2 + 8 : 0;
  const screenZ = H / 2 - screenH / 2 - 6;
  bezel.position.set(screenX, -8.5, screenZ);
  group.add(bezel);

  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 256;
  const ctx = cv.getContext('2d') as CanvasRenderingContext2D;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(screenW, screenH),
    new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }),
  );
  screen.rotation.x = Math.PI / 2;
  screen.position.set(screenX, -9.6, screenZ);
  group.add(screen);

  // Buttons along the bottom edge.
  const buttons: THREE.Object3D[] = [];
  const pitch = Math.min(18, (W - 16) / BUTTONS.length);
  const startX = -((BUTTONS.length - 1) * pitch) / 2;
  const capMat = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.45, metalness: 0.2 });
  const accentCap = new THREE.MeshStandardMaterial({ color: opts.accent, roughness: 0.4 });
  // Invisible but raycastable, so small buttons are easy to hit.
  const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  BUTTONS.forEach((b, i) => {
    const btn = new THREE.Group();
    btn.userData = { action: b.action, label: b.label, rest: -8, pressT: 0 };
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(6, 6.4, 5, 28), b.action === 'toggle' ? accentCap : capMat);
    cap.castShadow = true;
    btn.add(cap);
    const icon = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9),
      new THREE.MeshBasicMaterial({ map: iconTexture(b.icon), transparent: true, toneMapped: false }),
    );
    icon.rotation.x = Math.PI / 2;
    icon.position.y = -2.6;
    btn.add(icon);
    const hitArea = new THREE.Mesh(new THREE.CircleGeometry(pitch * 0.5, 20), hitMat);
    hitArea.rotation.x = Math.PI / 2;
    hitArea.position.y = -3;
    btn.add(hitArea);
    btn.position.set(startX + i * pitch, -8, -H / 2 + 12);
    group.add(btn);
    buttons.push(btn);
  });

  // Rotary encoder knob, Marlin style.
  let knob: THREE.Object3D | null = null;
  if (opts.knob) {
    const k = new THREE.Group();
    k.userData = { action: 'toggle', label: 'Click: play or pause. Scroll: speed', rest: -8, pressT: 0 };
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(9, 10, 12, 36),
      new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.35, metalness: 0.5, map: knurlTexture() }),
    );
    body.castShadow = true;
    k.add(body);
    const top = new THREE.Mesh(new THREE.CircleGeometry(8.4, 36), new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.7, roughness: 0.3 }));
    top.rotation.x = Math.PI / 2;
    top.position.y = -6.05;
    k.add(top);
    const tick = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 6), accentCap);
    tick.position.set(0, -6.3, 4);
    k.add(tick);
    k.position.set(W / 2 - (W - screenW - 8) / 2, -8, screenZ);
    group.add(k);
    buttons.push(k);
    knob = k;
  }

  let spin = 0;
  const press = (b: THREE.Object3D) => {
    b.userData.pressT = 0.16;
    if (b === knob) spin += Math.PI / 6;
  };
  const tickFn = (dt: number) => {
    for (const b of buttons) {
      const t = b.userData.pressT as number;
      b.userData.pressT = Math.max(0, t - dt);
      b.position.y = (b.userData.rest as number) + (t > 0 ? 2.2 : 0);
    }
    if (knob) knob.rotation.y += (spin - knob.rotation.y) * Math.min(1, dt * 12);
  };
  const turn = (dir: number) => {
    spin += dir * (Math.PI / 12);
  };
  if (knob) knob.userData.turn = turn;

  return {
    group,
    buttons,
    knob,
    update: (s) => {
      drawScreen(ctx, opts.style, opts.accent, s);
      tex.needsUpdate = true;
    },
    press,
    tick: tickFn,
  };
}

// ---------- Screen rendering ----------

function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

const STATE_TEXT: Record<PanelState['state'], string> = {
  idle: 'Choose a model',
  ready: 'Ready',
  printing: 'Printing',
  paused: 'Paused',
  done: 'Print complete',
};

function drawScreen(g: CanvasRenderingContext2D, style: ScreenStyle, accent: string, s: PanelState): void {
  if (style === 'touch') return drawTouch(g, accent, s);
  // Character displays: 128x64 blue LCD or amber OLED look.
  const lcd = style === 'lcd';
  const bg = lcd ? '#1f3cc4' : '#050505';
  const fg = lcd ? '#e6ecff' : '#ffb000';
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 256);
  if (lcd) {
    g.fillStyle = 'rgba(255,255,255,0.05)';
    for (let x = 0; x < 512; x += 4) g.fillRect(x, 0, 1, 256);
    for (let y = 0; y < 256; y += 4) g.fillRect(0, y, 512, 1);
  }
  g.fillStyle = fg;
  g.font = '600 26px "IBM Plex Mono", ui-monospace, monospace';
  g.textBaseline = 'top';
  const noz = `${Math.round(s.nozzle)}/${s.nozzleTarget}°`;
  const bed = `${Math.round(s.bed)}/${s.bedTarget}°`;
  g.fillText(`E ${noz}`, 16, 12);
  g.fillText(`B ${bed}`, 280, 12);
  g.fillRect(16, 50, 480, 2);
  g.font = '600 30px "IBM Plex Mono", ui-monospace, monospace';
  g.fillText(STATE_TEXT[s.state], 16, 64);
  g.font = '500 24px "IBM Plex Mono", ui-monospace, monospace';
  g.fillText(s.file, 16, 104);
  // Progress bar.
  g.strokeStyle = fg;
  g.lineWidth = 3;
  g.strokeRect(16, 142, 480, 26);
  g.fillRect(20, 146, 472 * Math.min(1, s.progress), 18);
  g.font = '600 24px "IBM Plex Mono", ui-monospace, monospace';
  g.fillText(`L ${s.layer}/${s.layerCount}`, 16, 184);
  g.fillText(`${Math.round(s.progress * 100)}%`, 230, 184);
  g.fillText(`FR ${s.speed}x`, 360, 184);
  g.fillText(`${clock(s.elapsed)}`, 16, 218);
  g.fillText(`-${clock(s.remaining)}`, 280, 218);
}

function drawTouch(g: CanvasRenderingContext2D, accent: string, s: PanelState): void {
  g.fillStyle = '#0d1014';
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#171b21';
  g.fillRect(0, 0, 512, 40);
  g.fillStyle = accent;
  g.fillRect(0, 38, 512 * Math.min(1, s.progress), 2);
  g.textBaseline = 'middle';
  g.fillStyle = '#e8ecf1';
  g.font = '600 20px "Chakra Petch", "Segoe UI", sans-serif';
  g.fillText(s.model, 14, 20);
  g.fillStyle = s.state === 'printing' ? accent : '#9aa3ad';
  g.textAlign = 'right';
  g.fillText(STATE_TEXT[s.state], 498, 20);
  g.textAlign = 'left';

  // Progress ring.
  const cx = 104, cy = 146, r = 70;
  g.lineWidth = 12;
  g.strokeStyle = '#232a33';
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = accent;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, s.progress));
  g.stroke();
  g.lineCap = 'butt';
  g.fillStyle = '#f3f5f8';
  g.textAlign = 'center';
  g.font = '700 34px "Chakra Petch", "Segoe UI", sans-serif';
  g.fillText(`${Math.round(s.progress * 100)}%`, cx, cy - 6);
  g.font = '500 16px "IBM Plex Mono", monospace';
  g.fillStyle = '#9aa3ad';
  g.fillText(`L ${s.layer}/${s.layerCount}`, cx, cy + 26);
  g.textAlign = 'left';

  const tiles: [string, string][] = [
    ['Nozzle', `${Math.round(s.nozzle)}° / ${s.nozzleTarget}°`],
    ['Bed', `${Math.round(s.bed)}° / ${s.bedTarget}°`],
    ['Chamber', s.chamber === null ? '–' : `${Math.round(s.chamber)}°`],
    ['Speed', `${s.speed}×`],
  ];
  tiles.forEach(([k, v], i) => {
    const x = 204 + (i % 2) * 150, y = 58 + Math.floor(i / 2) * 64;
    g.fillStyle = '#161b22';
    g.fillRect(x, y, 140, 56);
    g.fillStyle = '#8b95a1';
    g.font = '500 14px "IBM Plex Sans", sans-serif';
    g.fillText(k, x + 10, y + 16);
    g.fillStyle = '#eef1f5';
    g.font = '600 19px "IBM Plex Mono", monospace';
    g.fillText(v, x + 10, y + 38);
  });
  g.fillStyle = '#8b95a1';
  g.font = '500 15px "IBM Plex Mono", monospace';
  g.fillText(s.file, 204, 204);
  g.fillText(`${clock(s.elapsed)}   −${clock(s.remaining)}`, 204, 232);
}

// ---------- Textures ----------

function iconTexture(kind: string): THREE.CanvasTexture {
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  g.strokeStyle = g.fillStyle = '#f2f2f2';
  g.lineWidth = 6;
  g.lineCap = g.lineJoin = 'round';
  g.beginPath();
  switch (kind) {
    case 'play':
      g.moveTo(18, 14); g.lineTo(34, 32); g.lineTo(18, 50); g.closePath(); g.fill();
      g.fillRect(38, 14, 5, 36); g.fillRect(47, 14, 5, 36);
      break;
    case 'restart':
      g.arc(32, 34, 16, -Math.PI * 0.2, Math.PI * 1.35); g.stroke();
      g.beginPath(); g.moveTo(42, 8); g.lineTo(48, 22); g.lineTo(34, 24); g.closePath(); g.fill();
      break;
    case 'skip':
      g.moveTo(14, 14); g.lineTo(38, 32); g.lineTo(14, 50); g.closePath(); g.fill();
      g.fillRect(42, 14, 7, 36);
      break;
    case 'minus':
      g.moveTo(14, 32); g.lineTo(50, 32); g.stroke();
      break;
    case 'plus':
      g.moveTo(14, 32); g.lineTo(50, 32); g.moveTo(32, 14); g.lineTo(32, 50); g.stroke();
      break;
    case 'light':
      g.arc(32, 26, 13, Math.PI * 0.8, Math.PI * 2.2); g.stroke();
      g.beginPath(); g.moveTo(24, 44); g.lineTo(40, 44); g.moveTo(26, 53); g.lineTo(38, 53); g.stroke();
      break;
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function knurlTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 8;
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  for (let x = 0; x < 128; x += 4) {
    g.fillStyle = '#9a9a9a';
    g.fillRect(x, 0, 2, 8);
    g.fillStyle = '#5a5a5a';
    g.fillRect(x + 2, 0, 2, 8);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(4, 1);
  return tex;
}
