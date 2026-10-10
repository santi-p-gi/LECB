// Service worker de LECB: hace que la web funcione sin internet.
//
// El navegador lo instala y lo deja corriendo "entre" la web e internet: cada archivo
// que la web pide pasa por acá, y decidimos si lo buscamos en internet o respondemos
// con la copia guardada en la caché.
//
// Ojo: los libros del usuario NO pasan por acá; ya están guardados en IndexedDB.

// Al construir la web (npm run build), "__VERSION__" se reemplaza por un código nuevo
// (ver vite.config.ts, que genera /sw.js a partir de este archivo). Así cada versión publicada tiene su propia caché y la vieja se borra.
const VERSION = '__VERSION__';
const CACHE_APP = `lecb-app-${VERSION}`;
const CACHE_FUENTES = 'lecb-fuentes'; // las tipografías no cambian entre versiones

// Archivos que se guardan apenas se instala.
const ESENCIALES = ['/', '/manifest.webmanifest', '/favicon.svg', '/iconos/icono-192.png', '/iconos/icono-512.png'];

/* ---------- 1. Instalación: guardar lo básico ---------- */
self.addEventListener('install', (evento) => {
  evento.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_APP);
      await cache.addAll(ESENCIALES);
      // El código de la web tiene nombres que cambian en cada versión (ej. index-D395hItp.js).
      // Leemos la página para saber cuáles pide y los guardamos ya: así funciona sin
      // internet desde la primera visita.
      const html = await (await cache.match('/')).text();
      const codigo = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
      await cache.addAll(codigo);
      // Lo mismo con las tipografías que pide la página (si falla, la app se instala igual).
      const fuentes = [...html.matchAll(/href="(https:\/\/fonts\.googleapis\.com\/[^"]+)"/g)].map((m) =>
        m[1].replace(/&amp;/g, '&'),
      );
      await guardarFuentes(fuentes).catch(() => {});
      // La versión nueva toma el control sin esperar a que se cierren las pestañas viejas.
      await self.skipWaiting();
    })(),
  );
});

/* ---------- 2. Activación: borrar cachés de versiones anteriores ---------- */
self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      const nombres = await caches.keys();
      await Promise.all(
        nombres.filter((n) => n.startsWith('lecb-app-') && n !== CACHE_APP).map((n) => caches.delete(n)),
      );
      // Empieza a atender también las pestañas que ya estaban abiertas.
      await self.clients.claim();
    })(),
  );
});

/* ---------- 3. Funcionamiento: atender cada pedido ---------- */
self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  if (pedido.method !== 'GET') return; // solo guardamos lecturas
  const url = new URL(pedido.url);

  // La página en sí: primero internet (para tener siempre la última versión).
  if (pedido.mode === 'navigate') {
    evento.respondWith(primeroInternet(pedido));
    return;
  }

  // El código, los íconos y el libro de muestra: primero caché.
  // Los nombres del código cambian con cada versión, así que una copia nunca queda vieja.
  const propio = url.origin === self.location.origin;
  if (propio && (/^\/(assets|iconos|libros)\//.test(url.pathname) || ESENCIALES.includes(url.pathname))) {
    evento.respondWith(primeroCache(pedido, CACHE_APP));
    return;
  }

  // Las tipografías de Google: primero caché (se guardan la primera vez que se usan).
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    evento.respondWith(primeroCache(pedido, CACHE_FUENTES));
  }
  // Todo lo demás pasa directo, como si no hubiera service worker.
});

// Guarda la hoja de estilos de Google Fonts y los archivos de letra del alfabeto latino
// (español incluido). Los demás alfabetos (cirílico, griego…) no se descargan.
async function guardarFuentes(urlsCss) {
  const cache = await caches.open(CACHE_FUENTES);
  for (const url of urlsCss) {
    const respuesta = await fetch(url);
    if (!respuesta.ok) continue;
    await cache.put(url, respuesta.clone());
    const css = await respuesta.text();
    const archivos = [...css.matchAll(/\/\* latin(?:-ext)? \*\/[^}]*?url\((https:[^)]+)\)/g)].map((m) => m[1]);
    await cache.addAll([...new Set(archivos)]);
  }
}

// Intenta internet; si no hay conexión, usa la última página guardada.
async function primeroInternet(pedido) {
  const cache = await caches.open(CACHE_APP);
  try {
    const respuesta = await fetch(pedido);
    // La web tiene una sola página (index.html); la guardamos siempre como "/".
    if (respuesta.ok) await cache.put('/', respuesta.clone());
    return respuesta;
  } catch {
    return (await cache.match('/', { ignoreVary: true })) || Response.error();
  }
}

// Responde con la copia guardada; si no existe, la descarga y la guarda para la próxima.
async function primeroCache(pedido, nombreCache) {
  const cache = await caches.open(nombreCache);
  // ignoreVary: el servidor marca algunas respuestas con "Vary: Origin" y la página las pide con
  // otro encabezado que cuando se guardaron; sin esto, la caché diría que no las tiene.
  const guardada = await cache.match(pedido, { ignoreVary: true });
  if (guardada) return guardada;
  const respuesta = await fetch(pedido);
  if (respuesta.ok) await cache.put(pedido, respuesta.clone());
  return respuesta;
}
