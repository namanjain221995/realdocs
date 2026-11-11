import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Renderer build: three static pages served from app://realtimedocs/ by the
// main process. There is no dev server — development and production load the
// same packaged files under the same Content-Security-Policy.
const rendererRoot = path.resolve(import.meta.dirname, 'src/renderer');

export default defineConfig({
  root: rendererRoot,
  base: '/',
  plugins: [react()],
  // The only public file is boot.js: a classic script each page loads before
  // its module bundle (see src/renderer/public/boot.js).
  publicDir: path.join(rendererRoot, 'public'),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/renderer'),
    emptyOutDir: true,
    target: 'esnext',
    // The CSP has `font-src 'self'` and no `data:` for fonts, and inline
    // scripts are forbidden: every asset is a separate file under /assets/.
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    sourcemap: false,
    rollupOptions: {
      input: {
        panel: path.join(rendererRoot, 'panel.html'),
        settings: path.join(rendererRoot, 'settings.html'),
        probe: path.join(rendererRoot, 'probe.html'),
      },
    },
  },
});
