# Virtual 3D Printer

[![CI & Deploy](https://github.com/andrewhiz/virtual3dprinter/actions/workflows/ci-deploy.yml/badge.svg)](https://github.com/andrewhiz/virtual3dprinter/actions/workflows/ci-deploy.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Pick a 3D printer, drop in a 3D model (STL, OBJ, 3MF, PLY) or a product photo, and watch a
virtual printer build it layer by layer, right in your browser.
It's a toy: nothing gets exported or printed. It's just fun to watch.

- Three detailed printers (bed-slinger, CoreXY, delta) with working on-printer buttons.
- Nine built-in 3D samples, plus your own model files or photos.
- Runs entirely in the browser. No backend, no accounts, no uploads.

## Quick start

You need [Node.js](https://nodejs.org/) 22.12 or newer and npm.

```sh
git clone https://github.com/andrewhiz/virtual3dprinter.git
cd virtual3dprinter
npm ci
npm run dev          # http://localhost:5173
```

Other commands:

```sh
npm test             # analysis, mesh and slicer tests (Node, no browser)
npm run typecheck
npm run build        # static site in dist/
npm run build:single # one self-contained HTML file in dist-single/
npm run preview      # serve dist/ locally
```

`dist/` is plain static files, so you can host it anywhere. Cloudflare Workers setup is below.

## How it works

1. **Find the object** (`src/analyze.ts`). The photo is shrunk to ~180 px. The object is cut out
   using the alpha channel if the image has one. Otherwise the background colour is estimated
   from the border pixels and split off with an Otsu threshold. Holes are filled and the largest
   blob is kept. We then measure the silhouette's signed distance field, mirror symmetry, and
   dominant colour.
2. **Make it 3D** (`src/model.ts`). The silhouette becomes a solid described as a signed field
   (`field(x, y, z) > 0` inside). There are three ways to build it:
   - **Revolve**: spins the outline around its centre. Good for vases, bottles, cups and chess
     pieces. Auto mode picks this when the outline is ≥ 90 % mirror-symmetric.
   - **Standee**: stands the outline upright and gives it 14 mm of depth. This is the default for
     everything else.
   - **Relief**: lays the photo flat, and darker pixels rise higher. Used when there is no clear
     outline to cut out.
3. **Slice it** (`src/slicer.ts`). Each layer is sampled on a grid. Two walls are traced with
   marching squares. Diagonal infill alternates direction every layer, and the top and bottom
   layers are solid. The moves are then ordered to keep travel between them short.
4. **Print it** (`src/scene.ts`, `src/printers/`). First pick one of three machines. Each one has
   its own geometry, kinematics and controls:
   - **Slinger i3**: a Cartesian bed-slinger. The bed runs in Y, the gantry climbs Z, the head
     runs X. It has a blue 12864 LCD and a rotary knob.
   - **Cube XY**: an enclosed CoreXY. The head flies in X/Y at the top and the bed drops in Z.
     It has a colour touchscreen, chamber light and chamber temperature.
   - **Kossel Delta**: three towers and six parallel arms, with carriage heights from real delta
     inverse kinematics. It has a round glass bed and an amber OLED.

   Every printer has a working control panel: a live status screen plus clickable 3D buttons for
   restart, play/pause, skip to end, slower, faster and light. On the Slinger you can also scroll
   the knob to change speed. All deposited filament is drawn by a single `InstancedMesh` that
   grows one move at a time. A cosmetic G-code stream (`src/gcode.ts`) scrolls alongside.

   Printers are built from code (no model downloads, nothing stored). Only the selected printer is
   kept in GPU memory, and switching printers clears the current print because bed size and
   speeds change the slice.

**3D model files.** Upload STL, OBJ, 3MF or PLY (up to 80 MB and 3 million triangles). Files are
parsed in the browser with Three.js' MIT-licensed loaders and never leave the device, so there is
no server cost. Each layer is cut from the mesh with an even-odd scanline fill (`src/meshModel.ts`)
and then sliced exactly like photo models. OBJ is assumed Y-up and the others Z-up; there's a
toggle if a model comes in lying down. Overlapping parts in a file (a handle through a wall) merge into one solid.

Step two opens with a sample already printing. The nine built-in samples are generated 3D
models (`src/meshSamples.ts`): vase, boxy SUV, rocket, chess pawn, rubber duck, coffee mug, twisted
vase, spur gear and hex pencil cup. Photo upload is still there, marked beta, because outline
detection from a single photo is rough.

Colours come from the photo by default, or you can pick a single filament colour.

## Using it

**Full view** hides the settings so the printer fills the browser window (Esc or Close to exit).
On phones, and on screens without WebGL, the app lowers render cost, recovers if the browser drops
the 3D context, and explains what happened instead of showing a black view.

Built with TypeScript, Vite, Three.js and Vitest.

## Privacy and security

- There is no backend. Photos and model files are read in the browser and never leave the device.
- The page makes no third-party requests: fonts are bundled with the site, and there is no
  analytics or tracking. The only thing stored is your printer choice, in `localStorage`.
- `public/_headers` gives the deployed site a strict Content-Security-Policy (same-origin scripts,
  styles and fonts only; no framing) plus `nosniff`, `no-referrer` and a locked-down
  `Permissions-Policy`.
- Uploads are capped at 80 MB and 3 million triangles for models and 40 MB for photos. Triangles
  with broken (NaN or infinite) coordinates are dropped.
- CI runs with a read-only token, actions are pinned to commit SHAs, and Dependabot keeps npm
  packages and actions up to date.

Found a vulnerability? See [SECURITY.md](SECURITY.md).

## Deploy (Cloudflare Workers)

The site is fully static, so Cloudflare Workers serves the Vite build (`dist/`) as static assets
with no worker script. See `wrangler.jsonc`. Static asset requests are free on Workers.

**Automatic:** `.github/workflows/ci-deploy.yml` typechecks, tests and builds every push and PR.
Pushes to `main` then deploy with `wrangler deploy`. The deploy step is skipped with a notice until
these two repository secrets exist. Add them once:

1. **Account ID**: Cloudflare dashboard → Workers & Pages → copy *Account ID* from the right sidebar.
2. **API token**: Cloudflare dashboard → My Profile → API Tokens → *Create Token* → use the
   **Edit Cloudflare Workers** template → scope it to your account → create and copy the token.
3. On GitHub, go to repo **Settings → Secrets and variables → Actions → New repository secret** and add
   `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.
4. Re-run the latest *CI & Deploy* workflow (Actions tab → *Run workflow*), or push to `main`.

The Worker is named `virtual3dprinter` (`wrangler.jsonc`) and is served at
`https://virtual3dprinter.<your-subdomain>.workers.dev`. If you connect the repo with Cloudflare's
own Git integration (Workers Builds) instead, the Worker name there must match `wrangler.jsonc`,
and you don't need the GitHub secrets. You can add a custom domain under the
Worker's *Settings → Domains & Routes*.

For a public repo, also protect the `production` environment (Settings → Environments →
*production* → Deployment branches → `main` only). Pull requests from forks never get the
secrets, so they can build and test but not deploy.

**Manual:** `npm run deploy` (builds, then runs `wrangler deploy`; logs in through the browser the
first time). `npm run preview:worker` serves the build locally on the Workers runtime.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and
conventions.

## License

[MIT](LICENSE). Third-party parts keep their own licenses:

- [Three.js](https://threejs.org/) and its loaders: MIT.
- [Chakra Petch](https://fonts.google.com/specimen/Chakra+Petch),
  [IBM Plex Sans and IBM Plex Mono](https://github.com/IBM/plex) (bundled through
  [Fontsource](https://fontsource.org/)): SIL Open Font License 1.1.

## Ideas

- Use a vision model to classify the object and pick the build mode or a depth profile.
- Estimate depth from a single photo for true 3D shapes instead of silhouettes.
- Show supports for overhangs, and add a time-lapse camera mode.
- Record the print as a video or GIF.
