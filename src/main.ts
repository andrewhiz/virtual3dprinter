import './style.css';
import { analyzeImage, type Analysis, type Mode, type RGB } from './analyze';
import { DEMOS, renderDemo, type Demo } from './demos';
import { GcodeWriter } from './gcode';
import { buildModel, DEFAULT_MODEL_OPTIONS, type Model } from './model';
import { loadMeshFile, meshExtension } from './meshLoad';
import { buildMeshModel, meshBounds, type MeshData } from './meshModel';
import { drawMeshPreview } from './meshPreview';
import { MESH_SAMPLES, sampleMesh } from './meshSamples';
import { PRINTERS, printerById, type ControlAction, type PrinterSpec } from './printers';
import { diagnostics, quality, rememberSafeMode, reloadInSafeMode } from './printers/quality';
import { PrinterScene, type PrintStatus } from './scene';
import { DEFAULT_SLICE_OPTIONS, slice, type SliceResult } from './slicer';

const MAX_ANALYSIS_PX = 180;
const GCODE_LINES = 14;
const DONE_LINE = '; print complete';
const SPEEDS = [1, 2, 5, 10, 25, 50, 100, 200, 500];
const PRINTER_KEY = 'v3dp.printer';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// Surface unexpected errors instead of leaving a half-built page.
// Only report errors from our own bundle; browsers like Dolphin inject scripts whose errors
// would otherwise show up here.
const ours = (where: string | undefined) => !!where && /\/assets\/[^/]+\.js/.test(where);
window.addEventListener('error', (e) => {
  if (ours(e.filename) || ours((e.error as Error | undefined)?.stack)) toast(`Something went wrong: ${e.message}`);
});
window.addEventListener('unhandledrejection', (e) => {
  const err = e.reason as Error | undefined;
  if (ours(err?.stack)) toast(`Something went wrong: ${String(err?.message ?? e.reason)}`);
});

const scene = new PrinterScene($('viewport'));
if (scene.failure) {
  $('gl-error').hidden = false;
  $('gl-error-detail').textContent = `${scene.failure}\n${diagnostics()}`;
  $('fullview').hidden = true;
}
scene.onContextLost = () => {
  // A lost context usually means the GPU driver hit trouble; start the next attempt in safe mode.
  rememberSafeMode();
  $('gl-lost').hidden = false;
  $('gl-lost-detail').textContent = diagnostics();
};
scene.onContextRestored = () => {
  $('gl-lost').hidden = true;
  scene.setPrinter(selected);
  scene.showcase(step === 'pick');
  if (step === 'work') rebuild();
};
$('gl-restore').addEventListener('click', reloadInSafeMode);
$('gl-safe').addEventListener('click', reloadInSafeMode);
$('gl-safe').hidden = quality.safe;

let step: 'pick' | 'work' = 'pick';
let selected: PrinterSpec = printerById(readStored()) ?? PRINTERS[0];
let analysis: Analysis | null = null;
let analysisCanvas: HTMLCanvasElement | null = null;
/** A 3D model file or 3D sample; when set it replaces the photo pipeline. */
let meshData: MeshData | null = null;
let upAxis: 'z' | 'y' = 'z';
let modeChoice: Mode | 'auto' = 'auto';
/** True while the build mode was chosen by a sample rather than by the user. */
let modeFromSample = false;
let colorMode: 'photo' | 'filament' = 'photo';
let gcode = new GcodeWriter(DEFAULT_SLICE_OPTIONS.lineWidth, DEFAULT_SLICE_OPTIONS.layerHeight);
let gcodeLines: string[] = [];

function readStored(): string | null {
  try {
    return localStorage.getItem(PRINTER_KEY);
  } catch {
    return null;
  }
}

// ---------- Step 1: printer picker ----------

