import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Provably Fair: экран проверки импортирует серверный код генерации исходов
// напрямую (server/src/fair/*.js), чтобы браузер пересчитывал ровно тот же алгоритм.
const fairDir = fileURLToPath(new URL('../server/src/fair', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@fair': fairDir } },
  server: {
    port: 5173,
    fs: { allow: ['.', fairDir] },
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
