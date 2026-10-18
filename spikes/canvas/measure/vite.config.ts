import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: { input: { reactflow: resolve(__dirname, 'ReactFlow.html'), x6: resolve(__dirname, 'X6.html') } },
  },
});
