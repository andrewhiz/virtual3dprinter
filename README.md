# Virtual 3D Printer

Upload a photo of a product and watch a virtual 3D printer build it, layer by layer.
It's a toy: nothing gets exported or printed. It's just fun to watch.

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
4. **Print it** (`src/printer.ts`). A Three.js bed-slinger printer carries out the moves: the bed
   slides in Y, the gantry climbs in Z, the hot end runs in X, and the spool turns as it feeds.
   All deposited filament is drawn by a single `InstancedMesh` that grows one move at a time. A
   cosmetic G-code stream (`src/gcode.ts`) scrolls alongside.

Colours come from the photo by default, or you can pick a single filament colour.

## Run it

```sh
npm install
npm run dev          # http://localhost:5173
npm test             # analysis + slicer tests (Node, no browser)
npm run typecheck
npm run build        # static site in dist/
npm run build:single # one self-contained HTML file in dist-single/
```

Built with TypeScript, Vite, Three.js and Vitest. There is no backend, and the photo never leaves
the browser.

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

The first deploy creates the `virtual-3d-printer` Worker at
`https://virtual-3d-printer.<your-subdomain>.workers.dev`. You can add a custom domain under the
Worker's *Settings → Domains & Routes*.

**Manual:** `npm run deploy` (builds, then runs `wrangler deploy`; logs in through the browser the
first time). `npm run preview:worker` serves the build locally on the Workers runtime.

## Ideas

- Use a vision model to classify the object and pick the build mode or a depth profile.
- Estimate depth from a single photo for true 3D shapes instead of silhouettes.
- Show supports for overhangs, and add a time-lapse camera mode.
- Record the print as a video or GIF.
