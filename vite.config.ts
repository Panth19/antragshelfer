import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  build: { outDir: '../dist/public', emptyOutDir: true },
  server: { port: 5174, proxy: { '/api': 'http://localhost:3100' } },
});
