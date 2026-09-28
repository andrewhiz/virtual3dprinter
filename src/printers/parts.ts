// Shared printer parts: materials, aluminium extrusions, steppers, lead screws, belts,
// hot ends, spools. Everything a Kit creates is disposed together with the printer.

import * as THREE from 'three';

type V3 = [number, number, number];
type Axis = 'x' | 'y' | 'z';

export interface Materials {
  frame: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  alu: THREE.MeshStandardMaterial;
  black: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  plastic: THREE.MeshStandardMaterial;
  sock: THREE.MeshStandardMaterial;
}

export class Kit {
  readonly m: Materials;
  private geoCache = new Map<string, THREE.BufferGeometry>();

  constructor(accent: string, frameColor = 0x24272b) {
    this.m = {
      frame: new THREE.MeshStandardMaterial({ color: frameColor, roughness: 0.42, metalness: 0.75 }),
      accent: new THREE.MeshStandardMaterial({ color: accent, roughness: 0.38, metalness: 0.15 }),
      steel: new THREE.MeshStandardMaterial({ color: 0xc8ced4, roughness: 0.18, metalness: 1 }),
      alu: new THREE.MeshStandardMaterial({ color: 0xd8dce0, roughness: 0.3, metalness: 0.85 }),
      black: new THREE.MeshStandardMaterial({ color: 0x161719, roughness: 0.55, metalness: 0.3 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x0d0d0e, roughness: 0.9 }),
      brass: new THREE.MeshStandardMaterial({ color: 0xd4a84a, roughness: 0.22, metalness: 1 }),
      plastic: new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.62 }),
      sock: new THREE.MeshStandardMaterial({ color: 0xc8402a, roughness: 0.85 }),
    };
  }

  add(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, pos: V3 = [0, 0, 0], shadow = true): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...pos);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  box(w: number, d: number, h: number, pos: V3, mat: THREE.Material, parent: THREE.Object3D): THREE.Mesh {
    return this.add(new THREE.BoxGeometry(w, d, h), mat, parent, pos);
  }

  /** Cylinder with its axis along the given printer axis. */
  cyl(r: number, len: number, axis: Axis, pos: V3, mat: THREE.Material, parent: THREE.Object3D, seg = 24): THREE.Mesh {
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    if (axis === 'x') g.rotateZ(Math.PI / 2);
    return this.add(g, mat, parent, pos);
  }

  /** Slotted aluminium extrusion (2020-style profile scaled to `size`). */
  extrusion(size: number, len: number, axis: Axis, pos: V3, parent: THREE.Object3D, mat: THREE.Material = this.m.frame): THREE.Mesh {
    const key = `ext-${size}-${len}-${axis}`;
    let g = this.geoCache.get(key);
    if (!g) {
      const h = size / 2, w = size * 0.3, d = size * 0.2;
      const s = new THREE.Shape();
      const pts: [number, number][] = [
        [-h, -h], [-w / 2, -h], [-w / 2, -h + d], [w / 2, -h + d], [w / 2, -h],
        [h, -h], [h, -w / 2], [h - d, -w / 2], [h - d, w / 2], [h, w / 2],
        [h, h], [w / 2, h], [w / 2, h - d], [-w / 2, h - d], [-w / 2, h],
        [-h, h], [-h, w / 2], [-h + d, w / 2], [-h + d, -w / 2], [-h, -w / 2],
      ];
      s.moveTo(...pts[0]);
      for (const p of pts.slice(1)) s.lineTo(...p);
      s.closePath();
      const hole = new THREE.Path();
      hole.absarc(0, 0, size * 0.12, 0, Math.PI * 2, true);
      s.holes.push(hole);
      g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false, curveSegments: 10 });
      g.translate(0, 0, -len / 2);
      if (axis === 'x') g.rotateY(Math.PI / 2);
      if (axis === 'y') g.rotateX(Math.PI / 2);
      this.geoCache.set(key, g);
    }
    return this.add(g, mat, parent, pos);
  }

  /** NEMA 17 stepper; the shaft points along `dir`. */
  stepper(parent: THREE.Object3D, pos: V3, dir: V3, pancake = false): THREE.Group {
    const g = new THREE.Group();
    const body = pancake ? 22 : 38;
    this.box(42, 42, body, [0, 0, 0], this.m.black, g);
    this.box(42.4, 42.4, 5, [0, 0, body / 2 - 2.5], this.m.alu, g);
    this.box(42.4, 42.4, 5, [0, 0, -body / 2 + 2.5], this.m.alu, g);
    this.cyl(11, 2, 'z', [0, 0, body / 2 + 1], this.m.alu, g);
    this.cyl(2.5, 20, 'z', [0, 0, body / 2 + 10], this.m.steel, g, 12);
    this.cyl(6.2, 8, 'z', [0, 0, body / 2 + 14], this.m.alu, g, 20);
    this.box(10, 6, 8, [0, -23, -body / 2 + 8], this.m.plastic, g); // connector
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...dir).normalize());
    g.position.set(...pos);
    parent.add(g);
    return g;
  }

  /** Threaded lead screw standing along z from z0 to z0 + len. */
  leadScrew(parent: THREE.Object3D, x: number, y: number, z0: number, len: number): void {
    this.cyl(3.4, len, 'z', [x, y, z0 + len / 2], this.m.steel, parent, 12);
    const pitch = 8, r = 3.7;
    const turns = len / pitch;
    class Helix extends THREE.Curve<THREE.Vector3> {
      constructor() {
        super();
      }
      override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
        const a = t * turns * Math.PI * 2;
        return target.set(r * Math.cos(a), r * Math.sin(a), t * len);
      }
    }
    const tube = new THREE.TubeGeometry(new Helix(), Math.ceil(turns * 10), 0.9, 5, false);
    this.add(tube, this.m.steel, parent, [x, y, z0], false);
  }

  /** Rod between two points. */
  rod(parent: THREE.Object3D, a: V3, b: V3, r: number, mat: THREE.Material = this.m.steel, seg = 12): THREE.Mesh {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    const mesh = this.add(new THREE.CylinderGeometry(r, r, 1, seg), mat, parent);
    alignRod(mesh, va, vb, len);
    return mesh;
  }

  /** Timing belt: an axis-aligned flat strip. */
  belt(parent: THREE.Object3D, axis: Axis, len: number, pos: V3, flatAxis: Axis = 'y'): THREE.Mesh {
    const t = 1.5, w = 6;
    const dims: Record<Axis, number> = { x: w, y: w, z: w };
    dims[axis] = len;
    dims[flatAxis] = t;
    return this.box(dims.x, dims.y, dims.z, pos, this.m.rubber, parent);
  }

  /** Engraved nameplate facing -y. */
  plate(parent: THREE.Object3D, text: string, w: number, h: number, pos: V3, accent: string): THREE.Mesh {
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = Math.round((512 * h) / w);
    const g = cv.getContext('2d') as CanvasRenderingContext2D;
    g.fillStyle = '#1b1d20';
    g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = accent;
    g.fillRect(0, cv.height - 8, cv.width, 8);
    g.fillStyle = '#e9e6df';
    g.font = `700 ${Math.round(cv.height * 0.5)}px "Chakra Petch", "Segoe UI", sans-serif`;
    g.textBaseline = 'middle';
    g.fillText(text, cv.height * 0.35, cv.height * 0.46);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.4 }),
    );
    plane.rotation.x = Math.PI / 2;
    plane.position.set(...pos);
    parent.add(plane);
    return plane;
  }

  /** Spool whose axle runs along x. */
  spool(parent: THREE.Object3D, pos: V3, radius = 58): Spool {
    const group = new THREE.Group();
    group.position.set(...pos);
    const flange = new THREE.MeshStandardMaterial({ color: 0x1c1e21, roughness: 0.45, transparent: true, opacity: 0.88 });
    for (const x of [-30, 30]) this.cyl(radius, 3, 'x', [x, 0, 0], flange, group, 56);
    const wound = new THREE.MeshStandardMaterial({ color: 0xff8c3c, roughness: 0.55, map: windingTexture() });
    this.cyl(radius - 12, 57, 'x', [0, 0, 0], wound, group, 56);
    this.cyl(16, 64, 'x', [0, 0, 0], this.m.plastic, group, 24);
    parent.add(group);
    return { group, material: wound };
  }

  /** Classic hot end with finned heat sink, fan, heater block and silicone sock; tip at origin. */
  hotend(parent: THREE.Object3D): Hotend {
    const g = new THREE.Group();
    const nozzle = new THREE.ConeGeometry(3.2, 6, 20);
    nozzle.rotateX(-Math.PI / 2);
    this.add(nozzle, this.m.brass, g, [0, 0, 3]);
    this.cyl(5.2, 4, 'z', [0, 0, 8], this.m.brass, g, 6);
    this.box(24, 16, 12.5, [2, 0, 15.5], this.m.sock, g);
    this.cyl(1.8, 12, 'z', [0, 0, 26], this.m.steel, g, 10);
    for (let i = 0; i < 9; i++) this.cyl(11, 1.4, 'z', [0, 0, 30 + i * 3.2], this.m.alu, g, 28);
    const fan = this.fan(g, [0, -16, 44], 40);
    // Part-cooling duct.
    this.box(14, 10, 20, [-20, -4, 14], this.m.plastic, g).rotation.y = -0.35;
    const glow = this.tipGlow(g);
    parent.add(g);
    return { group: g, fans: [fan], ...glow };
  }

  /** Axial fan facing -y; returns the spinning blade disc. */
  fan(parent: THREE.Object3D, pos: V3, size: number): THREE.Mesh {
    this.box(size, 10, size, pos, this.m.black, parent);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(size * 0.44, 32),
      new THREE.MeshStandardMaterial({ map: bladeTexture(), transparent: true, roughness: 0.6 }),
    );
    disc.rotation.x = Math.PI / 2;
    disc.position.set(pos[0], pos[1] - 5.1, pos[2]);
    parent.add(disc);
    return disc;
  }

  tipGlow(parent: THREE.Object3D): { glow: THREE.Mesh; light: THREE.PointLight } {
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffb070, transparent: true, opacity: 0 }),
    );
    parent.add(glow);
    const light = new THREE.PointLight(0xff7a2a, 0, 50, 1.6);
    light.position.set(0, -8, 5);
    parent.add(light);
    return { glow, light };
  }
}

