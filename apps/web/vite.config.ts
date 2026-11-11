import react from '@vitejs/plugin-react';
import { defineConfig, type ProxyOptions } from 'vite';

/** Backend the dev and preview servers forward to. The browser only ever sees one origin. */
const API_TARGET = process.env.RD_API_TARGET ?? 'http://127.0.0.1:4310';

/**
 * `RD_API_PROXY=off` removes the proxy. The browser tests use it so that a
 * request the mock did not answer can never reach a real server by accident.
 */
const proxy: Record<string, ProxyOptions> | undefined =
  process.env.RD_API_PROXY === 'off'
    ? undefined
    : {
        '/api': { target: API_TARGET, changeOrigin: false },
        '/collab': { target: API_TARGET, changeOrigin: false, ws: true },
      };

/**
 * The Content-Security-Policy the backend sends with the built app.
 * `vite preview` sends the same header, so the production bundle is exercised
 * under the real policy: the browser tests run against the preview server and
 * fail on any violation. `vite dev` does not send it, because the React
 * fast-refresh preamble is an inline script, which this policy correctly forbids.
 */
const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' ws: wss:",
].join('; ');

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4311,
    strictPort: true,
    proxy,
  },
  preview: {
    host: '127.0.0.1',
    port: 4311,
    strictPort: true,
    proxy,
    headers: {
      'Content-Security-Policy': PRODUCTION_CSP,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Fonts must stay files: the production policy has `font-src 'self'` (no `data:`).
    assetsInlineLimit: 0,
    // The editor is a separate lazy chunk and is expected to be large.
    chunkSizeWarningLimit: 900,
  },
});
