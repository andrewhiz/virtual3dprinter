// Cartesian "bed-slinger": the bed runs in Y, the gantry climbs in Z, the tool head runs in X.

import * as THREE from 'three';
import { buildPanel } from './panel';
import { bedSurface } from './surfaces';
import { disposeTree, Kit, setGlow, spinFans } from './parts';
import type { PrinterRig, PrinterSpec } from './types';

const ACCENT = '#ff7a2a';
const BED_Z = 80; // bed surface above the table

function build(): PrinterRig {
  const kit = new Kit(ACCENT);
  const { m } = kit;
  const root = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.z = BED_Z;
  root.add(inner);

  // Base frame.
  kit.extrusion(30, 400, 'x', [0, -165, -62], inner);
  kit.extrusion(30, 400, 'x', [0, 165, -62], inner);
  kit.extrusion(40, 300, 'y', [0, 0, -57], inner);
  for (const x of [-185, 185]) kit.extrusion(30, 360, 'y', [x, 0, -62], inner);
  for (const x of [-185, 185]) for (const y of [-165, 165]) kit.cyl(10, 6, 'z', [x, y, -77], m.rubber, inner, 20);
  kit.box(90, 70, 50, [-110, 110, -52], m.black, inner); // PSU
  kit.box(88, 10, 44, [-110, 74, -52], m.plastic, inner);

  // Y axis: rods, motor, belt.
  for (const x of [-60, 60]) {
    kit.cyl(4, 340, 'y', [x, 0, -32], m.steel, inner, 16);
    for (const y of [-168, 168]) kit.box(16, 10, 22, [x, y, -40], m.accent, inner);
  }
  kit.stepper(inner, [0, 190, -38], [1, 0, 0]);
  kit.belt(inner, 'y', 340, [0, 0, -33], 'z');
  kit.belt(inner, 'y', 340, [0, 0, -46], 'z');
  kit.cyl(8, 12, 'x', [0, -170, -40], m.alu, inner);

  // Bed.
  const bed = new THREE.Group();
  kit.box(210, 230, 5, [0, 0, -26], m.alu, bed);
  for (const x of [-60, 60]) for (const y of [-80, 80]) kit.box(22, 30, 12, [x, y, -33], m.black, bed);
  kit.box(235, 235, 6, [0, 0, -10], m.black, bed);
  const surface = kit.box(232, 232, 2, [0, 0, -1], bedSurface('pei'), bed);
  surface.castShadow = false;
  for (const [x, y] of [[-105, -105], [105, -105], [-105, 105], [105, 105]]) {
    kit.cyl(3.5, 12, 'z', [x, y, -19], m.steel, bed, 10);
    kit.cyl(8, 6, 'z', [x, y, -32], m.accent, bed, 20);
  }
  inner.add(bed);

  // Z towers, top bar, lead screws, Z motors.
  for (const x of [-195, 195]) kit.extrusion(30, 400, 'z', [x, 40, 125], inner);
  kit.extrusion(30, 420, 'x', [0, 40, 340], inner);
  for (const x of [-160, 160]) {
    kit.stepper(inner, [x, 40, -26], [0, 0, 1]);
    kit.leadScrew(inner, x, 40, 0, 325);
  }
  kit.plate(inner, 'SLINGER i3', 120, 18, [0, 24.6, 340], ACCENT);

  // Gantry (moves in Z).
  const gantry = new THREE.Group();
  kit.extrusion(30, 360, 'x', [0, 40, 72], gantry);
  for (const x of [-195, 195]) kit.box(48, 48, 66, [x, 40, 72], m.accent, gantry);
  for (const x of [-160, 160]) kit.cyl(9, 16, 'z', [x, 40, 72], m.brass, gantry, 6); // lead nuts
  kit.stepper(gantry, [-150, 80, 72], [0, -1, 0]);
  kit.belt(gantry, 'x', 310, [0, 23.5, 80], 'y');
  kit.belt(gantry, 'x', 310, [0, 23.5, 64], 'y');
  kit.cyl(8, 10, 'y', [160, 24, 72], m.alu, gantry);
  inner.add(gantry);

  // Carriage + direct-drive tool head; the nozzle tip is the carriage origin.
  const carriage = new THREE.Group();
  kit.box(62, 8, 74, [0, 20, 72], m.accent, carriage);
  for (const x of [-22, 22]) for (const z of [51, 93]) kit.cyl(8, 7, 'y', [x, 30, z], m.black, carriage, 20);
  kit.box(30, 14, 40, [0, 8, 78], m.plastic, carriage);
  kit.box(36, 26, 28, [0, 4, 112], m.plastic, carriage);
  kit.box(8, 8, 30, [15, -12, 114], m.accent, carriage).rotation.y = 0.2; // extruder lever
  kit.stepper(carriage, [0, 34, 112], [0, -1, 0], true);
  const hot = kit.hotend(carriage);
  gantry.add(carriage);

  // Work light under the top bar.
  const ledMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff1d6, emissiveIntensity: 1.6 });
  kit.box(300, 6, 4, [0, 30, 322], ledMat, inner);
  const lamp = new THREE.SpotLight(0xfff1d6, 60000, 700, 0.9, 0.6, 1.8);
  lamp.position.set(0, 20, 318);
  lamp.target.position.set(0, -20, 0);
  inner.add(lamp, lamp.target);

  // Spool on top.
  kit.box(14, 14, 70, [0, 40, 385], m.frame, inner);
  const spool = kit.spool(inner, [0, 40, 425]);
  const feed = feedLine();
  inner.add(feed);

  // Control panel with a Marlin-style LCD and knob.
  const panel = buildPanel({ style: 'lcd', accent: ACCENT, knob: true, width: 130 });
  panel.group.position.set(135, -200, -30);
  panel.group.rotation.x = -0.5;
  kit.box(20, 30, 10, [135, -182, -45], m.frame, inner);
  inner.add(panel.group);

  const setHead = (x: number, y: number, z: number) => {
    bed.position.y = -y;
    gantry.position.z = z;
    carriage.position.x = x;
    setFeed(feed, [0, 40, 367], [x, 4, z + 126]);
  };
  setHead(0, 0, 20);

  return {
    root,
    printParent: bed,
    buttons: panel.buttons,
    knob: panel.knob,
    setHead,
    setSpool: (a) => (spool.group.rotation.x = -a),
    setFilamentColor: (c) => {
      spool.material.color.copy(c);
      (feed.material as THREE.LineBasicMaterial).color.copy(c);
    },
    setLight: (on) => {
      lamp.intensity = on ? 60000 : 0;
      ledMat.emissiveIntensity = on ? 1.6 : 0;
    },
    press: panel.press,
    updatePanel: panel.update,
    tick: (dt, extruding, printing) => {
      panel.tick(dt);
      spinFans(hot.fans, dt, printing);
      setGlow(hot, extruding);
    },
    dispose: () => disposeTree(root),
  };
}