export interface Spool {
  group: THREE.Group;
  material: THREE.MeshStandardMaterial;
}

export interface Hotend {
  group: THREE.Group;
  fans: THREE.Mesh[];
  glow: THREE.Mesh;
  light: THREE.PointLight;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();

/** Stretch a unit-height Y cylinder between two points. */
export function alignRod(mesh: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, len = a.distanceTo(b)): void {
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  tmp.copy(b).sub(a).normalize();
  mesh.quaternion.setFromUnitVectors(Y_AXIS, tmp);
  mesh.scale.set(1, len, 1);
}

export function spinFans(fans: THREE.Mesh[], dt: number, on: boolean): void {
  if (!on) return;
  for (const f of fans) f.rotation.z += dt * 40;
}

export function setGlow(h: { glow: THREE.Mesh; light: THREE.PointLight }, on: boolean): void {
  const t = performance.now() / 1000;
  h.light.intensity = on ? 900 + Math.sin(t * 23) * 120 : 0;
  (h.glow.material as THREE.MeshBasicMaterial).opacity = on ? 0.85 : 0;
}

export function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      m.dispose();
    }
  });
}

function windingTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 8;
  cv.height = 256;
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  for (let y = 0; y < 256; y += 2) {
    const v = 200 + Math.round(Math.random() * 55);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(0, y, 8, 1);
    g.fillStyle = 'rgb(150,150,150)';
    g.fillRect(0, y + 1, 8, 1);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 6);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function bladeTexture(): THREE.CanvasTexture {
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  g.translate(s / 2, s / 2);
  g.fillStyle = '#26282b';
  for (let i = 0; i < 7; i++) {
    g.rotate((Math.PI * 2) / 7);
    g.beginPath();
    g.moveTo(8, -4);
    g.quadraticCurveTo(40, -24, 58, -6);
    g.lineTo(56, 8);
    g.quadraticCurveTo(34, -2, 8, 6);
    g.fill();
  }
  g.fillStyle = '#3a3d41';
  g.beginPath();
  g.arc(0, 0, 14, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
