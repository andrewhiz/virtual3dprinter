// The workshop scene: a workbench, lighting, the selected printer, and the print animation.
// Deposited filament is one InstancedMesh parented to the printer's bed; each frame only the
// instance being extruded is re-uploaded. Timing and nozzle position come from playback.ts.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { ControlAction, PanelState, PrinterRig, PrinterSpec } from './printers';
import { quality } from './printers/quality';
import { woodTexture } from './printers/surfaces';
import { KIND_COLORS, speedColor, type ViewMode } from './palette';
import { Playhead } from './playback';
import {
  extrusionFeedRange,
  extrusionsBefore,
  isExtrusion,
  layerStarts,
  MoveKind,
  segmentTransform,
  type TimelineEvent,
  type Toolpath,
} from './toolpath';

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
  /** Moves from..to-1 finished since the last status. */
  from: number;
  to: number;
}

export class PrinterScene {
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private root = new THREE.Group();
  private timer = new THREE.Timer();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  private spec: PrinterSpec | null = null;
  private rig: PrinterRig | null = null;
  private mesh: THREE.InstancedMesh | null = null;
  private path: Toolpath | null = null;
  private playhead: Playhead | null = null;
  /** Instance index of each move's filament segment: extrusionsBefore[i]. */
  private before: Uint32Array = new Uint32Array(1);
  /** starts[k] = first move of layer k (length layerCount + 1). */
  private starts: Uint32Array = new Uint32Array(1);
  /** Travel and wipe moves as thin lines, revealed as the print reaches them. */
  private travel: THREE.LineSegments | null = null;
  /** Instances on layers below this are collapsed ("this layer only"); -1 shows all. */
  private minLayer = { value: -1 };
  /** The instance drawn part-way, and its move. */
  private partial = -1;
  private partialMove = -1;
  private spoolAngle = 0;
  private nozzle = new THREE.Vector3(0, 0, PARK_Z);
  private extruding = false;
  private temps = { nozzle: AMBIENT, bed: AMBIENT, chamber: AMBIENT };
  private panelClock = 0;
  private hoverKnob = false;
  private downAt: { x: number; y: number } | null = null;
  private userMoved = false;

  playing = false;
  speed = 25;
  /** What the filament colours show. */
  viewMode: ViewMode = 'filament';
  showTravel = false;
  layerOnly = false;
  follow = false;
  light = true;
  fileName = 'no_model.gcode';
  onStatus: (s: PrintStatus) => void = () => {};
  onControl: (a: ControlAction) => void = () => {};
  onEvent: (e: TimelineEvent) => void = () => {};
  onContextLost: () => void = () => {};
  onContextRestored: () => void = () => {};

  /** Set when the browser could not start WebGL; the scene then does nothing. */
  readonly failure: string | null = null;

  /** Ask the browser for the 3D context back after it was dropped. */
  restoreContext(): void {
    if (this.failure) return;
    this.renderer.forceContextRestore();
  }

  private tmpM = new THREE.Matrix4();
  private tmpT = new Float64Array(12);
  private tmpV = new THREE.Vector3();

