import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Copies the Content-Security-Policy from public/_headers into a <meta> tag, so hosts that can't
 * send custom headers (GitHub Pages, S3, a plain file server) still get it. Browsers ignore
 * frame-ancestors in a meta policy, and upgrade-insecure-requests would break plain-HTTP LAN
 * hosting, so both are left to the real header.
 */
function cspMeta(): Plugin {
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml() {
      const line = readFileSync('public/_headers', 'utf8')
        .split('\n')
        .find((l) => l.trim().startsWith('Content-Security-Policy:'));
      if (!line) throw new Error('public/_headers has no Content-Security-Policy line');
      const policy = line
        .slice(line.indexOf(':') + 1)
        .split(';')
        .map((d) => d.trim())
        .filter((d) => d && !/^(frame-ancestors|upgrade-insecure-requests)\b/.test(d))
        .join('; ');
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }];
    },
  };
}

// `vite build --mode single` inlines everything into one self-contained HTML file. Its inline
// scripts can't satisfy the CSP, so that build skips the meta policy.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [cspMeta()],
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist' },
}));
