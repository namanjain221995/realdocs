import path from 'node:path';
import { defineConfig } from 'vite';

// Demo and browser-check harness of the editor package.
//   dev:      pnpm --filter @realtimedocs/editor run demo
//   checked:  pnpm --filter @realtimedocs/editor run demo:build && … run demo:preview
// Bound to loopback on a fixed port; `/p/*` and `/control` are proxied to the
// fixture server (demo/server.ts) so the page, the API, the asset URLs and the
// WebSocket share one origin, as they do in production.
const FIXTURE = `http://127.0.0.1:${process.env.RD_DEMO_SERVER_PORT ?? 4421}`;
const proxy = {
  '/p': { target: FIXTURE, ws: true, changeOrigin: false },
  '/control': { target: FIXTURE, changeOrigin: false },
};

export default defineConfig({
  root: import.meta.dirname,
  clearScreen: false,
  resolve: {
    // The profiling build of React DOM keeps <Profiler> working in a
    // production bundle, so the harness can count React commits per keystroke.
    alias: { 'react-dom/client': 'react-dom/profiling' },
  },
  server: { host: '127.0.0.1', port: 4420, strictPort: true, proxy },
  preview: { host: '127.0.0.1', port: 4420, strictPort: true, proxy },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      // index.html carries the strict policy; nocsp.html is the same page without one.
      input: {
        index: path.join(import.meta.dirname, 'index.html'),
        nocsp: path.join(import.meta.dirname, 'nocsp.html'),
      },
    },
  },
});
