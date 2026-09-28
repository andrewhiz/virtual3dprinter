// Enclosed CoreXY: the tool head flies in X/Y across the top, and the bed drops in Z.

import * as THREE from 'three';
import { buildPanel } from './panel';
import { disposeTree, Kit, setGlow, spinFans } from './parts';
import { feedLine, setFeed } from './slinger';
import { bedSurface } from './surfaces';
import type { PrinterRig, PrinterSpec } from './types';

const ACCENT = '#e5484d';
const NOZ = 470; // fixed nozzle-tip height above the table
const S = 225; // frame half-width

function build(): PrinterRig {
  const kit = new Kit(ACCENT, 0x1c1e21);
  const { m } = kit;
  const root = new THREE.Group();

  // Frame cube.
  for (const x of [-S, S]) for (const y of [-S, S]) {
    kit.extrusion(30, 540, 'z', [x, y, 290], root);
    kit.cyl(12, 20, 'z', [x, y, 10], m.rubber, root, 20);
  }
  for (const z of [35, 125, 545]) {
    for (const y of [-S, S]) kit.extrusion(30, 2 * S - 30, 'x', [0, y, z], root);
    for (const x of [-S, S]) kit.extrusion(30, 2 * S - 30, 'y', [x, 0, z], root);
  }
  kit.plate(root, 'CUBE XY', 110, 17, [0, -S - 15.3, 545], ACCENT);

  // Electronics bay skirt.
  const skirt = new THREE.MeshStandardMaterial({ color: 0x141517, roughness: 0.7 });
  kit.box(2 * S - 30, 4, 80, [0, -S - 12, 80], skirt, root);
  kit.box(2 * S - 30, 4, 80, [0, S + 12, 80], skirt, root);
  for (const x of [-S - 12, S + 12]) kit.box(4, 2 * S - 30, 80, [x, 0, 80], skirt, root);
  kit.box(2 * S - 30, 2 * S - 30, 4, [0, 0, 140], m.black, root); // bay lid
  for (let i = 0; i < 8; i++) kit.box(40, 2, 3, [-130 + i * 12, -S - 14.5, 106], m.plastic, root).rotation.y = 0.9; // vents

  // Z: three lead screws with motors in the bay.
  const screws: [number, number][] = [[-190, -120], [190, -120], [0, 190]];
  for (const [x, y] of screws) {
    kit.stepper(root, [x, y, 115], [0, 0, 1]);
    kit.leadScrew(root, x, y, 142, 390);
  }
  for (const x of [-120, 120]) kit.cyl(5, 390, 'z', [x, 200, 337], m.steel, root, 16);

  // Bed on a moving platform.
  const bed = new THREE.Group();
  kit.box(300, 300, 8, [0, 0, -14], m.alu, bed);
  kit.box(262, 262, 6, [0, 0, -7], m.black, bed);
  const surface = kit.box(258, 258, 2, [0, 0, -1], bedSurface('carbon'), bed);
  surface.castShadow = false;
  for (const [x, y] of screws) {
    kit.box(Math.abs(x) > 0 ? 70 : 40, Math.abs(y) > 150 ? 60 : 40, 10, [x * 0.82, y * 0.82, -18], m.accent, bed);
    kit.cyl(9, 20, 'z', [x, y, -18], m.brass, bed, 6);
  }
  root.add(bed);

  // XY motion system on top.
  for (const x of [-205, 205]) {
    kit.box(12, 420, 8, [x, 0, 522], m.steel, root);
    kit.belt(root, 'y', 400, [x + 12, 0, 530], 'x');
    kit.belt(root, 'y', 400, [x + 12, 0, 514], 'x');
    kit.cyl(9, 16, 'z', [x + 12, -205, 522], m.alu, root);
  }
  for (const x of [-195, 195]) kit.stepper(root, [x, 240, 500], [0, 0, 1]);

  const gantry = new THREE.Group();
  kit.box(400, 22, 22, [0, 0, 528], m.black, gantry);
  kit.box(400, 8, 10, [0, -14, 528], m.steel, gantry);
  kit.belt(gantry, 'x', 380, [0, 13, 536], 'y');
  kit.belt(gantry, 'x', 380, [0, 13, 520], 'y');
  for (const x of [-205, 205]) kit.box(30, 44, 16, [x, 0, 530], m.accent, gantry);
  root.add(gantry);

  // Tool head: tip at the group origin.
  const head = new THREE.Group();
  const nozzle = new THREE.ConeGeometry(3.2, 6, 20);
  nozzle.rotateX(-Math.PI / 2);
  kit.add(nozzle, m.brass, head, [0, 0, 3]);
  kit.cyl(5, 4, 'z', [0, 0, 8], m.brass, head, 6);
  kit.box(20, 16, 11, [0, 0, 15], m.sock, head);
  kit.box(56, 46, 70, [0, 6, 56], m.accent, head);
  kit.box(44, 3, 52, [0, -18, 58], m.black, head);
  const fans = [kit.fan(head, [0, -22, 62], 36)];
  const led = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveIntensity: 2 });
  kit.box(34, 2, 3, [0, -20.5, 30], led, head);
  for (const x of [-22, 22]) kit.box(12, 30, 22, [x, -4, 18], m.plastic, head).rotation.y = x > 0 ? -0.5 : 0.5;
  kit.stepper(head, [0, 12, 108], [0, 0, 1], true);
  kit.box(52, 14, 30, [0, -14, 528 - NOZ], m.plastic, head); // rail carriage
  const glow = kit.tipGlow(head);
  head.position.z = NOZ;
  gantry.add(head);

  // Enclosure panels (no shadows so light still reaches inside).
  const acrylic = new THREE.MeshStandardMaterial({
    color: 0xaecbe0,
    roughness: 0.05,
    metalness: 0.1,
    transparent: true,
    opacity: 0.1,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const panelMesh = (w: number, d: number, h: number, pos: [number, number, number]) => {
    const p = kit.box(w, d, h, pos, acrylic, root);
    p.castShadow = false;
    p.receiveShadow = false;
    p.renderOrder = 2;
  };
  panelMesh(2, 2 * S, 400, [-S - 16, 0, 340]);
  panelMesh(2, 2 * S, 400, [S + 16, 0, 340]);
  panelMesh(2 * S, 2, 400, [0, S + 16, 340]);
  panelMesh(2 * S, 2 * S, 2, [0, 0, 562]);
  panelMesh(2 * S - 20, 2, 390, [0, -S - 17, 340]);
  kit.box(10, 12, 120, [S - 40, -S - 26, 340], m.accent, root); // door handle
  for (const z of [180, 500]) kit.box(14, 8, 34, [-S + 10, -S - 20, z], m.frame, root); // hinges

  // Chamber light.
  const ledBar = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xfff4e0, emissiveIntensity: 2 });
  kit.box(360, 6, 4, [0, -S + 18, 520], ledBar, root);
  const chamberLight = new THREE.PointLight(0xfff1dc, 45000, 900, 1.6);
  chamberLight.position.set(0, -120, 500);
  root.add(chamberLight);

  // Side-mounted spool feeding a PTFE tube through the roof.
  kit.box(60, 12, 12, [S + 45, 60, 420], m.frame, root);
  const spool = kit.spool(root, [S + 110, 60, 420]);
  const feed = feedLine();
  (feed.material as THREE.LineBasicMaterial).color.set(0xf4f4f4);
  root.add(feed);

  // Touchscreen on the front of the electronics bay.
  const panel = buildPanel({ style: 'touch', accent: ACCENT, knob: false, width: 150 });
  panel.group.position.set(0, -S - 28, 82);
  panel.group.rotation.x = -0.28;
  root.add(panel.group);

  const setHead = (x: number, y: number, z: number) => {
    bed.position.z = NOZ - z;
    gantry.position.y = y;
    head.position.x = x;
    setFeed(feed, [S + 30, 60, 470], [x, y + 12, NOZ + 130]);
  };
  setHead(0, 0, 20);

  return {
    root,
    printParent: bed,
    buttons: panel.buttons,
    knob: null,
    setHead,
    setSpool: (a) => (spool.group.rotation.x = -a),
    setFilamentColor: (c) => spool.material.color.copy(c),
    setLight: (on) => {
      chamberLight.intensity = on ? 45000 : 0;
      ledBar.emissiveIntensity = on ? 2 : 0;
    },
    press: panel.press,
    updatePanel: panel.update,
    tick: (dt, extruding, printing) => {
      panel.tick(dt);
      spinFans(fans, dt, printing);
      setGlow(glow, extruding);
      led.emissiveIntensity = printing ? 2 : 0.4;
    },
    dispose: () => disposeTree(root),
  };
}

export const COREXY: PrinterSpec = {
  id: 'corexy',
  name: 'Cube XY',
  category: 'Enclosed CoreXY',
  blurb: 'A fast, enclosed cube. Two belts steer the tool head in X and Y while the bed drops away in Z.',
  accent: ACCENT,
  specs: [
    ['Build volume', '250 × 250 × 250 mm'],
    ['Motion', 'Head XY (CoreXY) · bed Z'],
    ['Print speed', '250 mm/s'],
    ['Hot end', 'High-flow, 0.4 mm'],
    ['Controls', 'Colour touchscreen'],
  ],
  maxFootprint: 210,
  maxHeight: 220,
  printSpeed: 250,
  travelSpeed: 500,
  temps: { nozzle: 245, bed: 100, chamber: 45 },
  camera: { position: [640, 560, 1180], target: [0, 230, 0] },
  build,
};
