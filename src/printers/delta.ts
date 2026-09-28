// Linear delta: three carriages ride up and down the towers, and six parallel arms
// position the effector. Carriage heights come from real delta inverse kinematics.

import * as THREE from 'three';
import { buildPanel } from './panel';
import { quality } from './quality';
import { alignRod, disposeTree, Kit, setGlow, spinFans } from './parts';
import { feedLine, setFeed } from './slinger';
import { bedSurface } from './surfaces';
import type { PrinterRig, PrinterSpec } from './types';

const ACCENT = '#3d8bff';
const BED_Z = 124;
const TOWER_R = 205;
const CARRIAGE_R = 172; // arm pivots on the carriages
const EFFECTOR_R = 34; // arm pivots on the effector
const ARM = 300;
const EFFECTOR_Z = 62; // effector plate above the nozzle tip
const HALF_SPAN = 24; // half the spacing between paired arms
const ANGLES = [210, 330, 90].map((d) => (d * Math.PI) / 180);

function truncatedTriangle(r: number, cut: number): THREE.Shape {
  const s = new THREE.Shape();
  ANGLES.forEach((a, i) => {
    const p1 = [Math.cos(a - cut) * r, Math.sin(a - cut) * r] as const;
    const p2 = [Math.cos(a + cut) * r, Math.sin(a + cut) * r] as const;
    if (i === 0) s.moveTo(...p1);
    else s.lineTo(...p1);
    s.lineTo(...p2);
  });
  s.closePath();
  return s;
}