const cards = $('printers');
for (const p of PRINTERS) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'printer-card';
  card.dataset.id = p.id;
  card.setAttribute('role', 'radio');
  card.style.setProperty('--card-accent', p.accent);
  card.innerHTML = `
    <span class="pc-head"><span class="pc-name"></span><span class="pc-cat"></span></span>
    <span class="pc-blurb"></span>
    <dl class="pc-specs"></dl>`;
  (card.querySelector('.pc-name') as HTMLElement).textContent = p.name;
  (card.querySelector('.pc-cat') as HTMLElement).textContent = p.category;
  (card.querySelector('.pc-blurb') as HTMLElement).textContent = p.blurb;
  const dl = card.querySelector('.pc-specs') as HTMLElement;
  for (const [k, v] of p.specs) {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = k;
    dd.textContent = v;
    row.append(dt, dd);
    dl.appendChild(row);
  }
  card.addEventListener('click', () => previewPrinter(p));
  cards.appendChild(card);
}

function previewPrinter(p: PrinterSpec): void {
  const changed = p.id !== scene.printer?.id;
  selected = p;
  cards.querySelectorAll<HTMLButtonElement>('.printer-card').forEach((c) => {
    const on = c.dataset.id === p.id;
    c.classList.toggle('on', on);
    c.setAttribute('aria-checked', String(on));
  });
  $('continue').textContent = `Continue with ${p.name}`;
  document.documentElement.style.setProperty('--hot', p.accent);
  if (changed) {
    scene.setPrinter(p);
    scene.showcase(true);
  }
}

$('continue').addEventListener('click', () => {
  try {
    localStorage.setItem(PRINTER_KEY, selected.id);
  } catch {
    // Remembering the printer is only a convenience.
  }
  step = 'work';
  const size = $<HTMLInputElement>('size');
  size.max = String(selected.maxHeight);
  if (Number(size.value) > selected.maxHeight) size.value = String(selected.maxHeight);
  size.dispatchEvent(new Event('input'));
  $('cur-printer').textContent = selected.name;
  scene.showcase(false);
  showStep();
  loadDemo(DEMOS[0]);
});

$('change').addEventListener('click', () => {
  resetSession();
  step = 'pick';
  scene.showcase(true);
  showStep();
});

function showStep(): void {
  const pick = step === 'pick';
  document.body.dataset.step = step;
  $('pick').hidden = !pick;
  $('work').hidden = pick;
  const noView = !!scene.failure;
  $('transport').hidden = pick || noView;
  $('gcode').hidden = pick || noView;
  $('hud').hidden = pick || noView;
  $('step-1').classList.toggle('on', pick);
  $('step-2').classList.toggle('on', !pick);
  $('step-1').setAttribute('aria-current', pick ? 'step' : 'false');
  $('step-2').setAttribute('aria-current', pick ? 'false' : 'step');
  syncEmpty();
  syncPlay();
}

/** Forget the photo and the print; the printer build and GPU buffers are rebuilt on switch. */
function resetSession(): void {
  analysis = null;
  analysisCanvas = null;
  meshData = null;
  scene.clearPrint();
  setActiveSample(null);
  const cv = $<HTMLCanvasElement>('preview');
  (cv.getContext('2d') as CanvasRenderingContext2D).clearRect(0, 0, cv.width, cv.height);
  for (const id of ['r-shape', 'r-sym', 'r-method', 'r-color', 's-layers', 's-moves', 's-fil', 's-time']) $(id).textContent = '–';
  $('r-swatch').style.background = 'transparent';
  gcodeLines = [];
  $('gcode').textContent = '';
}

function syncEmpty(): void {
  $('empty').hidden = !(step === 'work' && !scene.hasPrint && !scene.failure);
}

// ---------- Full view ----------

function setFullView(on: boolean): void {
  document.body.classList.toggle('immersive', on);
  $('fullview').hidden = on;
  $('closefull').hidden = !on;
  if (!on) $('fullview').focus();
}
$('fullview').addEventListener('click', () => setFullView(true));
$('closefull').addEventListener('click', () => setFullView(false));
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('immersive')) setFullView(false);
});

// ---------- Step 2: inputs ----------

function setSegmented(groupId: string, attr: string, value: string): void {
  $(groupId)
    .querySelectorAll<HTMLButtonElement>('button')
    .forEach((b) => {
      const on = b.dataset[attr] === value;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
}

$('mode').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b?.dataset.mode) return;
  modeChoice = b.dataset.mode as Mode | 'auto';
  modeFromSample = false;
  setSegmented('mode', 'mode', modeChoice);
  scheduleRebuild();
});

