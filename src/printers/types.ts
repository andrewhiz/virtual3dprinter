import type * as THREE from 'three';

export type PrinterId = 'slinger' | 'corexy' | 'delta';

export type ControlAction = 'toggle' | 'restart' | 'finish' | 'faster' | 'slower' | 'light';

/** What the printer's own screen shows. */
export interface PanelState {
  model: string;
  file: string;
  state: 'idle' | 'ready' | 'printing' | 'paused' | 'done';
  layer: number;
  layerCount: number;
  progress: number;
  nozzle: number;
  nozzleTarget: number;
  bed: number;
  bedTarget: number;
  chamber: number | null;
  speed: number;
  elapsed: number;
  remaining: number;
  light: boolean;
}

/** A built printer in the scene. Printer space is millimetres, z up, table top at z = 0. */
export interface PrinterRig {
  root: THREE.Group;
  /** Local origin is the centre of the bed surface; printed filament is parented here. */
  printParent: THREE.Object3D;
  /** Clickable controls; each carries userData.action. */
  buttons: THREE.Object3D[];
  /** Knob that also responds to the scroll wheel, if the printer has one. */
  knob: THREE.Object3D | null;
  /** Move the nozzle tip to (x, y, z) in bed coordinates. */
  setHead(x: number, y: number, z: number): void;
  setSpool(angle: number): void;
  setFilamentColor(c: THREE.Color): void;
  setLight(on: boolean): void;
  press(button: THREE.Object3D): void;
  updatePanel(s: PanelState): void;
  tick(dt: number, extruding: boolean, printing: boolean): void;
  dispose(): void;
}

export interface PrinterSpec {
  id: PrinterId;
  name: string;
  category: string;
  blurb: string;
  accent: string;
  specs: [string, string][];
  maxFootprint: number;
  maxHeight: number;
  printSpeed: number;
  travelSpeed: number;
  temps: { nozzle: number; bed: number; chamber: number | null };
  /** World-space camera home (y up). */
  camera: { position: [number, number, number]; target: [number, number, number] };
  build(): PrinterRig;
}