function build(): PrinterRig {
  const kit = new Kit(ACCENT, 0xb4bac1);
  const { m } = kit;
  const root = new THREE.Group();

  const baseMat = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.45, metalness: 0.35 });
  const baseGeo = new THREE.ExtrudeGeometry(truncatedTriangle(250, 0.2), { depth: 90, bevelEnabled: true, bevelSize: 3, bevelThickness: 3, bevelSegments: 2 });
  kit.add(baseGeo, baseMat, root, [0, 0, 12]);
  const topGeo = new THREE.ExtrudeGeometry(truncatedTriangle(250, 0.2), { depth: 36, bevelEnabled: true, bevelSize: 3, bevelThickness: 3, bevelSegments: 2 });
  kit.add(topGeo, baseMat, root, [0, 0, 830]);
  const trim = new THREE.ExtrudeGeometry(truncatedTriangle(254, 0.2), { depth: 4, bevelEnabled: false });
  kit.add(trim, m.accent, root, [0, 0, 60]);
  for (const a of ANGLES) kit.cyl(14, 12, 'z', [Math.cos(a) * 215, Math.sin(a) * 215, 6], m.rubber, root, 20);

  // Towers, belts, carriages.
  const carriages: THREE.Group[] = [];
  ANGLES.forEach((a) => {
    const tower = new THREE.Group();
    tower.rotation.z = a;
    kit.extrusion(30, 750, 'z', [TOWER_R, 0, 455], tower);
    kit.belt(tower, 'z', 730, [TOWER_R - 17, -8, 455], 'x');
    kit.belt(tower, 'z', 730, [TOWER_R - 17, 8, 455], 'x');
    kit.stepper(tower, [TOWER_R - 10, 0, 60], [1, 0, 0]);
    kit.cyl(8, 12, 'y', [TOWER_R - 17, 0, 815], m.alu, tower);
    root.add(tower);

    const car = new THREE.Group();
    car.rotation.z = a;
    kit.box(26, 50, 58, [TOWER_R - 26, 0, 0], m.accent, car);
    kit.box(10, 60, 10, [CARRIAGE_R + 4, 0, 0], m.alu, car);
    for (const s of [-HALF_SPAN, HALF_SPAN]) kit.add(new THREE.SphereGeometry(4.5, 16, 12), m.steel, car, [CARRIAGE_R, s, 0]);
    root.add(car);
    carriages.push(car);
  });

  // Round heated bed with a glass plate.
  const bed = new THREE.Group();
  bed.position.z = BED_Z;
  kit.cyl(122, 8, 'z', [0, 0, -12], m.alu, bed, 64);
  kit.cyl(118, 3, 'z', [0, 0, -6.5], bedSurface('pei'), bed, 64);
  const glass = kit.cyl(116, 4, 'z', [0, 0, -2], bedSurface('glass'), bed, 64);
  glass.castShadow = false;
  for (const a of ANGLES) kit.box(20, 20, 16, [Math.cos(a) * 120, Math.sin(a) * 120, -12], m.accent, bed);
  for (const a of ANGLES) kit.cyl(6, 22, 'z', [Math.cos(a + 1) * 90, Math.sin(a + 1) * 90, -24], m.frame, bed, 12);
  root.add(bed);

  // Effector with the hot end hanging below; tip at the group origin.
  const eff = new THREE.Group();
  const effGeo = new THREE.ExtrudeGeometry(truncatedTriangle(46, 0.55), { depth: 7, bevelEnabled: false });
  kit.add(effGeo, m.accent, eff, [0, 0, EFFECTOR_Z - 3.5]);
  for (const a of ANGLES) {
    const t = [-Math.sin(a), Math.cos(a)];
    for (const s of [-HALF_SPAN, HALF_SPAN]) {
      kit.add(new THREE.SphereGeometry(4.5, 16, 12), m.steel, eff, [Math.cos(a) * EFFECTOR_R + t[0] * s, Math.sin(a) * EFFECTOR_R + t[1] * s, EFFECTOR_Z]);
    }
  }
  const nozzle = new THREE.ConeGeometry(3.2, 6, 20);
  nozzle.rotateX(-Math.PI / 2);
  kit.add(nozzle, m.brass, eff, [0, 0, 3]);
  kit.cyl(5, 4, 'z', [0, 0, 8], m.brass, eff, 6);
  kit.box(20, 14, 11, [2, 0, 15], m.sock, eff);
  for (let i = 0; i < 7; i++) kit.cyl(10, 1.3, 'z', [0, 0, 28 + i * 3.4], m.alu, eff, 24);
  const fans = [kit.fan(eff, [0, -16, 38], 30)];
  kit.box(10, 8, 18, [16, -10, 12], m.plastic, eff).rotation.z = 0.6;
  kit.box(10, 8, 18, [-16, -10, 12], m.plastic, eff).rotation.z = -0.6;
  const glow = kit.tipGlow(eff);
  root.add(eff);

  // Six carbon arms.
  const carbon = new THREE.MeshStandardMaterial({ color: 0x151618, roughness: 0.35, metalness: 0.3 });
  const arms: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const rod = kit.add(new THREE.CylinderGeometry(2.6, 2.6, 1, 10), carbon, root);
    arms.push(rod);
  }

  // LED ring under the top plate.
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xe6f0ff, emissiveIntensity: 2 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(150, 3, 8, 96), ringMat);
  ring.position.z = 822;
  root.add(ring);
  const ringLight = new THREE.PointLight(0xe6f0ff, 70000, 1200, 1.6);
  ringLight.position.set(0, -40, 790);
  if (!quality.lowPower) root.add(ringLight);

  // Spool on top, Bowden extruder on the top plate.
  kit.box(14, 14, 60, [0, 60, 896], m.frame, root);
  const spool = kit.spool(root, [0, 60, 930]);
  kit.stepper(root, [70, 40, 890], [0, -1, 0]);
  const feed = feedLine();
  (feed.material as THREE.LineBasicMaterial).color.set(0xf4f4f4);
  root.add(feed);

  kit.plate(root, 'KOSSEL DELTA', 130, 18, [0, -169.6, 848], ACCENT);

  const panel = buildPanel({ style: 'oled', accent: ACCENT, knob: false, width: 118 });
  panel.group.position.set(0, -178, 54);
  panel.group.rotation.x = -0.35;
  panel.group.scale.setScalar(0.85);
  root.add(panel.group);

  const a3 = new THREE.Vector3();
  const b3 = new THREE.Vector3();
  const setHead = (x: number, y: number, z: number) => {
    const ez = BED_Z + z + EFFECTOR_Z;
    eff.position.set(x, y, BED_Z + z);
    ANGLES.forEach((a, i) => {
      const dx = x - Math.cos(a) * (CARRIAGE_R - EFFECTOR_R);
      const dy = y - Math.sin(a) * (CARRIAGE_R - EFFECTOR_R);
      const h = ez + Math.sqrt(Math.max(0, ARM * ARM - dx * dx - dy * dy));
      carriages[i].position.z = h;
      const tx = -Math.sin(a), ty = Math.cos(a);
      [-HALF_SPAN, HALF_SPAN].forEach((s, j) => {
        a3.set(Math.cos(a) * CARRIAGE_R + tx * s, Math.sin(a) * CARRIAGE_R + ty * s, h);
        b3.set(x + Math.cos(a) * EFFECTOR_R + tx * s, y + Math.sin(a) * EFFECTOR_R + ty * s, ez);
        alignRod(arms[i * 2 + j], a3, b3);
      });
    });
    setFeed(feed, [70, 20, 890], [x, y, ez + 40]);
  };
  setHead(0, 0, 40);

  return {
    root,
    printParent: bed,
    buttons: panel.buttons,
    knob: null,
    setHead,
    setSpool: (a) => (spool.group.rotation.x = -a),
    setFilamentColor: (c) => spool.material.color.copy(c),
    setLight: (on) => {
      ringLight.intensity = on ? 70000 : 0;
      ringMat.emissiveIntensity = on ? 2 : 0;
    },
    press: panel.press,
    updatePanel: panel.update,
    tick: (dt, extruding, printing) => {
      panel.tick(dt);
      spinFans(fans, dt, printing);
      setGlow(glow, extruding);
    },
    dispose: () => disposeTree(root),
  };
}

export const DELTA: PrinterSpec = {
  id: 'delta',
  name: 'Kossel Delta',
  category: 'Linear delta',
  blurb: 'Three towers, six arms, no gantry. Watch the carriages dance while the nozzle glides over a round bed.',
  accent: ACCENT,
  specs: [
    ['Build volume', 'Ø 220 × 280 mm'],
    ['Motion', '3 towers · parallel arms'],
    ['Print speed', '150 mm/s'],
    ['Hot end', 'Bowden, 0.4 mm'],
    ['Controls', 'Amber OLED'],
  ],
  maxFootprint: 150,
  maxHeight: 220,
  printSpeed: 150,
  travelSpeed: 300,
  temps: { nozzle: 205, bed: 55, chamber: null },
  camera: { position: [840, 760, 1680], target: [0, 390, 0] },
  build,
};