$('colormode').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b?.dataset.color) return;
  colorMode = b.dataset.color as 'photo' | 'filament';
  setSegmented('colormode', 'color', colorMode);
  $('filament').hidden = colorMode !== 'filament';
  scheduleRebuild();
});

const sliders: [string, string, (v: number) => string][] = [
  ['size', 'size-out', (v) => `${v} mm`],
  ['lh', 'lh-out', (v) => `${v.toFixed(1)} mm`],
  ['infill', 'infill-out', (v) => `${v}%`],
];
for (const [id, out, fmt] of sliders) {
  const input = $<HTMLInputElement>(id);
  const show = () => ($(out).textContent = fmt(Number(input.value)));
  show();
  input.addEventListener('input', () => {
    show();
    scheduleRebuild();
  });
}
$('filament').addEventListener('input', scheduleRebuild);

$('upaxis').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b?.dataset.axis) return;
  upAxis = b.dataset.axis as 'z' | 'y';
  setSegmented('upaxis', 'axis', upAxis);
  if (meshData) drawMeshReadout(meshData);
  scheduleRebuild();
});

const speedInput = $<HTMLInputElement>('speed');
function setSpeed(v: number): void {
  scene.speed = Math.max(1, Math.min(500, Math.round(v)));
  speedInput.value = String((Math.log10(scene.speed) / Math.log10(500)) * 100);
  $('speed-out').textContent = `${scene.speed}×`;
}
speedInput.addEventListener('input', () => {
  scene.speed = Math.max(1, Math.round(10 ** ((Number(speedInput.value) / 100) * Math.log10(500))));
  $('speed-out').textContent = `${scene.speed}×`;
});
setSpeed(25);

function control(action: ControlAction): void {
  switch (action) {
    case 'toggle':
      if (!scene.hasPrint) return;
      if (scene.finished) restartPrint();
      scene.playing = !scene.playing;
      break;
    case 'restart':
      if (!scene.hasPrint) return;
      restartPrint();
      scene.playing = true;
      break;
    case 'finish':
      scene.finish();
      break;
    case 'faster':
      setSpeed(SPEEDS.find((s) => s > scene.speed) ?? 500);
      break;
    case 'slower':
      setSpeed([...SPEEDS].reverse().find((s) => s < scene.speed) ?? 1);
      break;
    case 'light':
      scene.setLight(!scene.light);
      $<HTMLInputElement>('light').checked = scene.light;
      break;
  }
  syncPlay();
}
scene.onControl = control;

$('play').addEventListener('click', () => control('toggle'));
$('restart').addEventListener('click', () => control('restart'));
$('finish').addEventListener('click', () => control('finish'));
$<HTMLInputElement>('light').addEventListener('change', (e) => scene.setLight((e.target as HTMLInputElement).checked));
$<HTMLInputElement>('follow').addEventListener('change', (e) => {
  scene.follow = (e.target as HTMLInputElement).checked;
});
$('view').addEventListener('click', () => {
  scene.follow = false;
  $<HTMLInputElement>('follow').checked = false;
  scene.resetView();
});

function syncPlay(): void {
  const btn = $<HTMLButtonElement>('play');
  const label = scene.playing ? 'Pause' : scene.finished ? 'Print again' : scene.hasPrint && scene.state === 'paused' ? 'Resume' : 'Start';
  btn.textContent = label;
  btn.setAttribute('aria-label', label);
  for (const id of ['play', 'restart', 'finish']) $<HTMLButtonElement>(id).disabled = !scene.hasPrint;
}

// ---------- Image loading ----------

const fileInput = $<HTMLInputElement>('file');
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) void loadFile(f);
  fileInput.value = '';
});

const drop = $('drop');
for (const target of [drop, $('viewport')]) {
  target.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (step === 'work') drop.classList.add('over');
  });
  target.addEventListener('dragleave', () => drop.classList.remove('over'));
  target.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const f = e.dataTransfer?.files?.[0];
    if (f && step === 'work') void loadFile(f);
  });
}
window.addEventListener('paste', (e) => {
  if (step !== 'work') return;
  const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
  const f = item?.getAsFile();
  if (f) void loadFile(f);
});

