import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true, // Nginx (M1-14b) forwards to this exact port.
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/testSetup.ts'],
    css: false,
  },
});
