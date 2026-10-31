import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Share PORT with the server through the repo-root .env.
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '');
  const backend = `127.0.0.1:${env.PORT || 8787}`;
  return {
    plugins: [react()],
    resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
    server: {
      port: 5173,
      proxy: {
        '/api': `http://${backend}`,
        '/ws': { target: `ws://${backend}`, ws: true },
      },
    },
  };
});
