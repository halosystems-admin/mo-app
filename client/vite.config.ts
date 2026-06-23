import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '');
  const apiPort = env.PORT || '3001';

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      strictPort: false,
      fs: {
        // Allow importing from ../shared (monorepo-style).
        allow: [path.resolve(__dirname, '..')],
      },
      proxy: {
        '/api': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
        '/ws': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
