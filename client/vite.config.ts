import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const serverUrl = process.env.VITE_DEV_SERVER_PROXY ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/socket.io': { target: serverUrl, ws: true },
      '/api': serverUrl,
      '/health': serverUrl,
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
