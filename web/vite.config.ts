/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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

/**
 * Setzt im Service Worker eine Build-Version und die Liste aller JS/CSS-Dateien,
 * damit Seiten-Chunks offline verfügbar sind und alte Caches nach Deploys verschwinden.
 */
function serviceWorker(): Plugin {
  let dateien: string[] = [];
  return {
    name: 'service-worker-version',
    apply: 'build',
    generateBundle(_, bundle) {
      dateien = Object.keys(bundle)
        .filter((f) => f.startsWith('assets/') && /\.(js|css)$/.test(f))
        .map((f) => '/' + f)
        .sort();
    },
    closeBundle() {
      const pfad = resolve(outDir, 'sw.js');
      const version = createHash('sha256').update(dateien.join('\n')).digest('hex').slice(0, 12);
      const sw = readFileSync(pfad, 'utf8')
        .replace("const VERSION = 'dev';", `const VERSION = '${version}';`)
        .replace('const VORAB = [];', `const VORAB = ${JSON.stringify(dateien)};`);
      writeFileSync(pfad, sw);
    },
  };
}

export default defineConfig({
  plugins: [react(), gitkeep(), serviceWorker()],
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
