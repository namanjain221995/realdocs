import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Kitchen-sink page for the UI kit. Start it with `pnpm --filter @realtimedocs/ui run demo`.
// Bound to loopback on a fixed port so screenshots and manual checks agree on the address.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 5391,
    strictPort: true,
  },
});
