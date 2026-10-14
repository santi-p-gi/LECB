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
  const url = new URL(pedido.url);
  // Un libro compartido desde otra app (Compartir → LECB).
  if (pedido.method === 'POST' && url.origin === self.location.origin && url.pathname === '/compartir') {
    evento.respondWith(recibirCompartidos(pedido));
    return;
  }
  if (pedido.method !== 'GET') return; // solo guardamos lecturas

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

/* ---------- 4. Avisos de lectura (notificaciones) ---------- */
// El servidor (avisos.lecb.ar) solo "despierta" al dispositivo: el aviso llega vacío. Acá se
// pregunta qué clima motivó el aviso, se mira en la biblioteca local si hay un libro empezado
// y se arma el mensaje. Así el servidor nunca sabe qué lee nadie.
const URL_AVISOS = '__AVISOS__';

const FRASES = {
  lluvia: {
    titulo: '🌧️ Día de lluvia',
    nuevo: ['¿Qué mejor que un buen libro para acompañar esta lluvia? ¿Y si buscás uno nuevo?'],
    seguir: ['No hay mejor compañía para un libro que esta lluvia. ¿Seguimos con «{libro}»? Vas por el {avance}.'],
  },
  sol: {
    titulo: '☀️ Día de sol',
    nuevo: ['Este hermoso día de sol amerita un buen libro. ¿Qué te parece buscar uno nuevo?'],
    seguir: ['Qué lindo es leer bajo los rayos del sol. ¿Querés seguir con «{libro}»?'],
  },
  frio: {
    titulo: '🥶 Hace frío',
    nuevo: ['Con este frío no dan ganas de salir. ¿Buscamos un libro nuevo para pasar el rato?'],
    seguir: ['¿Qué mejor para este frío que una manta, un café y un buen libro? ¿Seguís con «{libro}»?'],
  },
  calor: {
    titulo: '🔥 Hace calor',
    nuevo: ['Con este calor, nada mejor que la sombra y un buen libro. ¿Buscamos uno nuevo?'],
    seguir: ['Hace mucho calor: buen momento para leer a la sombra. ¿Seguís con «{libro}»?'],
  },
  generica: {
    titulo: '📚 LECB',
    nuevo: ['Hace unos días que no leés. ¿Buscamos tu próximo libro?'],
    seguir: [
      'Hace unos días que no leés. ¿Seguimos con «{libro}»?',
      'Tus libros te extrañan, y seguro que vos a ellos. ¿Querés seguir con «{libro}»?',
    ],
  },
};

self.addEventListener('push', (evento) => {
  evento.waitUntil(mostrarAviso());
});

async function mostrarAviso() {
  let tipo = 'generica';
  try {
    const suscripcion = await self.registration.pushManager.getSubscription();
    const r = await fetch(`${URL_AVISOS}/ultimo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: suscripcion?.endpoint }),
    });
    const datos = await r.json();
    if (FRASES[datos.tipo]) tipo = datos.tipo;
  } catch {
    // sin conexión al servidor: va la genérica
  }
  const libro = await libroEmpezado().catch(() => null);
  const frases = FRASES[tipo];
  const opciones = libro ? frases.seguir : frases.nuevo;
  const texto = opciones[Math.floor(Math.random() * opciones.length)]
    .replace('{libro}', libro?.title ?? '')
    .replace('{avance}', libro ? `${Math.round(libro.progress * 100)} %` : '');
  await self.registration.showNotification(frases.titulo, {
    body: texto,
    icon: '/iconos/icono-192.png',
    tag: 'lecb-aviso', // si llega otro, reemplaza al anterior en vez de acumularse
    data: { url: libro ? `/#/leer/${libro.id}` : '/#conseguir' },
  });
}

// El libro que el lector tiene empezado: abierto en los últimos 60 días y sin terminar.
function libroEmpezado() {
  return new Promise((ok, mal) => {
    const pedido = indexedDB.open('biblioteca');
    pedido.onerror = () => mal(pedido.error);
    pedido.onsuccess = () => {
      const db = pedido.result;
      if (!db.objectStoreNames.contains('books')) return ok(null);
      const todos = db.transaction('books').objectStore('books').getAll();
      todos.onerror = () => mal(todos.error);
      todos.onsuccess = () => {
        const hace60 = Date.now() - 60 * 24 * 3600 * 1000;
        const empezados = todos.result
          .filter((b) => b.lastOpenedAt && b.lastOpenedAt > hace60 && b.progress > 0.01 && b.progress < 0.97)
          .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
        ok(empezados[0] ?? null);
        db.close();
      };
    };
  });
}

// Al tocar el aviso: abre el libro (o la sección para conseguir libros), en LECB si ya estaba abierta.
self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  const destino = new URL(evento.notification.data?.url ?? '/', self.location.origin).href;
  evento.waitUntil(
    (async () => {
      const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const abierta = ventanas.find((v) => new URL(v.url).origin === self.location.origin);
      if (abierta) {
        await abierta.focus();
        return abierta.navigate(destino);
      }
      return self.clients.openWindow(destino);
    })(),
  );
});

// Cuando alguien comparte un EPUB o PDF con LECB (desde WhatsApp, el mail, las descargas…),
// Android "envía" el archivo a /compartir. No va a ningún servidor: lo atiende este service
// worker, que lo deja en una caché del dispositivo y abre la app, que lo importa (ver App.tsx).
async function recibirCompartidos(pedido) {
  try {
    const datos = await pedido.formData();
    const archivos = datos.getAll('libros').filter((a) => typeof a !== 'string');
    const cache = await caches.open('lecb-compartidos');
    await Promise.all(
      archivos.map((a, i) =>
        cache.put(
          `/compartidos/${Date.now()}-${i}`,
          new Response(a, {
            headers: { 'content-type': a.type || 'application/octet-stream', 'x-nombre': encodeURIComponent(a.name || 'libro') },
          }),
        ),
      ),
    );
  } catch {
    // si algo falla, la app abre igual (sin libro nuevo)
  }
  return Response.redirect('/?compartido=1', 303);
}

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
