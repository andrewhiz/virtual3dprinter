# Virtual 3D Printer

A fun side project: turn a product photo into an animated virtual 3D print. Visualisation only.

- Pipeline: `analyze.ts` (photo -> silhouette) -> `model.ts` (silhouette -> signed field solid)
  -> `slicer.ts` (field -> layered moves) -> `printer.ts` (Three.js animation). `main.ts` wires the UI.
- `analyze`, `model`, `slicer`, `gcode` are pure and DOM-free; keep them that way so tests run in Node.
- Printer-space coordinates are mm, z up, bed centred at 0. The Three.js root group rotates z-up to y-up.
- Filament is one InstancedMesh; only upload the instance ranges that change per frame.
- Commands: `npm run dev`, `npm test`, `npm run typecheck`, `npm run build`.
- TypeScript strict, no `any`. Conventional commits.
