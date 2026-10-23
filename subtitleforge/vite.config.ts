import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// The renderer is served from disk inside Electron, so every asset path must be
// relative: an absolute '/assets/...' would resolve against the filesystem root.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    sourcemap: true,
    target: 'chrome128',
    rollupOptions: {
      output: {
        // Splitting React out keeps the main chunk small enough that the window
        // paints before the editor's heavier code has parsed.
        manualChunks: { react: ['react', 'react-dom'] },
      },
    },
  },
  server: { port: 5273, strictPort: true },
});
