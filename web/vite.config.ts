/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = resolve(import.meta.dirname, '../internal/web/dist');

/** Hält internal/web/dist/.gitkeep nach jedem Build vorhanden (go:embed braucht das Verzeichnis). */
function gitkeep(): Plugin {
  return {
    name: 'gitkeep',
    apply: 'build',
    closeBundle() {
      writeFileSync(resolve(outDir, '.gitkeep'), '');
    },
  };
}

export default defineConfig({
  plugins: [react(), gitkeep()],
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    // Keine Inline-Assets als data:-Skripte; Bilder als data: sind per CSP erlaubt.
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
  },
  worker: { format: 'es' },
  server: {
    proxy: { '/api': 'http://localhost:8080' },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
