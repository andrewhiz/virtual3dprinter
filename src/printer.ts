// The virtual printer: a bed-slinger with a moving gantry, a hot end, a spool, and the
// deposited filament rendered as one InstancedMesh that grows move by move.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MoveKind, type Move, type SliceResult } from './slicer';

const PRINT_SPEED = 60; // mm/s while extruding
const TRAVEL_SPEED = 150; // mm/s
const PARK_Z = 20;

export interface PrintStatus {
  layer: number;
  layerCount: number;
  progress: number;
  printSeconds: number;
  totalSeconds: number;
  finished: boolean;
  playing: boolean;
  newMoves: Move[];
}

export class PrinterScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private root = new THREE.Group();
  private bed = new THREE.Group();
  private gantry = new THREE.Group();
  private carriage = new THREE.Group();
  private spool = new THREE.Group();
  private spoolCore!: THREE.Mesh;
  private feedLine!: THREE.Line;
  private nozzleLight = new THREE.PointLight(0xff7a2a, 0, 45, 1.6);
  private tipGlow!: THREE.Mesh;
  private timer = new THREE.Timer();

  private mesh: THREE.InstancedMesh | null = null;
  private result: SliceResult | null = null;
  private instanceOf: Int32Array = new Int32Array(0);
  private moveIdx = 0;
  private moveDone = 0;
  private partial = -1;
  private printSeconds = 0;
  private totalSeconds = 0;
  private spoolAngle = 0;
  private nozzle = new THREE.Vector3(0, 0, PARK_Z);
  private extruding = false;

  playing = false;
  speed = 25;
  follow = false;
  onStatus: (s: PrintStatus) => void = () => {};

  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private tmpS = new THREE.Vector3();
  private zAxis = new THREE.Vector3(0, 0, 1);

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(38, 1, 1, 4000);
    this.camera.position.set(470, 400, 800);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 175, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.52;
    this.controls.minDistance = 60;
    this.controls.maxDistance = 1400;

    this.scene.background = new THREE.Color(0x121416);
    this.scene.fog = new THREE.Fog(0x121416, 900, 2200);

    const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x2a2622, 1.6);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 2.6);
    sun.position.set(260, 520, 320);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -320;
    sc.right = 320;
    sc.top = 320;
    sc.bottom = -320;
    sc.far = 1400;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x8fb3ff, 0.6);
    rim.position.set(-400, 200, -300);
    this.scene.add(rim);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(1400, 64),
      new THREE.MeshStandardMaterial({ color: 0x1b1e21, roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -72;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Printer space: z up.
    this.root.rotation.x = -Math.PI / 2;
    this.scene.add(this.root);
    this.buildPrinter();

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private buildPrinter(): void {
    const frame = new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.55, metalness: 0.4 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xff7a2a, roughness: 0.45, metalness: 0.1 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xb9c0c8, roughness: 0.25, metalness: 0.9 });
    const alu = new THREE.MeshStandardMaterial({ color: 0xd4d8dd, roughness: 0.35, metalness: 0.7 });
    const black = new THREE.MeshStandardMaterial({ color: 0x151719, roughness: 0.6 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a14a, roughness: 0.3, metalness: 0.9 });

    const box = (w: number, d: number, h: number, x: number, y: number, z: number, m: THREE.Material, parent: THREE.Object3D) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    // Cylinder with its axis along printer Z.
    const cylZ = (r: number, h: number, x: number, y: number, z: number, m: THREE.Material, parent: THREE.Object3D, seg = 24) => {
      const g = new THREE.CylinderGeometry(r, r, h, seg);
      g.rotateX(Math.PI / 2);
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // Base and Y rails.
    box(440, 330, 26, 0, 0, -59, frame, this.root);
    box(440, 16, 10, 0, -150, -41, accent, this.root);
    for (const x of [-70, 70]) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 320, 16), steel);
      rod.position.set(x, 0, -34);
      this.root.add(rod);
    }

    // Bed (moves in Y).
    box(240, 240, 6, 0, 0, -9, black, this.bed);
    const surface = box(236, 236, 2, 0, 0, -1, new THREE.MeshStandardMaterial({ map: bedTexture(), roughness: 0.7, metalness: 0.2 }), this.bed);
    surface.castShadow = false;
    for (const [x, y] of [[-105, -105], [105, -105], [-105, 105], [105, 105]]) {
      cylZ(7, 6, x, y, -15, accent, this.bed, 16);
    }
    this.root.add(this.bed);

    // Z towers and top bar.
    for (const x of [-195, 195]) box(30, 30, 400, x, 40, 150, frame, this.root);
    box(420, 30, 30, 0, 40, 365, frame, this.root);
    for (const x of [-195, 195]) {
      const lead = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 380, 12), steel);
      lead.rotation.x = Math.PI / 2;
      lead.position.set(x + (x < 0 ? 26 : -26), 40, 150);
      this.root.add(lead);
    }

    // Gantry (moves in Z): X beam and end blocks.
    box(360, 18, 34, 0, 40, 72, frame, this.gantry);
    for (const x of [-195, 195]) box(44, 44, 56, x, 40, 72, accent, this.gantry);
    for (const zz of [60, 84]) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 380, 12), steel);
      rod.rotation.z = Math.PI / 2;
      rod.position.set(0, 26, zz);
      this.gantry.add(rod);
    }
    this.root.add(this.gantry);

    // Carriage + hot end; the nozzle tip is the carriage origin.
    box(56, 14, 70, 0, 22, 62, accent, this.carriage);
    const nozzle = new THREE.ConeGeometry(3.2, 6, 16);
    nozzle.rotateX(-Math.PI / 2);
    const tip = new THREE.Mesh(nozzle, brass);
    tip.position.set(0, 0, 3);
    this.carriage.add(tip);
    cylZ(5.2, 4, 0, 0, 8, brass, this.carriage, 6);
    box(22, 14, 11, 2, 0, 15.5, alu, this.carriage);
    cylZ(1.8, 12, 0, 0, 26, steel, this.carriage, 10);
    for (let i = 0; i < 9; i++) cylZ(11, 1.4, 0, 0, 30 + i * 3.2, alu, this.carriage, 28);
    box(44, 12, 42, 0, -17, 44, black, this.carriage);
    cylZ(15, 1, 0, -23.5, 44, frame, this.carriage, 28).rotation.x = Math.PI / 2;
    box(30, 22, 12, 0, 6, 101, black, this.carriage);

    this.tipGlow = new THREE.Mesh(
      new THREE.SphereGeometry(1.4, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffb070, transparent: true, opacity: 0 }),
    );
    this.carriage.add(this.tipGlow);
    this.nozzleLight.position.set(0, -8, 6);
    this.carriage.add(this.nozzleLight);
    this.gantry.add(this.carriage);

    // Spool on the top bar.
    this.spool.position.set(0, 40, 435);
    const flangeMat = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.5, transparent: true, opacity: 0.85 });
    for (const y of [-27, 27]) {
      const f = new THREE.Mesh(new THREE.CylinderGeometry(55, 55, 3, 48), flangeMat);
      f.position.y = y;
      this.spool.add(f);
    }
    this.spoolCore = new THREE.Mesh(
      new THREE.CylinderGeometry(44, 44, 51, 48),
      new THREE.MeshStandardMaterial({ color: 0xff8c3c, roughness: 0.5 }),
    );
    this.spool.add(this.spoolCore);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 60, 24), frame);
    this.spool.add(hub);
    this.spool.traverse((o) => (o.castShadow = true));
    this.root.add(this.spool);
    box(12, 12, 55, 0, 40, 405, frame, this.root);

    this.feedLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xff8c3c }),
    );
    this.root.add(this.feedLine);

    this.placeHead();
  }

  load(result: SliceResult): void {
    if (this.mesh) {
      this.bed.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh.dispose();
      this.mesh = null;
    }
    this.result = result;

    const geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1);
    geo.rotateZ(Math.PI / 2); // axis along X
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.05 });
    const count = Math.max(1, result.extrudeCount);
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;

    this.instanceOf = new Int32Array(result.moves.length).fill(-1);
    const color = new THREE.Color();
    let n = 0;
    let rgbSum = [0, 0, 0];
    result.moves.forEach((m, i) => {
      if (m.kind === MoveKind.Travel) return;
      this.instanceOf[i] = n;
      this.writeMatrix(mesh, n, m, 1);
      color.setRGB(m.color[0] / 255, m.color[1] / 255, m.color[2] / 255, THREE.SRGBColorSpace);
      mesh.setColorAt(n, color);
      rgbSum = [rgbSum[0] + m.color[0], rgbSum[1] + m.color[1], rgbSum[2] + m.color[2]];
      n++;
    });
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.mesh = mesh;
    this.bed.add(mesh);

    const spoolColor = new THREE.Color().setRGB(
      rgbSum[0] / Math.max(1, n) / 255,
      rgbSum[1] / Math.max(1, n) / 255,
      rgbSum[2] / Math.max(1, n) / 255,
      THREE.SRGBColorSpace,
    );
    (this.spoolCore.material as THREE.MeshStandardMaterial).color.copy(spoolColor);
    (this.feedLine.material as THREE.LineBasicMaterial).color.copy(spoolColor);

    this.totalSeconds = result.extrudeMm / PRINT_SPEED + result.travelMm / TRAVEL_SPEED;
    this.restart();
  }

  restart(): void {
    this.moveIdx = 0;
    this.moveDone = 0;
    this.printSeconds = 0;
    if (this.mesh && this.partial >= 0 && this.result) this.restorePartial();
    this.partial = -1;
    if (this.mesh) this.mesh.count = 0;
    this.nozzle.set(0, 0, PARK_Z);
    this.extruding = false;
    this.placeHead();
    this.emit([]);
  }

  finish(): void {
    if (!this.result || !this.mesh) return;
    if (this.partial >= 0) this.restorePartial();
    this.partial = -1;
    this.moveIdx = this.result.moves.length;
    this.moveDone = 0;
    this.mesh.count = this.result.extrudeCount;
    this.printSeconds = this.totalSeconds;
    this.playing = false;
    this.extruding = false;
    const last = this.result.moves[this.result.moves.length - 1];
    this.nozzle.set(last ? last.x1 : 0, last ? last.y1 : 0, (last ? last.z : 0) + PARK_Z);
    this.placeHead();
    this.emit([]);
  }

  get finished(): boolean {
    return !!this.result && this.moveIdx >= this.result.moves.length;
  }

  resetView(): void {
    this.camera.position.set(470, 400, 800);
    this.controls.target.set(0, 175, 0);
  }

  private writeMatrix(mesh: THREE.InstancedMesh, index: number, m: Move, frac: number): void {
    const r = this.result as SliceResult;
    const dx = m.x1 - m.x0, dy = m.y1 - m.y0;
    const len = Math.hypot(dx, dy) * frac;
    const ang = Math.atan2(dy, dx);
    const ux = Math.cos(ang), uy = Math.sin(ang);
    this.tmpV.set(m.x0 + (ux * len) / 2, m.y0 + (uy * len) / 2, m.z - r.layerHeight / 2);
    this.tmpQ.setFromAxisAngle(this.zAxis, ang);
    this.tmpS.set(Math.max(0.01, len + r.lineWidth * 0.45), r.lineWidth, r.layerHeight * 1.05);
    this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS);
    mesh.setMatrixAt(index, this.tmpM);
  }

  private restorePartial(): void {
    const r = this.result as SliceResult;
    const mesh = this.mesh as THREE.InstancedMesh;
    const moveIndex = this.findMoveForInstance(this.partial);
    if (moveIndex >= 0) this.writeMatrix(mesh, this.partial, r.moves[moveIndex], 1);
    mesh.instanceMatrix.addUpdateRange(this.partial * 16, 16);
    mesh.instanceMatrix.needsUpdate = true;
  }

  private partialMove = -1;
  private findMoveForInstance(inst: number): number {
    if (this.partialMove >= 0 && this.instanceOf[this.partialMove] === inst) return this.partialMove;
    return this.instanceOf.indexOf(inst);
  }

  private tick(): void {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    const newMoves: Move[] = [];
    if (this.playing && this.result && this.mesh && !this.finished) {
      this.advance(dt, newMoves);
      this.emit(newMoves);
    }
    const t = performance.now() / 1000;
    const glow = this.extruding && this.playing ? 1 : 0;
    this.nozzleLight.intensity = glow * (900 + Math.sin(t * 23) * 120);
    (this.tipGlow.material as THREE.MeshBasicMaterial).opacity = glow * 0.85;

    if (this.follow) {
      // The bed slides under the nozzle, so tracking the carriage keeps the nozzle centred.
      this.carriage.getWorldPosition(this.tmpV);
      const delta = this.tmpV.sub(this.controls.target).multiplyScalar(0.06);
      this.controls.target.add(delta);
      this.camera.position.add(delta);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private advance(dt: number, newMoves: Move[]): void {
    const r = this.result as SliceResult;
    const mesh = this.mesh as THREE.InstancedMesh;
    let budget = dt * this.speed; // seconds of simulated printer time
    const prevPartial = this.partial;
    let extruding = false;

    while (budget > 0 && this.moveIdx < r.moves.length) {
      const m = r.moves[this.moveIdx];
      const len = Math.hypot(m.x1 - m.x0, m.y1 - m.y0);
      const v = m.kind === MoveKind.Travel ? TRAVEL_SPEED : PRINT_SPEED;
      const need = (len - this.moveDone) / v;
      if (m.kind !== MoveKind.Travel) extruding = true;
      if (need <= budget) {
        budget -= need;
        this.printSeconds += need;
        this.spoolAngle += m.kind === MoveKind.Travel ? 0 : len * 0.004;
        const inst = this.instanceOf[this.moveIdx];
        if (inst >= 0) {
          if (inst === this.partial) {
            this.writeMatrix(mesh, inst, m, 1);
            this.partial = -1;
          }
          mesh.count = inst + 1;
        }
        newMoves.push(m);
        this.moveIdx++;
        this.moveDone = 0;
        this.nozzle.set(m.x1, m.y1, m.z);
      } else {
        this.moveDone += budget * v;
        this.printSeconds += budget;
        this.spoolAngle += m.kind === MoveKind.Travel ? 0 : budget * v * 0.004;
        budget = 0;
        const f = this.moveDone / len;
        this.nozzle.set(m.x0 + (m.x1 - m.x0) * f, m.y0 + (m.y1 - m.y0) * f, m.z);
        const inst = this.instanceOf[this.moveIdx];
        if (inst >= 0) {
          this.writeMatrix(mesh, inst, m, f);
          this.partial = inst;
          this.partialMove = this.moveIdx;
          mesh.count = inst + 1;
        }
      }
    }

    // Upload only the instances that changed this frame.
    const touched = [prevPartial, this.partial].filter((i) => i >= 0);
    if (touched.length) {
      mesh.instanceMatrix.clearUpdateRanges();
      const lo = Math.min(...touched), hi = Math.max(...touched);
      mesh.instanceMatrix.addUpdateRange(lo * 16, (hi - lo + 1) * 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.extruding = extruding;
    if (this.moveIdx >= r.moves.length) {
      this.playing = false;
      this.extruding = false;
      this.nozzle.z += PARK_Z;
    }
    this.placeHead();
  }

  private placeHead(): void {
    this.bed.position.y = -this.nozzle.y;
    this.gantry.position.z = this.nozzle.z;
    this.carriage.position.x = this.nozzle.x;
    this.spool.rotation.y = -this.spoolAngle;
    const pos = this.feedLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, 0, 40, 380);
    pos.setXYZ(1, this.nozzle.x, 6, this.nozzle.z + 108);
    pos.needsUpdate = true;
  }

  private emit(newMoves: Move[]): void {
    const r = this.result;
    const current = r?.moves[Math.min(this.moveIdx, r.moves.length - 1)];
    this.onStatus({
      layer: current ? current.layer + 1 : 0,
      layerCount: r?.layerCount ?? 0,
      progress: r && r.moves.length ? this.moveIdx / r.moves.length : 0,
      printSeconds: this.printSeconds,
      totalSeconds: this.totalSeconds,
      finished: this.finished,
      playing: this.playing,
      newMoves,
    });
  }
}

function bedTexture(): THREE.CanvasTexture {
  const size = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  const grad = g.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, '#2c2a26');
  grad.addColorStop(1, '#1f1e1b');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  // Textured PEI speckle.
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(210,170,90,${Math.random() * 0.08})`;
    g.fillRect(Math.random() * size, Math.random() * size, 1.5, 1.5);
  }
  g.strokeStyle = 'rgba(230,190,110,0.18)';
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
  g.fillStyle = 'rgba(230,190,110,0.35)';
  g.font = 'bold 18px monospace';
  g.fillText('220 × 220', 16, size - 16);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
