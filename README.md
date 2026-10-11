# LECB

**Web:** https://lecb.ar

Web que se encarga de leer archivos EPUB y los transforma en libros para leer desde el celular o pc.

Los libros que sube cada persona se guardan **solo en su navegador** (IndexedDB): nunca se envían a un servidor.

## Cómo correrlo

Necesitás [Node.js](https://nodejs.org/) instalado.

```bash
npm install     # solo la primera vez
npm run dev     # abre http://localhost:5173
npm run build   # versión final en la carpeta dist/
```

## Estructura

| Archivo | Qué hace |
|---|---|
| `src/App.tsx` | Decide si se ve la biblioteca o el lector; importa los libros. |
| `src/components/Library.tsx` | Inicio, "Seguir leyendo", estantería y zona para subir. |
| `src/components/Reader.tsx` | El lector: libro a doble página, índice, marcadores y ajustes (usa epub.js). |
| `src/db.ts` | Guarda libros, progreso y marcadores en el navegador. |
| `src/preferencias.ts` | Temas, tipografías y tamaños del lector. |
| `maquetas/` | Diseños de referencia (inicio y lector). |
| `public/libros/` | Libro de muestra de dominio público (Don Quijote, Project Gutenberg). |

## App instalable (PWA)

LECB se puede instalar como app y funciona sin internet. Las piezas son:

| Archivo | Qué hace |
|---|---|
| `public/manifest.webmanifest` | Describe la app: nombre, íconos, colores, que abra en pantalla completa. |
| `public/iconos/` | Íconos de la app (el "maskable" es para Android, que recorta su propia forma). |
| `src/service-worker.js` | Guarda la web y las tipografías en el dispositivo para que funcione sin internet. Al construir, `vite.config.ts` lo copia como `/sw.js` con un número de versión nuevo. |
| `src/instalacion.ts` | Registra el service worker (solo en la versión final) y maneja el botón "Instalar app". |

Para verlo: `npm run build` y luego `npx vite preview`, abrir la web, **F12 → pestaña Application**: ahí aparecen el manifiesto, el service worker y lo guardado en "Cache storage". En la pestaña Network se puede marcar "Offline" para probar sin internet.

Para instalarla en el celular, la web tiene que estar publicada con HTTPS.
