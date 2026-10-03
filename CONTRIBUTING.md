# Contributing

Thanks for taking a look! Bug reports, ideas and pull requests are welcome.

## Getting set up

You need Node.js 22.12 or newer (`.nvmrc` pins the major version) and npm.

```sh
git clone https://github.com/andrewhiz/virtual3dprinter.git
cd virtual3dprinter
npm ci
npm run dev
```

Before opening a pull request, run the same checks CI runs:

```sh
npm run typecheck
npm test
npm run build
```

## Conventions

- TypeScript strict mode, no `any`.
- `analyze.ts`, `model.ts`, `meshModel.ts`, `slicer.ts`, `infill.ts`, `toolpath.ts`, `playback.ts`,
  `palette.ts` and `gcode.ts` stay pure and DOM-free so the tests run in Node. Add a test there when you change behaviour.
- Keep everything same-origin. The site ships a strict Content-Security-Policy
  (`public/_headers`), so new fonts, images or scripts must be bundled rather than loaded from a CDN.
  If you change the headers, update the copies in `docs/DEPLOYMENT.md` too.
- Phones matter: check heavier rendering features against `src/printers/quality.ts` (low-power and
  safe modes).
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `ci:` and so on).

## Reporting security issues

See [SECURITY.md](SECURITY.md). Please don't file public issues for vulnerabilities.
