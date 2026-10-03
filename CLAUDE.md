# Virtual 3D Printer

A fun side project: turn a product photo into an animated virtual 3D print. Visualisation only.

- Pipeline: `analyze.ts` (photo -> silhouette) -> `model.ts` (silhouette -> signed field solid)
  -> `slicer.ts` (field -> `Toolpath`) -> `scene.ts` (workshop, animation, button picking).
- `toolpath.ts`: moves as parallel typed arrays (start/end xyz, width, height, feed mm/s, kind,
  layer, 0xRRGGBB colour) plus timeline events (temps, fan, dwell...) keyed by move index; moves
  run along the top of their layer. `playback.ts` (`Playhead`) owns timing, seeking and the nozzle
  position; the scene only draws. `fitToBudget` simplifies paths over the GPU segment budget.
  `printers/` holds one file per machine (`slinger`, `corexy`, `delta`) built from shared `parts.ts`
  and `panel.ts`; each exports a `PrinterSpec` whose `build()` returns a `PrinterRig`. `main.ts` wires the UI.
- 3D files: `meshLoad.ts` (Three.js loaders, lazy) -> `meshModel.ts` (per-layer even-odd fill + SDF) -> slicer.
  `meshSamples.ts` generates the built-in samples (closed, outward-facing shells; parts may overlap;
  optional `printSize` is the longest side they load at);
  `meshPreview.ts` draws thumbnails. Mesh fill is non-zero winding with a per-row even-odd fallback,
  so every generated shell must be closed (cap arcs and open ends).
- `analyze`, `model`, `meshModel`, `slicer`, `toolpath`, `playback`, `gcode` are pure and DOM-free; keep them that way so tests run in Node.
- Phones: `printers/quality.ts` lowPower skips PMREM, MSAA, PCF shadows, extra lights and physical
  materials (new mobile GPU drivers crash on them and Chrome then blocks WebGL for the site).
  After a context loss the tab reloads in `safe` mode (also `?safe`): no shadows, 1x pixel ratio. The scene must survive
  WebGL failure (`scene.failure`) and context loss; never let a renderer error take down the UI.
- Printer-space coordinates are mm, z up, bed centred at 0. The Three.js root group rotates z-up to y-up.
- Same-origin only: fonts are bundled via `@fontsource`, and `public/_headers` sets a strict CSP and
  security headers. Never add CDN scripts, styles, fonts or analytics. `vite.config.ts` copies the CSP
  into a meta tag at build time; `docs/DEPLOYMENT.md` repeats the header values for other hosts, so
  update it whenever `public/_headers` changes.
- `vite.config.ts` is typechecked by `tsconfig.node.json` (Node types); `src/` uses `tsconfig.json` (browser only).
- Filament is one InstancedMesh; only upload the instance ranges that change per frame.
- Commands: `npm run dev`, `npm test`, `npm run typecheck`, `npm run build`, `npm run deploy`.
- Live demo: https://virtual3dprinter.onthejourney.online/ (custom domain on the Worker).
- Deploy: Cloudflare Workers static assets (`wrangler.jsonc`, no worker script, Worker `virtual3dprinter`).
  Cloudflare Workers Builds deploys `main` (build `npm run build`, deploy `npx wrangler deploy`; preview
  builds off). The GitHub Actions deploy job is an unused alternative; keep its secrets unset.
- CI actions are pinned to commit SHAs (Dependabot bumps them); the workflow token is read-only.
- MIT licensed (`LICENSE`); see `SECURITY.md` and `CONTRIBUTING.md`.
- TypeScript strict, no `any`. Conventional commits.
