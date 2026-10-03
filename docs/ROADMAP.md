# Feature roadmap

A plan for the next round of features. Each numbered section below is meant to land as its own
pull request, in the order given under [Build order](#build-order). Nothing here is built yet.
The design choices are settled under [Decisions](#decisions).

| # | Feature | Size | Depends on |
| --- | --- | --- | --- |
| 0 | [Toolpath foundation](#0-toolpath-foundation) (no visible change) | M | – |
| 1 | [Play a real G-code file](#1-play-a-real-g-code-file) | L | 0 |
| 2 | [Failure mode](#2-failure-mode) | L | 0 (3 helps) |
| 3 | [Slicer-style preview](#3-slicer-style-preview) | M | 0 |
| 4 | [Pre-print ritual](#4-pre-print-ritual) | S–M | 0 |
| 6 | [Sound](#6-sound) | M | 0 (4 helps) |
| 9 | [Better stats](#9-better-stats) | S | – |
| 10 | [Iconic samples](#10-iconic-samples) | S | – |

Feature numbers match the original idea list. Not planned: 5 (time-lapse), 7 (supports, brim and
raft) and 8 (colour changes). Real G-code files can still contain supports, brims and colour
changes. They will play, but in a single filament colour (see [Out of scope](#out-of-scope)).

**Ground rules from `CLAUDE.md`:**

- **Pure modules:** `slicer`, `gcode` and the new parser, infill, failure, ritual and stats
  modules stay pure and DOM-free, so they can be tested in Node.
- **Same origin:** no new third-party requests, fonts or audio files. The CSP in `public/_headers`
  should not need to change.
- **Phones:** every feature works in `quality.lowPower` and `safe` mode, even if it does less there.
- **Code style:** TypeScript strict, no `any`, conventional commits.

---

## 0. Toolpath foundation

Almost every feature below needs the move list to carry more than it does today. Doing this once,
first, keeps the later PRs small.

**Today:**

- `slicer.ts` returns `Move` objects that are flat (one `z` per move).
- Each move has one of three kinds: Travel, Perimeter or Infill.
- Line width and layer height are global (`SliceResult.lineWidth`, `layerHeight`).
- `scene.ts` plays moves at two fixed speeds (`spec.printSpeed`, `spec.travelSpeed`).

### Changes

1. **Struct-of-arrays toolpath.** Replace `Move[]` with a `Toolpath` of typed arrays:
   - Start and end points: `x0 y0 z0 x1 y1 z1` (`Float32Array`).
   - `width`, `height` and `feed` in mm/s (`Float32Array`).
   - `kind` (`Uint8Array`).
   - `layer` (`Uint32Array`).
   - `color` (an index into a small palette).

   A real G-code file can have 2 million moves. As JS objects that is roughly 200 MB. As typed
   arrays it is about 90 MB, and it can be sent to and from a Web Worker without copying.
2. **More move kinds**, matching what slicers label:
   - Travel, Outer wall, Inner wall, Sparse infill, Solid infill, Top surface.
   - Skirt/brim, Support, Bridge.
   - Non-printing kinds: Retract, Wipe, Purge.

   Our own slicer emits Outer wall, Inner wall, Sparse infill, Solid infill and Top surface. The
   rest come from G-code files.
3. **3D segments.** Teach `writeMatrix` to orient a segment along any direction (a quaternion
   from the unit vector) instead of only around z. Then the following all render correctly:
   - Vase mode (z rises along a move).
   - Z-hops.
   - Spaghetti.
   - Stringing.
4. **Per-move width, height and feed.** The playback speed of each move comes from `feed` (times
   the speed multiplier). The fixed per-printer speeds remain only as our slicer's defaults.
5. **Timeline events.** Add a sorted list of `{ at: moveIndex, type, value }`. It covers:
   - Temperature targets, fan speed and dwell (wait) times.
   - Beeps, homing and probing.
   - Failure triggers.

   The scene fires these as playback passes them, and the panel and HUD read them.
6. **Seek.** `scene.seek(moveIndex)` jumps straight to any point. For filament this only changes
   `mesh.count` plus the one partial instance. The layer slider (3) and the "Finish" button both
   use it.
7. **Instance budget.** Cap filament instances at about 2 million on desktop and about 500k on
   `lowPower`. Past the cap:
   - Merge collinear runs.
   - Then simplify each same-layer, same-kind run of moves with Douglas–Peucker, raising the
     tolerance until the path fits.

   The UI shows that the path was simplified.

**Tests:**

- The existing slicer tests, ported to the new types.
- Round-trip seek: seeking to N gives the same instance count and head position as playing to N.
- 3D segment orientation.

**Risk:** this touches `slicer.ts`, `scene.ts`, `gcode.ts`, `main.ts` and the tests at once.
Keep this PR behaviour-preserving: the same visuals and the same stats.

---

## 1. Play a real G-code file

Drop a `.gcode` file from Cura, PrusaSlicer, Bambu Studio or OrcaSlicer on the page and watch it
print on the virtual machine.

### Parser: `src/gcodeParse.ts` (pure)

Stream the file line by line (`file.stream()` + `TextDecoderStream`) so a 200 MB file is never held
as one string. Handle these commands:

| G-code | Handling |
| --- | --- |
| `G0`/`G1` X Y Z E F | Moves. A move is an extrusion when E increases. Track F per move. |
| `G2`/`G3` (I J or R) | Arcs from arc fitting (Orca, Prusa). Split into segments with chord error ≤ 0.05 mm. |
| `G90`/`G91`, `M82`/`M83` | Absolute or relative XYZ and E. |
| `G92` | Reset the position or E. |
| `G10`/`G11`, E-only moves | Retract and unretract. They don't move the head; they produce Retract events. |
| `G28` | Home event (animated in 4). |
| `G29`, `BED_MESH_CALIBRATE` | Probe event (animated in 4). |
| `M104`/`M109`, `M140`/`M190`, `M141`/`M191` | Temperature targets; `M109`, `M190` and `M191` also wait. |
| `M106`/`M107` | Part-cooling fan speed. |
| `G4` | Dwell. |
| `M600`, `T0`…`Tn` | Recorded and shown in the ticker. Colour stays single (8 is out of scope). |
| Anything else | Ignored, but still shown in the ticker. |

Layer and line-type metadata come from slicer comments:

| Slicer | Layer marker | Line type | Also useful |
| --- | --- | --- | --- |
| Cura | `;LAYER:n` | `;TYPE:WALL-OUTER`, `WALL-INNER`, `FILL`, `SKIN`, `SUPPORT`, `SKIRT` | `;TIME:`, `;Filament used:` |
| PrusaSlicer | `;LAYER_CHANGE` + `;Z:` | `;TYPE:External perimeter`, `Perimeter`, `Internal infill`, `Solid infill`, `Top solid infill`, `Bridge infill`, `Skirt/Brim`, `Support material` | `; filament used [g]`, `; estimated printing time`, `; filament_colour` |
| OrcaSlicer / Bambu Studio | `; CHANGE_LAYER` + `; Z_HEIGHT:` | `; FEATURE: Outer wall`, `Inner wall`, `Sparse infill`, … | `; LINE_WIDTH:`, `; LAYER_HEIGHT:`, `; filament_colour` |

If a file has no markers, fall back to a new layer whenever z increases during extrusion. If it has
no type comments, everything is "Wall". Width comes from `;WIDTH:`/`; LINE_WIDTH:` when present.
Otherwise it is derived from the extruded volume:
`E × filament area ÷ (length × layer height)`.

**Placement:**

- Centre the extruded bounds on the virtual bed.
- If the print is wider than the chosen printer's `maxFootprint`, show it anyway with a toast:
  "This print is 240 mm wide; the Slinger i3 bed is 190 mm."
- The CoreXY has the largest bed, so the toast also offers to switch to it.

**Colour:**

- Use the slicer's `filament_colour` when the file has one.
- Otherwise use the colour picker.

### Bambu `.gcode.3mf`

Bambu Studio (and Orca for Bambu printers) exports a zip with `Metadata/plate_N.gcode` inside. Read
it with the `fflate` copy that already ships with Three.js (`three/addons/libs/fflate.module.js`,
used by the 3MF loader). There are two safeguards:

- Inflate only `Metadata/plate_*.gcode` entries.
- Check each entry's declared uncompressed size against the limit before inflating, so a zip bomb
  can't fill memory.

If there are several plates, play plate 1 and list the others in a picker.

Prusa binary G-code (`.bgcode`) is out of scope for v1. Show a toast that says to export ASCII
G-code: in PrusaSlicer, untick **Printer Settings → General → Firmware → Supports binary G-code**.

### Worker, limits and UI

- **Worker:** parse in a module Web Worker (`new Worker(new URL('./gcodeWorker.ts',
  import.meta.url), { type: 'module' })`). Vite emits it under `/assets/`, which `worker-src 'self'`
  already allows. Typed arrays come back as transferables. The single-file build needs the worker
  inlined (`?worker&inline`, a `blob:` URL, also allowed). Verify both builds. If `Worker` fails to
  start, fall back to chunked parsing on the main thread.
- **Limits:**
  - 250 MB files on desktop, 60 MB on `lowPower`.
  - The instance budget from 0.
  - Overlong lines are skipped.
  - Non-finite numbers are dropped, as `dropNonFinite` does for meshes.
- **Ticker:** show the file's real lines. Each move keeps its source line number. The raw bytes are
  kept for files under 50 MB, and lines are decoded on demand. Bigger files fall back to
  regenerated lines from `GcodeWriter`.
- **Panel and HUD:**
  - Temperatures follow the file's targets.
  - Remaining time uses the per-move feed.
  - The slicer's own estimate is shown next to ours ("Slicer: 1 h 42 m").
- **Controls:** size, layer height, infill and up-axis are hidden in G-code mode, because the file
  decides them. Show the file name, slicer name (from the header comment), layer count and
  filament use.
- **Inputs:**
  - The upload `accept` list gains `.gcode`, `.gco`, `.g` and `.3mf`.
  - A `.3mf` that contains G-code goes to this path. A model `.3mf` still goes to the mesh loader.

**Tests:** use small hand-written fixtures in each slicer's dialect:

- Absolute and relative E, `G92 E0`, firmware retraction.
- Arcs, both I/J and R, in both directions.
- Vase mode (continuous z).
- Missing markers.
- Malformed and huge numbers.
- A zip-bomb guard test.
- A `.gcode.3mf` round trip.

Don't commit real slicer output; synthetic snippets cover the cases.

---

## 2. Failure mode

A "Chaos" section with the classic disasters. Each one is a pure, seeded transform in
`src/failures.ts`. It takes `(toolpath, failure, seed, triggerLayer)` and returns a new toolpath and
events, so it is deterministic and testable. The scene only adds the animations that can't be baked
into moves.

### The failures

| Failure | What happens | How |
| --- | --- | --- |
| **Spaghetti** | From the trigger layer, extrusion no longer lands on the part. It becomes curly noodles that pile up and spread across the bed. | Rewrite each later extrusion as a 3D "noodle": smoothed random-walk offsets, with z set by a coarse heightmap of the pile so noodles drape over the part and each other. Needs 3D segments (0). |
| **Layer shift** | The print steps sideways by 2–8 mm at one layer and continues offset. | Add a fixed offset to every move from the trigger layer on. The axis fits the machine: X or Y on the slinger (Y is the bed), X or Y on the CoreXY, and a smaller skewed shift on the delta. |
| **Warping** | The bottom corners slowly lift off the bed as the print grows. | A vertex-shader lift on the filament material (`onBeforeCompile`). The lift is `amount × cornerFactor(x, y) × (1 − z / warpHeight)`, with `amount` a uniform that grows with progress. No instance re-uploads. |
| **Stringing** | Thin hairs between separate islands. | For each travel without a retract, emit 2–3 thin, sagging segments along it (width about 0.08 mm). Pairs well with the stringing-test sample (10). |
| **Clogged nozzle** | Under-extrusion: lines thin out, gaps appear, then the head "air prints" with nothing coming out. | Scale `width` down from the trigger layer, drop random moves, then zero them. Extruder click events for sound (6). |
| **Popped off the bed** | The part lets go, is shoved by the nozzle and tips over. Spaghetti follows. | At the trigger, freeze the printed part as its own `InstancedMesh` and animate it as a rigid body (a slide plus a tip around one bottom edge, eased). Every later extrusion uses the spaghetti transform. |

### UI and extras

**UI:**

- A "Failure" select: None, Spaghetti, Layer shift, Warping, Stringing, Clogged nozzle, Popped off
  the bed, and Surprise me.
- A "When" slider (10–90% of layers). Surprise me picks both.

**Extras:**

- **Spaghetti detection:** the CoreXY's panel (it is the enclosed, camera-equipped machine) shows
  "Spaghetti detected – print paused" a few layers after a spaghetti or bed failure, and the print
  pauses. `PanelState.state` gains `'error'` with a message.
- **Share link:** the URL hash stores the sample, printer, failure, trigger and seed. Example:
  `#sample=tug&printer=slinger&fail=spaghetti&at=40&seed=7`. Opening the link replays the same
  disaster. This works for built-in samples only, since uploaded files never leave the browser.
  This is what makes the feature shareable.
- **Reduced motion:** the tumble animation respects `prefers-reduced-motion`; the part just ends up
  tipped over.

**Tests:**

- Same seed, same output.
- Layer shift offsets exactly the layers from the trigger on.
- Clog widths are monotonic.
- Spaghetti z never goes below the bed.
- No transform produces non-finite numbers.

---

## 3. Slicer-style preview

What people look at in their slicer every day.

1. **Colour by.** A segmented control on the transport bar:
   - Filament: today's look.
   - Line type.
   - Speed (a gradient over `feed`; most useful for G-code files).
   - Layer height or width (G-code only, optional).

   Switching rewrites `instanceColor` once. Use a colour-blind-safe palette for line types
   (Okabe–Ito based) with a small legend. The legend shows each type's share of time and
   filament, like a slicer's summary.
2. **Travel lines.** An optional toggle. All travels go into one `LineSegments` geometry, and
   `drawRange` grows with playback, so showing them costs one draw call.
3. **Layer slider.** A vertical slider on the right edge of the viewport, like a slicer's:
   - Dragging it seeks the print to the end of that layer (0, `seek`), and keyboard arrows step
     one layer.
   - A "This layer only" toggle hides everything else with a per-instance `layer` attribute and a
     `minLayer`/`maxLayer` uniform in the vertex shader (collapsing hidden instances).
   - A second, horizontal slider scrubs within the current layer.
4. **More infill patterns** in `src/infill.ts` (pure). Today infill is diagonal lines that switch
   direction each layer. Refactor it so that:
   - Each pattern produces unclipped polylines for a layer.
   - A shared `clipToPart(grid, iso, polyline)` walks the polyline through the existing field grid
     and keeps the inside spans.
   - Spacing scales with density, so all patterns use the same slider.

   The patterns:

   | Pattern | Per layer |
   | --- | --- |
   | Lines (today) | Parallel lines, ±45° on alternating layers |
   | Grid | Both directions every layer |
   | Triangles | Three directions, 60° apart |
   | **Gyroid** | For layer height z, the curve `sin x cos y + sin y cos z + sin z cos x = 0`, solved explicitly per x (or y on alternate phases) as Cura does: `y = atan2(b, a) ± acos(−c / √(a² + b²))`. |
   | **Honeycomb** | Zigzag rows; neighbouring rows mirror to form hexagons. The same every layer. |
   | Concentric | Offsets of the inner perimeter, using the existing `contours()` at more iso levels |

   The infill control becomes a pattern select plus the density slider. Solid layers stay as
   lines. Sample thumbnails don't change.

**Tests:**

- For every pattern and density, all infill points are inside the part.
- Measured coverage is within ±25% of the requested density.
- Gyroid curves are continuous across layers.

---

## 4. Pre-print ritual

Homing, probe taps across the bed, and a purge line, before every fresh print.

`src/ritual.ts` (pure) builds a short toolpath prefix plus events for a `PrinterSpec`:

1. **Heat.** Set temperatures, then dwell until they are reached. Heat-up time is compressed so it
   never takes more than a few seconds at 25×.
2. **Home (`G28`), per machine.** Each axis does the real double-tap: a fast approach to the
   endstop, back off 5 mm, then a slow approach. Endstop click events for sound.
   - Slinger: X to the left, Y (the bed) to the back, then Z down to the probe.
   - CoreXY: XY to the corner, then Z on the probe.
   - Delta: all three carriages to the top.
3. **Probe (`G29`).** Tap a 3×3 grid (5×5 on the CoreXY): descend, a short pause, rise. The panel
   shows "Probing 7/25". Optional: briefly show the "measured" mesh as a coloured height map on
   the bed.
4. **Purge line.** One or two extrusion lines along the front-left edge of the bed. It is part of
   the filament mesh, so it stays visible next to the finished part.

**Spec and panel changes:**

- `PrinterSpec` gains `bedSize`, `home` (endstop position) and `probeGrid`.
- `PanelState.state` gains `'heating' | 'homing' | 'probing'`.
- A "Pre-print checks" toggle (default on, remembered in `localStorage`).
- "Finish" skips the ritual.
- Rebuilding after a slider change restarts without the ritual, so tweaking settings stays quick.

**G-code files:** they already contain their own `G28`, `G29`, waits and purge lines. The parser
from 1 turns `G28`/`G29` into the same home and probe animations, so the ritual comes from the file
and is never added twice.

**Tests:**

- Each printer's ritual stays inside its bed and travel limits.
- The ritual ends at a safe z.
- No ritual is added in G-code mode.

---

## 6. Sound

Optional, and off by default. A speaker button on the transport bar turns it on (this also
satisfies browser autoplay rules), with a volume slider. The choice is remembered in
`localStorage`.

All sound is synthesised with the Web Audio API in `src/sound.ts`, so no audio files are needed.
It uses plain audio nodes only, with no `AudioWorklet`, so the CSP doesn't change.

- **Stepper whine.**
  - One oscillator per motor, each a square wave through a low-pass filter plus a little noise.
  - Pitch follows that motor's full-step rate: virtual axis speed × steps/mm ÷ microsteps, about
    5 Hz per mm/s for an 80 steps/mm belt axis. 100 mm/s gives about 500 Hz.
  - Motors per machine: X and Y on the slinger, A and B on the CoreXY (they mix X and Y), the three
    towers on the delta, plus Z. On the delta, all three tones move together in odd harmonies.
- **High speeds.** Pitch uses the virtual printer's speed, not the playback multiplier. Above about
  50×, direction changes are too fast to hear, so the motors cross-fade into a steady busy hum.
- **Fans.** Filtered noise for the hotend fan (on while the nozzle is hot) and the part-cooling
  fan (follows `M106` or our default fan curve).
- **Events.** Endstop clicks while homing, probe ticks, extruder clicks for a clog, the finish
  beep (a short Marlin-style tune), and an alert for spaghetti detection.
- **Behaviour.** Mute when the tab is hidden (`visibilitychange`), and fade out on pause. On
  `lowPower`, use one shared motor voice and no noise layers.

**Scene change:** the scene reports the head velocity per axis (from the nozzle delta in virtual
seconds) and passes on timeline events. The sound module only listens, so it can never break
rendering.

**Tests:** the step-rate math and the delta tower velocity math are pure functions in Node. The
audio graph itself gets a manual check.

---

## 9. Better stats

`src/stats.ts` (pure):

- **Material.** A select: PLA, PETG, ABS, ASA, TPU. It sets the density (1.24, 1.27, 1.04, 1.07 and
  1.21 g/cm³) and the default nozzle and bed temperatures shown on the panel. The enclosed CoreXY
  suggests ABS or ASA.
- **Weight.** `extruded volume × density`, in grams.
- **Cost.**
  - Inputs: spool price and spool weight (default 1 kg).
  - Result: `grams × price ÷ spool grams`.
  - A currency select (USD, EUR, GBP, CAD, AUD, INR, JPY), formatted with
    `Intl.NumberFormat`.
  - All inputs are remembered in `localStorage`.
- **Nozzle size.** 0.2, 0.4, 0.6 and 0.8 mm.
  - Line width defaults to about 1.1 × nozzle.
  - The layer-height slider is limited to 25–75% of the nozzle.
- **Breakdown.** Per line type (from 3): walls, infill and travel, as time and grams.
- **G-code files.** Show the slicer's own numbers (`filament used [g]`, `TIME`) next to ours.

**Performance note:** a 0.4 mm nozzle at 0.2 mm layers on an 80 mm part is millions of moves. The
stats always use the real settings, computed directly. If the toolpath would go over the instance
budget, render it at a coarser display layer height and show a note: "Shown at 0.8 mm layers for
speed; stats use 0.2 mm" (decision 2 below).

**Tests:** grams and cost for a known volume, and nozzle and layer-height limits.

---

## 10. Iconic samples

New entries in `meshSamples.ts`, all generated in code: closed, outward-facing shells as today.

- **Calibration cube.** A 20 mm cube with raised X, Y and Z letters on the matching faces. Each
  letter is a few overlapping prisms (rectangles); the existing `prism` helper and non-zero fill
  handle overlaps.
- **Tugboat.** Our own design, not a copy of 3DBenchy, which has its own licence and trademark.
  - Use a different name ("Tugboat"), different proportions and different details.
  - Hull: a new `loft()` helper through cross-sections (pointed bow, rounded stern).
  - On deck: a stepped wheelhouse, a slanted funnel and bollards. Add a deliberate overhang at the
    bow so it still works as a torture test.
- **Optional, cheap once the above exist:**
  - Retraction test (two thin towers; the classic stringing print, ideal with failure 2).
  - Overhang fan (steps from 20° to 70°).
  - Bridge test (two pillars with spans).

**Tests:** every sample is a closed shell (each edge shared by an even number of triangles per
part), slices to a non-empty toolpath, and fits every printer at the default size.

---

## Build order

| Order | PR | Why here |
| --- | --- | --- |
| 1 | 0 Toolpath foundation | Unblocks everything; behaviour-preserving, so easy to review. |
| 2 | 10 Iconic samples | Independent quick win; can run in parallel with 0. |
| 3 | 3 Slicer-style preview | Line types and the layer slider make 1 and 2 much more readable. |
| 4 | 1 Real G-code | The biggest hobbyist draw; builds on 0 and 3. |
| 5 | 9 Better stats | Small; uses the line-type breakdown from 3 and the slicer stats from 1. |
| 6 | 4 Pre-print ritual | Reuses timeline events; G-code `G28`/`G29` hooks into 1. |
| 7 | 2 Failure mode | Best with 3 (types), 4 (realistic start) and 10 (tugboat spaghetti). |
| 8 | 6 Sound | Last, so it can hook into the events from 2 and 4. |

Each PR updates `README.md` (features list), `CLAUDE.md` (architecture notes) and adds tests for
its pure module. For each one, a headless Chromium run against `npm run preview` confirms:

- No CSP violations.
- No console errors.
- No requests to other sites.
- The `?safe` mode still works.

## Decisions

Agreed on 2026-10-02:

1. **G-code bigger than the bed:** play it anyway, centred, with a warning toast and an offer to
   switch to the CoreXY.
2. **Fine nozzles vs. performance:** when the real settings would exceed the instance budget,
   render at a coarser layer height with a visible note. Stats always use the real settings.
3. **Default currency:** USD, remembered once changed.
4. **Share links for failure mode:** yes, for built-in samples only, via the URL hash.
5. **`.gcode.3mf`:** included in the first G-code PR. Prusa `.bgcode` waits.

## Out of scope

- Time-lapse capture (5).
- Generating supports, brims and rafts in our own slicer (7). Supports in G-code files still show,
  and can be coloured by line type.
- Multi-colour or filament-change rendering (8). `M600` and tool changes are listed in the ticker
  only.
- Uploading or storing anything server-side; the app stays fully client-side.
