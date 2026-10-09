# LECB

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