async function loadFile(file: File): Promise<void> {
  if (meshExtension(file.name)) {
    busy(`Reading ${file.name}…`);
    try {
      const mesh = await loadMeshFile(file);
      setActiveSample(null);
      loadMesh(mesh);
    } catch (err) {
      busy(null);
      toast(err instanceof Error ? err.message : `Couldn't read ${file.name}.`);
    }
    return;
  }
  if (!file.type.startsWith('image/')) {
    toast(`${file.name} isn't a supported file. Use STL, OBJ, 3MF, PLY or a PNG/JPG photo.`);
    return;
  }
  try {
    const bmp = await createImageBitmap(file);
    setMode('auto');
    modeFromSample = false;
    loadSource(bmp, bmp.width, bmp.height, file.name.replace(/\.[^.]+$/, ''));
    bmp.close();
    setActiveSample(null);
  } catch {
    toast(`Couldn't read ${file.name}. Try saving it as PNG or JPG.`);
  }
}

let sourceName = 'model';
function loadSource(src: CanvasImageSource, w: number, h: number, name: string, wholeImage = false): void {
  const scale = Math.min(1, MAX_ANALYSIS_PX / Math.max(w, h));
  const cw = Math.max(8, Math.round(w * scale));
  const ch = Math.max(8, Math.round(h * scale));
  const cv = document.createElement('canvas');
  cv.width = cw;
  cv.height = ch;
  const g = cv.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  g.drawImage(src, 0, 0, cw, ch);
  analysisCanvas = cv;
  meshData = null;
  setSource('photo');
  analysis = analyzeImage(g.getImageData(0, 0, cw, ch), { wholeImage });
  sourceName = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'model';
  drawPreview();
  rebuild();
}

const samples = $('samples');
for (const demo of DEMOS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sample';
  b.dataset.demo = demo.id;
  b.setAttribute('role', 'radio');
  const img = document.createElement('img');
  img.src = renderDemo(demo, 120).toDataURL();
  img.alt = '';
  const label = document.createElement('span');
  label.textContent = demo.label;
  b.append(img, label);
  b.addEventListener('click', () => loadDemo(demo));
  samples.appendChild(b);
}
for (const ms of MESH_SAMPLES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sample';
  b.dataset.demo = ms.id;
  b.setAttribute('role', 'radio');
  const thumb = document.createElement('canvas');
  thumb.width = thumb.height = 120;
  drawMeshPreview(thumb, ms.build(), 'z', ms.color, '#f0f1f3');
  const img = document.createElement('img');
  img.src = thumb.toDataURL();
  img.alt = '';
  const label = document.createElement('span');
  label.textContent = ms.label;
  const badge = document.createElement('i');
  badge.className = 'badge';
  badge.textContent = '3D';
  b.append(img, label, badge);
  b.addEventListener('click', () => {
    loadMesh(sampleMesh(ms));
    setActiveSample(ms.id);
  });
  samples.appendChild(b);
}

function setSource(kind: 'photo' | 'mesh'): void {
  document.body.dataset.source = kind;
  $('r-sym-label').textContent = kind === 'mesh' ? 'Triangles' : 'Symmetry';
  $('r-method-label').textContent = kind === 'mesh' ? 'Printed size' : 'Cut-out';
  $('size-label').textContent = kind === 'mesh' ? 'Longest side' : 'Size';
}

function loadMesh(mesh: MeshData): void {
  meshData = mesh;
  analysis = null;
  analysisCanvas = null;
  setSource('mesh');
  upAxis = mesh.upAxis;
  setSegmented('upaxis', 'axis', upAxis);
  sourceName = mesh.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'model';
  // Start at the file's real size (treated as mm) when it fits, otherwise the largest that does.
  const b = meshBounds(mesh.positions, upAxis);
  const size = $<HTMLInputElement>('size');
  const longest = Math.max(b.x, b.y, b.z);
  size.value = String(Math.round(Math.min(Number(size.max), Math.max(Number(size.min), longest))));
  size.dispatchEvent(new Event('input'));
  window.clearTimeout(rebuildTimer);
  drawMeshReadout(mesh);
  busy('Slicing…');
  window.setTimeout(rebuild, 30);
}