  constructor(private container: HTMLElement) {
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: !quality.lowPower });
    } catch (err) {
      (this as { failure: string | null }).failure = err instanceof Error ? err.message : String(err);
      return;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.safe ? 1 : quality.lowPower ? 1.5 : 2));
    this.renderer.shadowMap.enabled = !quality.safe;
    this.renderer.shadowMap.type = quality.lowPower ? THREE.BasicShadowMap : THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);
    // Browsers drop the WebGL context under memory pressure (common on phones); without this
    // the canvas just stays black.
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.onContextLost();
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => this.onContextRestored());

    // The reflection-map pass renders to half-float cube targets, which some mobile drivers crash on.
    if (!quality.lowPower) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = 0.55;
      pmrem.dispose();
    }

    this.camera = new THREE.PerspectiveCamera(36, 1, 1, 6000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 80;
    this.controls.maxDistance = 2200;
    this.controls.autoRotateSpeed = 0.9;
    this.controls.addEventListener('start', () => (this.userMoved = true));

    this.scene.background = new THREE.Color(0x15171a);
    this.scene.fog = new THREE.Fog(0x15171a, 3200, 7000);
    this.buildWorkshop();

    this.root.rotation.x = -Math.PI / 2;
    this.scene.add(this.root);

    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  private buildWorkshop(): void {
    this.scene.add(new THREE.HemisphereLight(0xe4ecff, 0x3a2c20, quality.lowPower ? 1.6 : 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(520, 1300, 760);
    sun.target.position.set(0, 200, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.setScalar(quality.lowPower ? 1024 : 2048);
    Object.assign(sun.shadow.camera, { left: -700, right: 700, top: 800, bottom: -600, near: 100, far: 3200 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    this.scene.add(sun, sun.target);
    if (!quality.lowPower) {
      const rim = new THREE.DirectionalLight(0x9fbcff, 0.7);
      rim.position.set(-900, 500, -700);
      this.scene.add(rim);
    }

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
    if (this.failure) return;
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.userMoved) this.resetView();
  }

  // ---------- Printer lifecycle ----------

  get printer(): PrinterSpec | null {
    return this.spec;
  }

  setPrinter(spec: PrinterSpec): void {
    if (this.failure) {
      this.spec = spec;
      return;
    }
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
    if (this.failure) return;
    this.controls.autoRotate = on && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!on) this.resetView();
  }

  resetView(): void {
    if (!this.spec || this.failure) return;
    this.userMoved = false;
    this.controls.target.set(...this.spec.camera.target);
    // Back the camera off on tall, narrow screens so the whole printer still fits.
    const fit = this.camera.aspect < 1.25 ? Math.min(2.1, (1.25 / this.camera.aspect) ** 0.75) : 1;
    this.camera.position.set(...this.spec.camera.position).sub(this.controls.target).multiplyScalar(fit).add(this.controls.target);
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
      this.mesh.customDepthMaterial?.dispose();
      this.mesh.dispose();
      this.mesh = null;
    }
    if (this.travel) {
      this.travel.parent?.remove(this.travel);
      this.travel.geometry.dispose();
      (this.travel.material as THREE.Material).dispose();
      this.travel = null;
    }
    this.path = null;
    this.playhead = null;
    this.playing = false;
    this.extruding = false;
    this.partial = -1;
    this.nozzle.set(0, 0, PARK_Z);
    this.fileName = 'no_model.gcode';
    this.placeHead();
  }

  load(path: Toolpath): void {
    if (!this.rig || !this.spec) return;
    this.clearPrint();
    this.path = path;
    this.playhead = new Playhead(path, PARK_Z);
    this.before = extrusionsBefore(path);
    this.starts = layerStarts(path);
    const extrusions = this.before[path.count];

    const geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1);
    geo.rotateZ(Math.PI / 2);
    const layerOf = new Float32Array(Math.max(1, extrusions));
    geo.setAttribute('aLayer', new THREE.InstancedBufferAttribute(layerOf, 1));
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.02 });
    addLayerFilter(mat, this.minLayer);
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, extrusions));
    // Shadows must hide the same layers, so the shadow pass gets the same filter.
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    addLayerFilter(depth, this.minLayer);
    mesh.customDepthMaterial = depth;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;

    const sum = [0, 0, 0];
    const travel: number[] = [];
    for (let i = 0; i < path.count; i++) {
      if (!isExtrusion(path.kind[i])) {
        travel.push(path.x0[i], path.y0[i], path.z0[i], path.x1[i], path.y1[i], path.z1[i]);
        continue;
      }
      const n = this.before[i];
      this.writeMatrix(mesh, n, i, 1);
      layerOf[n] = path.layer[i];
      const c = path.color[i];
      sum[0] += (c >> 16) & 255;
      sum[1] += (c >> 8) & 255;
      sum[2] += c & 255;
    }
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceMatrix.needsUpdate = true;
    this.mesh = mesh;
    this.recolor();
    this.rig.printParent.add(mesh);

    const tgeo = new THREE.BufferGeometry();
    tgeo.setAttribute('position', new THREE.Float32BufferAttribute(travel, 3));
    const tmat = new THREE.LineBasicMaterial({ color: KIND_COLORS[MoveKind.Travel], transparent: true, opacity: 0.6, depthWrite: false });
    this.travel = new THREE.LineSegments(tgeo, tmat);
    this.travel.frustumCulled = false;
    this.travel.visible = this.showTravel;
    this.rig.printParent.add(this.travel);
    this.updateFilters();

    const k = Math.max(1, extrusions) * 255;
    this.rig.setFilamentColor(new THREE.Color().setRGB(sum[0] / k, sum[1] / k, sum[2] / k, THREE.SRGBColorSpace));
  }

  /** Colour the filament by its own colour, by line type or by speed. */
  setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
    this.recolor();
  }

  setTravelVisible(on: boolean): void {
    this.showTravel = on;
    if (this.travel) this.travel.visible = on;
  }

  setLayerOnly(on: boolean): void {
    this.layerOnly = on;
    this.updateFilters();
  }

  get layerCount(): number {
    return this.path?.layerCount ?? 0;
  }

  /** Show layers 1..n complete and nothing above (n is 1-based, like the HUD). */
  seekLayer(n: number): void {
    if (!this.path) return;
    this.seek(this.starts[Math.max(0, Math.min(this.path.layerCount, Math.round(n)))]);
  }

  /** Jump to a fraction 0..1 of the way through the moves. */
  seekFraction(f: number): void {
    if (!this.path) return;
    this.seek(Math.round(Math.max(0, Math.min(1, f)) * this.path.count));
  }

  /**
   * 1-based layer the print has reached: the one in progress, or the last one finished (so a
   * jump to "layer 40" reads 40). 0 before a print, layerCount once finished.
   */
  get shownLayer(): number {
    const p = this.path, ph = this.playhead;
    if (!p || !ph || !p.count) return 0;
    if (ph.finished) return p.layerCount;
    if (ph.done > 0 || ph.index === 0) return p.layer[ph.index] + 1;
    return p.layer[ph.index - 1] + 1;
  }

  private recolor(): void {
    const p = this.path, mesh = this.mesh;
    if (!p || !mesh) return;
    const [lo, hi] = extrusionFeedRange(p);
    const color = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      if (!isExtrusion(p.kind[i])) continue;
      const c =
        this.viewMode === 'type'
          ? KIND_COLORS[p.kind[i] as MoveKind]
          : this.viewMode === 'speed'
            ? speedColor(hi > lo ? (p.feed[i] - lo) / (hi - lo) : 0.5)
            : p.color[i];
      color.setRGB(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255, THREE.SRGBColorSpace);
      mesh.setColorAt(this.before[i], color);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /** "This layer only" cut-off, and how many travel lines to draw. */
  private updateFilters(): void {
    const p = this.path, ph = this.playhead;
    if (!p || !ph) return;
    const layer = this.shownLayer - 1;
    this.minLayer.value = this.layerOnly ? layer : -1;
    if (this.travel) {
      const from = this.layerOnly ? this.starts[Math.max(0, layer)] : 0;
      const first = from - this.before[from];
      const upTo = ph.index - this.before[ph.index];
      this.travel.geometry.setDrawRange(first * 2, Math.max(0, upTo - first) * 2);
    }
  }

  restart(): void {
    this.seek(0);
  }

  finish(): void {
    if (!this.path) return;
    this.seek(this.path.count);
    this.playing = false;
  }

  /** Jump to the start of move `index`: everything before it is printed, nothing after. */
  seek(index: number): void {
    const ph = this.playhead, mesh = this.mesh;
    if (!ph || !mesh) return;
    this.restorePartial();
    ph.seek(index);
    mesh.count = this.before[ph.index];
    this.extruding = false;
    this.nozzle.set(ph.head.x, ph.head.y, ph.head.z);
    this.placeHead();
    this.updateFilters();
  }

  get hasPrint(): boolean {
    return !!this.path;
  }

  get finished(): boolean {
    return !!this.playhead?.finished;
  }

  get state(): PrintState {
    const ph = this.playhead;
    if (!ph) return 'idle';
    if (ph.finished) return 'done';
    if (this.playing) return 'printing';
    return ph.index > 0 || ph.done > 0 ? 'paused' : 'ready';
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

  private writeMatrix(mesh: THREE.InstancedMesh, index: number, i: number, frac: number): void {
    const e = segmentTransform(this.path as Toolpath, i, frac, this.tmpT);
    this.tmpM.set(e[0], e[1], e[2], e[3], e[4], e[5], e[6], e[7], e[8], e[9], e[10], e[11], 0, 0, 0, 1);
    mesh.setMatrixAt(index, this.tmpM);
  }

  /** Put the part-drawn instance back to full length. */
  private restorePartial(): void {
    const mesh = this.mesh;
    if (!mesh || this.partial < 0) return;
    this.writeMatrix(mesh, this.partial, this.partialMove, 1);
    mesh.instanceMatrix.addUpdateRange(this.partial * 16, 16);
    mesh.instanceMatrix.needsUpdate = true;
    this.partial = -1;
  }

  private tick(): void {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    let from = 0, to = 0;
    if (this.playing && this.playhead && this.mesh && !this.finished) [from, to] = this.advance(dt);
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
    this.emit(from, to);

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
    const heating = this.state !== 'idle' && this.state !== 'done';
    return {
      model: spec.name,
      file: this.path ? this.fileName : 'no_model.gcode',
      state: this.state,
      layer: this.shownLayer,
      layerCount: this.path?.layerCount ?? 0,
      progress: this.progress,
      nozzle: this.temps.nozzle,
      nozzleTarget: heating ? spec.temps.nozzle : 0,
      bed: this.temps.bed,
      bedTarget: heating ? spec.temps.bed : 0,
      chamber: spec.temps.chamber === null ? null : this.temps.chamber,
      speed: this.speed,
      elapsed: this.playhead?.seconds ?? 0,
      remaining: Math.max(0, (this.playhead?.totalSeconds ?? 0) - (this.playhead?.seconds ?? 0)),
      light: this.light,
    };
  }

  private get progress(): number {
    const p = this.path, ph = this.playhead;
    if (!p || !ph || !p.count) return 0;
    return ph.finished ? 1 : ph.index / p.count;
  }


  /** Run the print for one frame; returns the range of moves finished. */
  private advance(dt: number): [number, number] {
    const ph = this.playhead as Playhead;
    const mesh = this.mesh as THREE.InstancedMesh;
    const prev = this.partial, prevMove = this.partialMove;
    const step = ph.advance(dt * this.speed, (e) => this.onEvent(e));
    this.spoolAngle += step.extrudedMm * 0.004;

    // The move in progress is drawn part-way; one left part-way last frame is now complete.
    let cur = -1;
    if (!ph.finished && ph.done > 0 && isExtrusion(ph.path.kind[ph.index])) {
      cur = this.before[ph.index];
      this.writeMatrix(mesh, cur, ph.index, ph.fraction);
    }
    if (prev >= 0 && (prev !== cur || prevMove !== ph.index)) this.writeMatrix(mesh, prev, prevMove, 1);
    this.partial = cur;
    this.partialMove = ph.index;
    mesh.count = this.before[ph.index] + (cur >= 0 ? 1 : 0);
    // Ranges add up until the next upload (a seek may have queued one), and three.js clears them then.
    const touched = [prev, cur].filter((i) => i >= 0);
    if (touched.length) {
      const lo = Math.min(...touched), hi = Math.max(...touched);
      mesh.instanceMatrix.addUpdateRange(lo * 16, (hi - lo + 1) * 16);
      mesh.instanceMatrix.needsUpdate = true;
    }

    this.extruding = step.extruding;
    if (ph.finished) {
      this.playing = false;
      this.extruding = false;
    }
    this.nozzle.set(ph.head.x, ph.head.y, ph.head.z);
    this.placeHead();
    this.updateFilters();
    return [step.from, step.to];
  }

  private placeHead(): void {
    if (!this.rig) return;
    this.rig.setHead(this.nozzle.x, this.nozzle.y, this.nozzle.z);
    this.rig.setSpool(this.spoolAngle);
  }

  private emit(from: number, to: number): void {
    const ph = this.playhead;
    this.onStatus({
      state: this.state,
      layer: this.shownLayer,
      layerCount: this.path?.layerCount ?? 0,
      progress: this.progress,
      printSeconds: ph?.seconds ?? 0,
      totalSeconds: ph?.totalSeconds ?? 0,
      nozzle: this.temps.nozzle,
      bed: this.temps.bed,
      chamber: this.spec?.temps.chamber === null ? null : this.temps.chamber,
      from,
      to,
    });
  }
}

/**
 * Collapse filament instances below `minLayer.value` to nothing, for "this layer only". Each
 * instance carries its layer in the `aLayer` attribute.
 */
function addLayerFilter(mat: THREE.Material, minLayer: { value: number }): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMinLayer = minLayer;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aLayer;\nuniform float uMinLayer;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nif (aLayer < uMinLayer) transformed = vec3(0.0);');
  };
  mat.customProgramCacheKey = () => 'layer-filter';
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