export function feedLine(): THREE.Line {
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: 0xff8c3c }),
  );
}

/** Filament path from the spool to the extruder, with a little sag. */
export function setFeed(line: THREE.Line, from: [number, number, number], to: [number, number, number]): void {
  const pos = line.geometry.getAttribute('position') as THREE.BufferAttribute;
  pos.setXYZ(0, ...from);
  pos.setXYZ(1, (from[0] + to[0]) / 2, (from[1] + to[1]) / 2 - 20, Math.max(from[2], to[2]) + 10);
  pos.setXYZ(2, ...to);
  pos.needsUpdate = true;
}

export const SLINGER: PrinterSpec = {
  id: 'slinger',
  name: 'Slinger i3',
  category: 'Cartesian bed-slinger',
  blurb: 'The classic open-frame workhorse. The bed swings front to back while the gantry climbs.',
  accent: ACCENT,
  specs: [
    ['Build volume', '220 × 220 × 250 mm'],
    ['Motion', 'Bed Y · gantry Z · head X'],
    ['Print speed', '80 mm/s'],
    ['Hot end', 'Direct drive, 0.4 mm'],
    ['Controls', '12864 LCD + rotary knob'],
  ],
  maxFootprint: 190,
  maxHeight: 200,
  printSpeed: 80,
  travelSpeed: 180,
  temps: { nozzle: 210, bed: 60, chamber: null },
  camera: { position: [560, 470, 980], target: [0, 170, 0] },
  build,
};