function meshColor(mesh: MeshData): RGB {
  return mesh.color ?? selected.accent.match(/[0-9a-f]{2}/gi)!.map((h) => parseInt(h, 16)) as RGB;
}

function drawMeshReadout(mesh: MeshData): void {
  const color = meshColor(mesh);
  drawMeshPreview($<HTMLCanvasElement>('preview'), mesh.positions, upAxis, color);
  $('r-shape').textContent = mesh.format === 'Sample' ? '3D model sample' : `3D model (${mesh.format})`;
  $('r-sym').textContent = (mesh.positions.length / 9).toLocaleString();
  $('r-swatch').style.background = hex(color);
  $('r-color').textContent = mesh.color ? hex(color).toUpperCase() : `${hex(color).toUpperCase()} (default)`;
  if (colorMode === 'photo') $<HTMLInputElement>('filament').value = hex(color);
}

function busy(msg: string | null): void {
  $('busy').hidden = msg === null;
  if (msg) $('busy').textContent = msg;
}

function loadDemo(demo: Demo): void {
  setMode(demo.mode ?? 'auto');
  modeFromSample = !!demo.mode;
  const cv = renderDemo(demo);
  loadSource(cv, cv.width, cv.height, demo.id, demo.mode === 'relief');
  setActiveSample(demo.id);
}

function setMode(mode: Mode | 'auto'): void {
  modeChoice = mode;
  setSegmented('mode', 'mode', modeChoice);
}

function setActiveSample(id: string | null): void {
  samples.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    const on = b.dataset.demo === id;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
}

// ---------- Analysis readout ----------

const hex = (c: RGB) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

function drawPreview(): void {
  const a = analysis;
  const src = analysisCanvas;
  if (!a || !src) return;
  const cv = $<HTMLCanvasElement>('preview');
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  const S = cv.width;
  g.clearRect(0, 0, S, S);
  const scale = Math.min(S / src.width, S / src.height);
  const dw = src.width * scale, dh = src.height * scale;
  const ox = (S - dw) / 2, oy = (S - dh) / 2;
  g.imageSmoothingEnabled = true;
  g.drawImage(src, ox, oy, dw, dh);

  const w = src.width, h = src.height;
  const over = document.createElement('canvas');
  over.width = w;
  over.height = h;
  const og = over.getContext('2d') as CanvasRenderingContext2D;
  const img = og.createImageData(w, h);
  const m = a.sourceMask;
  const accent = selected.accent;
  const ar = parseInt(accent.slice(1, 3), 16), ag = parseInt(accent.slice(3, 5), 16), ab = parseInt(accent.slice(5, 7), 16);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const edge = m[i] && (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !m[i - 1] || !m[i + 1] || !m[i - w] || !m[i + w]);
      const p = i * 4;
      if (edge) img.data.set([ar, ag, ab, 255], p);
      else if (!m[i]) img.data.set([14, 16, 18, 190], p);
    }
  }
  og.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = false;
  g.drawImage(over, ox, oy, dw, dh);

  $('r-sym').textContent = `${Math.round(a.symmetry * 100)}%`;
  $('r-method').textContent =
    a.method === 'alpha' ? 'Transparent background' : a.method === 'background' ? 'Background colour removed' : 'Whole photo (no clear outline)';
  $('r-swatch').style.background = hex(a.dominant);
  $('r-color').textContent = hex(a.dominant).toUpperCase();
  if (colorMode === 'photo') $<HTMLInputElement>('filament').value = hex(a.dominant);
}

const MODE_TEXT: Record<Mode, string> = {
  revolve: 'Round and symmetric: revolved',
  standee: 'Flat outline: standee',
  relief: 'No clear outline: relief plaque',
};

// ---------- Slice & print ----------

let rebuildTimer = 0;
function scheduleRebuild(): void {
  window.clearTimeout(rebuildTimer);
  rebuildTimer = window.setTimeout(rebuild, 220);
}

