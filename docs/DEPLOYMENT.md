# Deploying Virtual 3D Printer

The app is a static site: `npm run build` writes plain HTML, JS, CSS and font files to `dist/`.
There is no server code, database or environment variable, so any static host works. The build
uses relative paths, so it also works from a subpath such as `https://you.github.io/virtual3dprinter/`.

| Option | Good for | Security headers | Effort |
| --- | --- | --- | --- |
| [Cloudflare Workers](#cloudflare-workers) | The reference setup (this repo) | Full, from `public/_headers` | Low |
| [Netlify](#netlify) | Git-connected hosting | Full, from `public/_headers` | Low |
| [Vercel](#vercel) | Git-connected hosting | Full, via `vercel.json` | Low |
| [GitHub Pages](#github-pages) | Free hosting next to the repo | CSP only (meta tag) | Low |
| [Docker + nginx](#docker--nginx) | Homelab, Raspberry Pi, any VPS | Full, via `nginx.conf` | Medium |
| [Caddy](#caddy) | Self-hosting with automatic HTTPS | Full, via `Caddyfile` | Low |
| [Apache](#apache) | Shared hosting | Full, via `.htaccess` | Low |
| [Any static host / S3](#any-other-static-host) | Object storage, CDNs | Depends on host | Low |
| [Single HTML file](#offline-single-file) | Offline use, sharing one file | None needed | None |

Every option starts the same way. You need Node.js 22.12+ and npm:

```sh
npm ci
npm run build   # typechecks, then writes dist/
```

## Security headers

`public/_headers` is the single source of truth for the headers the site should send. Cloudflare
and Netlify read it directly. For other servers, copy the values below and keep them in sync if
`public/_headers` changes.

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `no-referrer` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Cache-Control` (only `/assets/*`) | `public, max-age=31536000, immutable` |

**Built-in fallback:** the build also copies the CSP into a `<meta>` tag in `dist/index.html`, so
hosts that can't send headers still enforce it. Browsers ignore `frame-ancestors` in a meta tag,
so framing protection needs the real `X-Frame-Options` / CSP header.

**Plain HTTP on a LAN:** `upgrade-insecure-requests` makes the browser load assets over HTTPS. If
you serve the site over plain `http://` on something other than `localhost` (for example
`http://192.168.1.20` on a Raspberry Pi), remove that directive from your server's CSP, or the page
won't load. The meta-tag fallback already leaves it out.

---

## Cloudflare Workers

This is how the project's own site, [virtual3dprinter.onthejourney.online](https://virtual3dprinter.onthejourney.online/), deploys. See [README → Deploy](../README.md#deploy-cloudflare-workers).
In short: connect the repo under **Workers & Pages → Create → Import a repository** with build
command `npm run build` and deploy command `npx wrangler deploy`, or run `npm run deploy` from your
machine. Set `name` in `wrangler.jsonc` to your Worker's name.

## Netlify

Netlify supports the `_headers` file format natively, so nothing extra is needed.

1. **Add new site → Import an existing project** and pick your fork.
2. Build command `npm run build`, publish directory `dist`. Netlify reads the Node version from
   `.nvmrc`.

To keep these settings in the repo instead, add a `netlify.toml`:

```toml
[build]
  command = "npm run build"
  publish = "dist"
```

From the command line: `npm run build && npx netlify-cli deploy --dir=dist --prod`.

## Vercel

1. **Add New → Project** and import your fork. Vercel detects Vite. The output directory is `dist`.
2. Vercel doesn't read `_headers`, so add a `vercel.json` at the repo root:

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Content-Security-Policy", "value": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "no-referrer" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()" },
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
        { "key": "Cross-Origin-Resource-Policy", "value": "same-origin" }
      ]
    },
    {
      "source": "/assets/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    }
  ]
}
```

From the command line: `npx vercel --prod`.

## GitHub Pages

Free hosting at `https://<user>.github.io/<repo>/`. GitHub Pages can't set custom headers, so you
get the meta-tag CSP but not framing protection or `nosniff`. That's fine for a toy like this.

1. In the repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
2. Add `.github/workflows/pages.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: actions/configure-pages@v6
      - uses: actions/upload-pages-artifact@v5
        with:
          path: dist
      - id: deployment
        uses: actions/deploy-pages@v5
```

To match the rest of this repo's CI, pin each action to a commit SHA (see
`.github/workflows/ci-deploy.yml`). Dependabot will keep them current.

## Docker + nginx

Good for a homelab, a Raspberry Pi next to your real printer, or any VPS. Save these three files at
the repo root:

`Dockerfile`:

```dockerfile
# Build on Debian (not Alpine): the dev tooling ships glibc binaries.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
```

`.dockerignore`:

```
node_modules
dist
dist-single
.git
```

`nginx.conf`:

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # Remove upgrade-insecure-requests if you serve plain HTTP on a LAN address.
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()" always;
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Cross-Origin-Resource-Policy "same-origin" always;

    # Hashed file names never change. `expires` (unlike add_header) keeps the headers above.
    location /assets/ {
        expires 1y;
    }

    location / {
        try_files $uri $uri/ =404;
    }
}
```

Build and run:

```sh
docker build -t virtual3dprinter .
docker run -d --name virtual3dprinter -p 8080:80 --restart unless-stopped virtual3dprinter
# open http://localhost:8080
```

Put it behind a reverse proxy that terminates HTTPS (Caddy, Traefik, nginx-proxy-manager) for
anything exposed to the internet. Without Docker, copy `dist/` to the server and use the same
`server` block.

## Caddy

Caddy gets HTTPS certificates automatically. Copy `dist/` to the server, then add this `Caddyfile`:

```caddyfile
printer.example.com {
	root * /srv/virtual3dprinter
	encode zstd gzip
	file_server

	header {
		Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests"
		X-Content-Type-Options "nosniff"
		X-Frame-Options "DENY"
		Referrer-Policy "no-referrer"
		Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()"
		Cross-Origin-Opener-Policy "same-origin"
		Cross-Origin-Resource-Policy "same-origin"
	}
	header /assets/* Cache-Control "public, max-age=31536000, immutable"
}
```

## Apache

Upload the contents of `dist/` to your web root, and add this `.htaccess` next to `index.html`
(needs `mod_headers`):

```apache
<IfModule mod_headers.c>
  Header always set Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests"
  Header always set X-Content-Type-Options "nosniff"
  Header always set X-Frame-Options "DENY"
  Header always set Referrer-Policy "no-referrer"
  Header always set Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()"
  Header always set Cross-Origin-Opener-Policy "same-origin"
  Header always set Cross-Origin-Resource-Policy "same-origin"

  # Every JS, CSS and font file is in assets/ with a content hash in its name.
  <FilesMatch "\.(js|css|woff2?)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
</IfModule>
```

## Any other static host

Upload the contents of `dist/` (S3 + CloudFront, Azure Static Web Apps, Firebase Hosting, Render,
Surge, an old-school FTP host, and so on). Then, if the host allows it:

- Add the headers from [Security headers](#security-headers). Without them you still get the
  meta-tag CSP.
- Cache `assets/*` for a year, and leave `index.html` uncached (or short-cached) so new deploys
  show up.

To try the production build locally: `npm run preview` (http://localhost:4173).

## Offline single file

```sh
npm run build:single   # writes dist-single/index.html (about 1.2 MB)
```

Everything (code, styles, fonts) is inlined, so you can open the file straight from disk or send it
to someone. No server is needed. This build skips the meta-tag CSP, because inline scripts can't
satisfy it, and there is nothing to fetch anyway.
