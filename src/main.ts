import './style.css';
import { analyzeImage, type Analysis, type Mode, type RGB } from './analyze';
import { DEMOS, renderDemo } from './demos';
import { GcodeWriter } from './gcode';
import { buildModel, DEFAULT_MODEL_OPTIONS } from './model';
import { PrinterScene, type PrintStatus } from './printer';
import { DEFAULT_SLICE_OPTIONS, slice, type SliceResult } from './slicer';

const MAX_ANALYSIS_PX = 180;
const GCODE_LINES = 14;
const DONE_LINE = '; print complete';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const scene = new PrinterScene($('viewport'));

let analysis: Analysis | null = null;
let analysisCanvas: HTMLCanvasElement | null = null;
let modeChoice: Mode | 'auto' = 'auto';
let colorMode: 'photo' | 'filament' = 'photo';
let gcode = new GcodeWriter(DEFAULT_SLICE_OPTIONS.lineWidth, DEFAULT_SLICE_OPTIONS.layerHeight);
let gcodeLines: string[] = [];
let nozzleTemp = 24;
let bedTemp = 24;

// ---------- Inputs ----------

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

const speedInput = $<HTMLInputElement>('speed');
const applySpeed = () => {
  const v = Number(speedInput.value) / 100;
  scene.speed = Math.max(1, Math.round(10 ** (v * Math.log10(500))));
  $('speed-out').textContent = `${scene.speed}×`;
};
speedInput.addEventListener('input', applySpeed);
applySpeed();

$('play').addEventListener('click', () => {
  if (scene.finished) restartPrint();
  scene.playing = !scene.playing;
  syncPlay();
});
$('restart').addEventListener('click', () => {
  restartPrint();
  scene.playing = true;
  syncPlay();
});
$('finish').addEventListener('click', () => {
  scene.finish();
  syncPlay();
});
$<HTMLInputElement>('follow').addEventListener('change', (e) => {
  scene.follow = (e.target as HTMLInputElement).checked;
});
$('view').addEventListener('click', () => {
  scene.follow = false;
  $<HTMLInputElement>('follow').checked = false;
  scene.resetView();
});

function syncPlay(): void {
  const btn = $('play');
  const label = scene.playing ? 'Pause' : scene.finished ? 'Print again' : 'Resume';
  btn.textContent = label;
  btn.setAttribute('aria-label', label);
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
    drop.classList.add('over');
  });
  target.addEventListener('dragleave', () => drop.classList.remove('over'));
  target.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const f = e.dataTransfer?.files?.[0];
    if (f) void loadFile(f);
  });
}
window.addEventListener('paste', (e) => {
  const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
  const f = item?.getAsFile();
  if (f) void loadFile(f);
});

async function loadFile(file: File): Promise<void> {
  if (!file.type.startsWith('image/')) {
    toast(`${file.name} isn't an image. Try a PNG, JPG or WebP.`);
    return;
  }
  try {
    const bmp = await createImageBitmap(file);
    loadSource(bmp, bmp.width, bmp.height);
    bmp.close();
    setActiveSample(null);
  } catch {
    toast(`Couldn't read ${file.name}. Try saving it as PNG or JPG.`);
  }
}

function loadSource(src: CanvasImageSource, w: number, h: number): void {
  const scale = Math.min(1, MAX_ANALYSIS_PX / Math.max(w, h));
  const cw = Math.max(8, Math.round(w * scale));
  const ch = Math.max(8, Math.round(h * scale));
  const cv = document.createElement('canvas');
  cv.width = cw;
  cv.height = ch;
  const g = cv.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  g.drawImage(src, 0, 0, cw, ch);
  analysisCanvas = cv;
  analysis = analyzeImage(g.getImageData(0, 0, cw, ch));
  drawPreview();
  rebuild();
}

const samples = $('samples');
for (const demo of DEMOS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = demo.label;
  b.dataset.demo = demo.id;
  b.addEventListener('click', () => {
    const cv = renderDemo(demo);
    loadSource(cv, cv.width, cv.height);
    setActiveSample(demo.id);
  });
  samples.appendChild(b);
}
function setActiveSample(id: string | null): void {
  samples.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.demo === id));
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

  // Dim the background and trace the detected outline.
  const w = src.width, h = src.height;
  const over = document.createElement('canvas');
  over.width = w;
  over.height = h;
  const og = over.getContext('2d') as CanvasRenderingContext2D;
  const img = og.createImageData(w, h);
  const m = a.sourceMask;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const edge = m[i] && (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !m[i - 1] || !m[i + 1] || !m[i - w] || !m[i + w]);
      const p = i * 4;
      if (edge) {
        img.data.set([255, 138, 61, 255], p);
      } else if (!m[i]) {
        img.data.set([14, 16, 18, 190], p);
      }
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
  if (!analysis) return;
  const mode: Mode = modeChoice === 'auto' ? analysis.suggestedMode : modeChoice;
  $('r-shape').textContent = modeChoice === 'auto' ? MODE_TEXT[mode] : `${mode[0].toUpperCase()}${mode.slice(1)} (your pick)`;

  const model = buildModel(analysis, {
    ...DEFAULT_MODEL_OPTIONS,
    mode,
    sizeMm: Number($<HTMLInputElement>('size').value),
  });
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
  restartPrint();
  scene.playing = true;
  syncPlay();
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
  $('s-time').textContent = clock(r.extrudeMm / 60 + r.travelMm / 150);
}

function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

let lastHud = 0;
scene.onStatus = (s: PrintStatus) => {
  for (const m of s.newMoves) gcodeLines.push(...gcode.lines(m));
  if (s.finished && gcodeLines[gcodeLines.length - 1] !== DONE_LINE) {
    gcodeLines.push('G91', 'G1 Z20 ; park', 'M104 S0', 'M140 S0', DONE_LINE);
  }
  if (gcodeLines.length > GCODE_LINES * 4) gcodeLines = gcodeLines.slice(-GCODE_LINES);

  const now = performance.now();
  if (now - lastHud < 60 && s.playing) return;
  lastHud = now;

  const active = s.progress > 0 && !s.finished;
  nozzleTemp += ((active ? 210 : s.finished ? 60 : 24) - nozzleTemp) * 0.15;
  bedTemp += ((active || s.finished ? 60 : 24) - bedTemp) * 0.1;
  $('h-noz').textContent = String(Math.round(nozzleTemp));
  $('h-bed').textContent = String(Math.round(bedTemp));
  $('h-layer').textContent = String(s.finished ? s.layerCount : s.layer);
  $('h-layers').textContent = String(s.layerCount);
  $('h-time').textContent = `${clock(s.printSeconds)} / ${clock(s.totalSeconds)}`;
  $('h-bar').style.width = `${(s.finished ? 1 : s.progress) * 100}%`;
  $('gcode').textContent = gcodeLines.slice(-GCODE_LINES).join('\n');
  if (s.finished) syncPlay();
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
$('filament').hidden = true;
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  speedInput.value = '80';
  applySpeed();
}
const first = DEMOS[0];
const firstCanvas = renderDemo(first);
loadSource(firstCanvas, firstCanvas.width, firstCanvas.height);
setActiveSample(first.id);
