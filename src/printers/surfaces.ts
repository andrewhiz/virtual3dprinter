// Procedural textures for build plates and the workbench.

import * as THREE from 'three';
import { quality } from './quality';

export function bedSurface(kind: 'pei' | 'glass' | 'carbon'): THREE.Material {
  if (kind === 'glass' && quality.lowPower) {
    return new THREE.MeshStandardMaterial({ color: 0x9fb4c2, roughness: 0.1, transparent: true, opacity: 0.35 });
  }
  if (kind === 'glass') {
    return new THREE.MeshPhysicalMaterial({
      color: 0x9fb4c2,
      roughness: 0.05,
      metalness: 0,
      transparent: true,
      opacity: 0.35,
      clearcoat: 1,
    });
  }
  const size = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  if (kind === 'pei') {
    const grad = g.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, '#b8893f');
    grad.addColorStop(1, '#9c7232');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    for (let i = 0; i < 14000; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,230,170' : '80,50,20'},${Math.random() * 0.12})`;
      g.fillRect(Math.random() * size, Math.random() * size, 1.5, 1.5);
    }
    g.strokeStyle = 'rgba(60,35,10,0.25)';
  } else {
    g.fillStyle = '#17191c';
    g.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 8) {
      for (let x = 0; x < size; x += 8) {
        g.fillStyle = (x + y) % 16 === 0 ? '#1d2024' : '#141619';
        g.fillRect(x, y, 8, 8);
      }
    }
    g.strokeStyle = 'rgba(255,255,255,0.08)';
  }
  g.lineWidth = 1;
  for (let i = 1; i < 10; i++) {
    const p = (i / 10) * size;
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, size);
    g.moveTo(0, p);
    g.lineTo(size, p);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return new THREE.MeshStandardMaterial({ map: tex, roughness: kind === 'pei' ? 0.75 : 0.4, metalness: 0.15 });
}

export function woodTexture(): THREE.CanvasTexture {
  const w = 1024, h = 512;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#6b4a2f';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 260; i++) {
    const y = Math.random() * h;
    const amp = 2 + Math.random() * 6;
    const freq = 0.004 + Math.random() * 0.01;
    g.strokeStyle = `rgba(${Math.random() < 0.5 ? '40,24,12' : '150,110,70'},${0.08 + Math.random() * 0.15})`;
    g.lineWidth = 0.6 + Math.random() * 2;
    g.beginPath();
    for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * freq + i) * amp);
    g.stroke();
  }
  // Plank seams.
  g.fillStyle = 'rgba(20,12,6,0.55)';
  for (let y = 0; y < h; y += 128) g.fillRect(0, y, w, 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
