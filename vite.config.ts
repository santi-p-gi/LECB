import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Genera /sw.js (el service worker) a partir de src/service-worker.js con un número de
// versión nuevo en cada construcción. Así el navegador detecta que cambió, instala la
// versión nueva y borra la caché vieja.
function serviceWorker(): Plugin {
  return {
    name: 'lecb-service-worker',
    apply: 'build',
    generateBundle() {
      const version = Date.now().toString(36);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        // Se reemplaza el texto entre comillas simples del código ('__VERSION__'), no el del comentario.
        source: readFileSync('src/service-worker.js', 'utf8').replace("'__VERSION__'", `'${version}'`),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
});
