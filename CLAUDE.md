# Virtual 3D Printer

A fun side project: turn a product photo into an animated virtual 3D print. Visualisation only.

- Pipeline: `analyze.ts` (photo -> silhouette) -> `model.ts` (silhouette -> signed field solid)
  -> `slicer.ts` (field -> layered moves) -> `scene.ts` (workshop, animation, button picking).
  `printers/` holds one file per machine (`slinger`, `corexy`, `delta`) built from shared `parts.ts`
  and `panel.ts`; each exports a `PrinterSpec` whose `build()` returns a `PrinterRig`. `main.ts` wires the UI.
- 3D files: `meshLoad.ts` (Three.js loaders, lazy) -> `meshModel.ts` (per-layer even-odd fill + SDF) -> slicer.
  `meshSamples.ts` generates the built-in samples (closed, outward-facing shells; parts may overlap);
  `meshPreview.ts` draws thumbnails. Mesh fill is non-zero winding with a per-row even-odd fallback,
  so every generated shell must be closed (cap arcs and open ends).
- `analyze`, `model`, `meshModel`, `slicer`, `gcode` are pure and DOM-free; keep them that way so tests run in Node.
- Phones: `printers/quality.ts` lowPower skips PMREM, MSAA, PCF shadows, extra lights and physical
  materials (new mobile GPU drivers crash on them and Chrome then blocks WebGL for the site).
  After a context loss the tab reloads in `safe` mode (also `?safe`): no shadows, 1x pixel ratio. The scene must survive
  WebGL failure (`scene.failure`) and context loss; never let a renderer error take down the UI.
- Printer-space coordinates are mm, z up, bed centred at 0. The Three.js root group rotates z-up to y-up.
- Filament is one InstancedMesh; only upload the instance ranges that change per frame.
- Commands: `npm run dev`, `npm test`, `npm run typecheck`, `npm run build`, `npm run deploy`.
- Deploy: Cloudflare Workers static assets (`wrangler.jsonc`, no worker script). CI deploys `main`
  via `.github/workflows/ci-deploy.yml` once CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID secrets exist.
- TypeScript strict, no `any`. Conventional commits.
