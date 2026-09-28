// The workshop scene: a workbench, lighting, the selected printer, and the print animation.
// Deposited filament is one InstancedMesh parented to the printer's bed; each frame only the
// instance being extruded is re-uploaded.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { ControlAction, PanelState, PrinterRig, PrinterSpec } from './printers';
import { woodTexture } from './printers/surfaces';
import { MoveKind, type Move, type SliceResult } from './slicer';

const PARK_Z = 30;
const AMBIENT = 24;

export type PrintState = PanelState['state'];

export interface PrintStatus {
  state: PrintState;
  layer: number;
  layerCount: number;
  progress: number;
  printSeconds: number;
  totalSeconds: number;
  nozzle: number;
  bed: number;
  chamber: number | null;
  newMoves: Move[];
}

export class PrinterScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private root = new THREE.Group();
  private timer = new THREE.Timer();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  private spec: PrinterSpec | null = null;
  private rig: PrinterRig | null = null;
  private mesh: THREE.InstancedMesh | null = null;
  private result: SliceResult | null = null;
  private instanceOf: Int32Array = new Int32Array(0);
  private moveIdx = 0;
  private moveDone = 0;
  private partial = -1;
  private partialMove = -1;
  private printSeconds = 0;
  private totalSeconds = 0;
  private spoolAngle = 0;
  private nozzle = new THREE.Vector3(0, 0, PARK_Z);
  private extruding = false;
  private temps = { nozzle: AMBIENT, bed: AMBIENT, chamber: AMBIENT };
  private panelClock = 0;
  private hoverKnob = false;
  private downAt: { x: number; y: number } | null = null;

  playing = false;
  speed = 25;
  follow = false;
  light = true;
  fileName = 'no_model.gcode';
  onStatus: (s: PrintStatus) => void = () => {};
  onControl: (a: ControlAction) => void = () => {};

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
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(36, 1, 1, 6000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 80;
    this.controls.maxDistance = 2200;
    this.controls.autoRotateSpeed = 0.9;

    this.scene.background = new THREE.Color(0x15171a);
    this.scene.fog = new THREE.Fog(0x15171a, 1800, 4200);
    this.buildWorkshop();

    this.root.rotation.x = -Math.PI / 2;
    this.scene.add(this.root);

    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  private buildWorkshop(): void {
    this.scene.add(new THREE.HemisphereLight(0xe4ecff, 0x3a2c20, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(520, 1300, 760);
    sun.target.position.set(0, 200, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -700, right: 700, top: 800, bottom: -600, near: 100, far: 3200 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    this.scene.add(sun, sun.target);
    const rim = new THREE.DirectionalLight(0x9fbcff, 0.7);
    rim.position.set(-900, 500, -700);
    this.scene.add(rim);

    const wood = woodTexture();
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(1700, 44, 1100),
      new THREE.MeshStandardMaterial({ map: wood, roughness: 0.7, metalness: 0 }),
    );
    top.position.set(0, -22, 60);
    top.receiveShadow = true;
    this.scene.add(top);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.5, metalness: 0.6 });
    for (const x of [-800, 800]) for (const z of [-460, 580]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(50, 760, 50), legMat);
      leg.position.set(x, -424, z);
      this.scene.add(leg);
    }
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshStandardMaterial({ color: 0x1a1c1f, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -804;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(5000, 2600), new THREE.MeshStandardMaterial({ map: pegboard(), roughness: 0.9 }));
    wall.position.set(0, 400, -560);
    wall.receiveShadow = true;
    this.scene.add(wall);
  }

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------- Printer lifecycle ----------

  get printer(): PrinterSpec | null {
    return this.spec;
  }

  setPrinter(spec: PrinterSpec): void {
    this.clearPrint();
    if (this.rig) {
      this.root.remove(this.rig.root);
      this.rig.dispose();
    }
    this.spec = spec;
    this.rig = spec.build();
    this.root.add(this.rig.root);
    this.rig.setLight(this.light);
    this.temps = { nozzle: AMBIENT, bed: AMBIENT, chamber: AMBIENT };
    this.placeHead();
    this.resetView();
  }

  showcase(on: boolean): void {
    this.controls.autoRotate = on && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!on) this.resetView();
  }

  resetView(): void {
    if (!this.spec) return;
    this.camera.position.set(...this.spec.camera.position);
    this.controls.target.set(...this.spec.camera.target);
  }

  setLight(on: boolean): void {
    this.light = on;
    this.rig?.setLight(on);
  }

  clearPrint(): void {
    if (this.mesh) {
      this.mesh.parent?.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh.dispose();
      this.mesh = null;
    }
    this.result = null;
    this.playing = false;
    this.extruding = false;
    this.moveIdx = 0;
    this.moveDone = 0;
    this.partial = -1;
    this.printSeconds = 0;
    this.totalSeconds = 0;
    this.nozzle.set(0, 0, PARK_Z);
    this.fileName = 'no_model.gcode';
    this.placeHead();
  }

  load(result: SliceResult): void {
    if (!this.rig || !this.spec) return;
    this.clearPrint();
    this.result = result;

    const geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1);
    geo.rotateZ(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.02 });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, result.extrudeCount));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;

    this.instanceOf = new Int32Array(result.moves.length).fill(-1);
    const color = new THREE.Color();
    const sum = [0, 0, 0];
    let n = 0;
    result.moves.forEach((m, i) => {
      if (m.kind === MoveKind.Travel) return;
      this.instanceOf[i] = n;
      this.writeMatrix(mesh, n, m, 1);
      color.setRGB(m.color[0] / 255, m.color[1] / 255, m.color[2] / 255, THREE.SRGBColorSpace);
      mesh.setColorAt(n, color);
      sum[0] += m.color[0];
      sum[1] += m.color[1];
      sum[2] += m.color[2];
      n++;
    });
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.mesh = mesh;
    this.rig.printParent.add(mesh);

    const k = Math.max(1, n) * 255;
    this.rig.setFilamentColor(new THREE.Color().setRGB(sum[0] / k, sum[1] / k, sum[2] / k, THREE.SRGBColorSpace));
    this.totalSeconds = result.extrudeMm / this.spec.printSpeed + result.travelMm / this.spec.travelSpeed;
  }

  restart(): void {
    if (this.mesh && this.partial >= 0) this.restorePartial();
    this.partial = -1;
    this.moveIdx = 0;
    this.moveDone = 0;
    this.printSeconds = 0;
    if (this.mesh) this.mesh.count = 0;
    this.nozzle.set(0, 0, PARK_Z);
    this.extruding = false;
    this.placeHead();
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
    this.nozzle.set(0, 0, (last ? last.z : 0) + PARK_Z);
    this.placeHead();
  }

  get hasPrint(): boolean {
    return !!this.result;
  }

  get finished(): boolean {
    return !!this.result && this.moveIdx >= this.result.moves.length;
  }

  get state(): PrintState {
    if (!this.result) return this.spec ? 'idle' : 'idle';
    if (this.finished) return 'done';
    if (this.playing) return 'printing';
    return this.moveIdx > 0 ? 'paused' : 'ready';
  }

  // ---------- Pointer: buttons and knob on the printer ----------

  private bindPointer(): void {
    const el = this.renderer.domElement;
    const hit = (e: PointerEvent | WheelEvent): THREE.Object3D | null => {
      if (!this.rig || !this.rig.buttons.length) return null;
      const r = el.getBoundingClientRect();
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects(this.rig.buttons, true);
      let o: THREE.Object3D | null = hits[0]?.object ?? null;
      while (o && !o.userData.action) o = o.parent;
      return o;
    };
    el.addEventListener('pointermove', (e) => {
      const b = hit(e);
      el.style.cursor = b ? 'pointer' : '';
      el.title = b ? String(b.userData.label ?? '') : '';
      this.hoverKnob = !!b && b === this.rig?.knob;
      this.controls.enableZoom = !this.hoverKnob;
    });
    el.addEventListener('pointerdown', (e) => (this.downAt = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointerup', (e) => {
      const d = this.downAt;
      this.downAt = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
      const b = hit(e);
      if (!b || !this.rig) return;
      this.rig.press(b);
      this.onControl(b.userData.action as ControlAction);
    });
    el.addEventListener(
      'wheel',
      (e) => {
        if (!this.hoverKnob || !this.rig?.knob) return;
        e.preventDefault();
        const dir = e.deltaY < 0 ? 1 : -1;
        const turn = this.rig.knob.userData.turn as ((d: number) => void) | undefined;
        turn?.(dir);
        this.onControl(dir > 0 ? 'faster' : 'slower');
      },
      { passive: false },
    );
  }

  // ---------- Animation ----------

  private writeMatrix(mesh: THREE.InstancedMesh, index: number, m: Move, frac: number): void {
    const r = this.result as SliceResult;
    const dx = m.x1 - m.x0, dy = m.y1 - m.y0;
    const len = Math.hypot(dx, dy) * frac;
    const ang = Math.atan2(dy, dx);
    this.tmpV.set(m.x0 + (Math.cos(ang) * len) / 2, m.y0 + (Math.sin(ang) * len) / 2, m.z - r.layerHeight / 2);
    this.tmpQ.setFromAxisAngle(this.zAxis, ang);
    this.tmpS.set(Math.max(0.01, len + r.lineWidth * 0.45), r.lineWidth, r.layerHeight * 1.05);
    this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS);
    mesh.setMatrixAt(index, this.tmpM);
  }

  private restorePartial(): void {
    const r = this.result as SliceResult;
    const mesh = this.mesh as THREE.InstancedMesh;
    const mi = this.partialMove >= 0 && this.instanceOf[this.partialMove] === this.partial ? this.partialMove : this.instanceOf.indexOf(this.partial);
    if (mi >= 0) this.writeMatrix(mesh, this.partial, r.moves[mi], 1);
    mesh.instanceMatrix.addUpdateRange(this.partial * 16, 16);
    mesh.instanceMatrix.needsUpdate = true;
  }

  private tick(): void {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    const newMoves: Move[] = [];
    if (this.playing && this.result && this.mesh && !this.finished) this.advance(dt, newMoves);
    if (!this.playing) this.extruding = false;
    this.updateTemps(dt);

    if (this.rig && this.spec) {
      this.rig.tick(dt, this.extruding && this.playing, this.playing);
      this.panelClock -= dt;
      if (this.panelClock <= 0) {
        this.panelClock = 0.15;
        this.rig.updatePanel(this.panelState());
      }
    }
    this.emit(newMoves);

    if (this.follow && this.rig) {
      this.tmpV.set(this.nozzle.x, this.nozzle.y, this.nozzle.z);
      this.rig.printParent.localToWorld(this.tmpV);
      const delta = this.tmpV.sub(this.controls.target).multiplyScalar(0.06);
      this.controls.target.add(delta);
      this.camera.position.add(delta);
    }
    this.controls.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  private updateTemps(dt: number): void {
    if (!this.spec) return;
    const s = this.state;
    const heating = s === 'printing' || s === 'paused' || s === 'ready';
    const t = this.spec.temps;
    const approach = (cur: number, target: number, rate: number) => cur + (target - cur) * Math.min(1, dt * rate);
    this.temps.nozzle = approach(this.temps.nozzle, heating ? t.nozzle : AMBIENT, heating ? 1.2 : 0.25);
    this.temps.bed = approach(this.temps.bed, heating || s === 'done' ? t.bed : AMBIENT, 0.5);
    if (t.chamber !== null) this.temps.chamber = approach(this.temps.chamber, heating ? t.chamber : AMBIENT, 0.12);
  }

  private panelState(): PanelState {
    const spec = this.spec as PrinterSpec;
    const r = this.result;
    const cur = r?.moves[Math.min(this.moveIdx, r.moves.length - 1)];
    const heating = this.state !== 'idle' && this.state !== 'done';
    return {
      model: spec.name,
      file: r ? this.fileName : 'no_model.gcode',
      state: this.state,
      layer: this.finished ? r?.layerCount ?? 0 : cur ? cur.layer + 1 : 0,
      layerCount: r?.layerCount ?? 0,
      progress: this.progress,
      nozzle: this.temps.nozzle,
      nozzleTarget: heating ? spec.temps.nozzle : 0,
      bed: this.temps.bed,
      bedTarget: heating ? spec.temps.bed : 0,
      chamber: spec.temps.chamber === null ? null : this.temps.chamber,
      speed: this.speed,
      elapsed: this.printSeconds,
      remaining: Math.max(0, this.totalSeconds - this.printSeconds),
      light: this.light,
    };
  }

  private get progress(): number {
    const r = this.result;
    if (!r || !r.moves.length) return 0;
    return this.finished ? 1 : this.moveIdx / r.moves.length;
  }

  private advance(dt: number, newMoves: Move[]): void {
    const r = this.result as SliceResult;
    const spec = this.spec as PrinterSpec;
    const mesh = this.mesh as THREE.InstancedMesh;
    let budget = dt * this.speed;
    const prevPartial = this.partial;
    let extruding = false;

    while (budget > 0 && this.moveIdx < r.moves.length) {
      const m = r.moves[this.moveIdx];
      const len = Math.hypot(m.x1 - m.x0, m.y1 - m.y0);
      const travel = m.kind === MoveKind.Travel;
      const v = travel ? spec.travelSpeed : spec.printSpeed;
      const need = (len - this.moveDone) / v;
      if (!travel) extruding = true;
      if (need <= budget) {
        budget -= need;
        this.printSeconds += need;
        if (!travel) this.spoolAngle += (len - this.moveDone) * 0.004;
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
        if (!travel) this.spoolAngle += budget * v * 0.004;
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
      this.nozzle.set(0, 0, this.nozzle.z + PARK_Z);
    }
    this.placeHead();
  }

  private placeHead(): void {
    if (!this.rig) return;
    this.rig.setHead(this.nozzle.x, this.nozzle.y, this.nozzle.z);
    this.rig.setSpool(this.spoolAngle);
  }

  private emit(newMoves: Move[]): void {
    const r = this.result;
    const cur = r?.moves[Math.min(this.moveIdx, r.moves.length - 1)];
    this.onStatus({
      state: this.state,
      layer: this.finished ? r?.layerCount ?? 0 : cur ? cur.layer + 1 : 0,
      layerCount: r?.layerCount ?? 0,
      progress: this.progress,
      printSeconds: this.printSeconds,
      totalSeconds: this.totalSeconds,
      nozzle: this.temps.nozzle,
      bed: this.temps.bed,
      chamber: this.spec?.temps.chamber === null ? null : this.temps.chamber,
      newMoves,
    });
  }
}

function pegboard(): THREE.CanvasTexture {
  const s = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#2b2e33';
  g.fillRect(0, 0, s, s);
  g.fillStyle = '#17191c';
  for (let y = 16; y < s; y += 32) for (let x = 16; x < s; x += 32) {
    g.beginPath();
    g.arc(x, y, 4, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(20, 10);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