function rebuild(): void {
  busy(null);
  if ((!analysis && !meshData) || step !== 'work') return;
  const sizeMm = Number($<HTMLInputElement>('size').value);
  let model: Model;
  if (meshData) {
    try {
      model = buildMeshModel(meshData, {
        sizeMm,
        maxFootprintMm: selected.maxFootprint,
        maxHeightMm: selected.maxHeight,
        upAxis,
        color: meshColor(meshData),
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That model could not be sliced.');
      return;
    }
    $('r-method').textContent = `${model.sizeX.toFixed(0)} × ${model.sizeY.toFixed(0)} × ${model.sizeZ.toFixed(0)} mm`;
  } else {
    const a = analysis as Analysis;
    const mode: Mode = modeChoice === 'auto' ? a.suggestedMode : modeChoice;
    $('r-shape').textContent =
      modeChoice === 'auto' ? MODE_TEXT[mode] : modeFromSample ? 'Scenic photo: relief plaque' : `${mode[0].toUpperCase()}${mode.slice(1)} (your pick)`;
    model = buildModel(a, { ...DEFAULT_MODEL_OPTIONS, mode, sizeMm, maxFootprintMm: selected.maxFootprint });
  }
  const hexColor = $<HTMLInputElement>('filament').value;
  const filamentColor: RGB = [1, 3, 5].map((i) => parseInt(hexColor.slice(i, i + 2), 16)) as RGB;
  const opts = {
    ...DEFAULT_SLICE_OPTIONS,
    layerHeight: Number($<HTMLInputElement>('lh').value),
    infillDensity: Number($<HTMLInputElement>('infill').value) / 100,
    colorMode,
    filamentColor,
  };
  const result = slice(model, opts);
  gcode = new GcodeWriter(opts.lineWidth, opts.layerHeight);
  showStats(result);
  scene.load(result);
  scene.fileName = `${sourceName}.gcode`;
  restartPrint();
  scene.playing = true;
  syncPlay();
  syncEmpty();
}

function restartPrint(): void {
  gcode.reset();
  gcodeLines = gcode.header();
  $('gcode').textContent = gcodeLines.join('\n');
  scene.restart();
}

function showStats(r: SliceResult): void {
  const filamentM = (r.extrudeMm * r.lineWidth * r.layerHeight) / (Math.PI * 0.875 * 0.875) / 1000;
  $('s-layers').textContent = r.layerCount.toLocaleString();
  $('s-moves').textContent = r.moves.length.toLocaleString();
  $('s-fil').textContent = `${filamentM.toFixed(1)} m`;
  $('s-time').textContent = clock(r.extrudeMm / selected.printSpeed + r.travelMm / selected.travelSpeed);
}

function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

let lastHud = 0;
let lastState = '';
scene.onStatus = (s: PrintStatus) => {
  for (const m of s.newMoves) gcodeLines.push(...gcode.lines(m));
  if (s.state === 'done' && gcodeLines.length && gcodeLines[gcodeLines.length - 1] !== DONE_LINE) {
    gcodeLines.push('G91', 'G1 Z20 ; park', 'M104 S0', 'M140 S0', DONE_LINE);
  }
  if (gcodeLines.length > GCODE_LINES * 4) gcodeLines = gcodeLines.slice(-GCODE_LINES);
  if (s.state !== lastState) {
    lastState = s.state;
    syncPlay();
  }

  const now = performance.now();
  if (now - lastHud < 80) return;
  lastHud = now;
  $('h-noz').textContent = String(Math.round(s.nozzle));
  $('h-bed').textContent = String(Math.round(s.bed));
  $('h-chamber-wrap').hidden = s.chamber === null;
  if (s.chamber !== null) $('h-chamber').textContent = String(Math.round(s.chamber));
  $('h-layer').textContent = String(s.layer);
  $('h-layers').textContent = String(s.layerCount);
  $('h-time').textContent = `${clock(s.printSeconds)} / ${clock(s.totalSeconds)}`;
  $('h-bar').style.width = `${s.progress * 100}%`;
  if (step === 'work') $('gcode').textContent = gcodeLines.slice(-GCODE_LINES).join('\n');
};

let toastTimer = 0;
function toast(msg: string): void {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), 4200);
}

// ---------- Boot ----------

setSegmented('mode', 'mode', modeChoice);
setSegmented('colormode', 'color', colorMode);
setSegmented('upaxis', 'axis', upAxis);
setSource('photo');
$('filament').hidden = true;
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setSpeed(100);
previewPrinter(selected);
showStep();
