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
    generateBundle(_opciones, bundle) {
      const version = Date.now().toString(36);
      // Todo el código de la web, también las partes que se cargan recién al usarse (los lectores):
      // el service worker las guarda al instalarse, para que funcionen sin internet.
      const codigo = Object.keys(bundle).filter((f) => /^assets\/.+\.(m?js|css)$/.test(f)).map((f) => `/${f}`);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        // Se reemplaza el texto entre comillas simples del código ('__VERSION__'), no el del comentario.
        source: readFileSync('src/service-worker.js', 'utf8')
          .replace("'__VERSION__'", `'${version}'`)
          .replace("'__CODIGO__'", JSON.stringify(codigo))
          // Dirección del servidor de avisos (para probar en la compu: VITE_AVISOS_URL=http://localhost:8787)
          .replace("'__AVISOS__'", `'${process.env.VITE_AVISOS_URL ?? 'https://avisos.lecb.ar'}'`),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
});
