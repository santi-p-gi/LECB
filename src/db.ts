// Base de datos local del navegador (IndexedDB).
// Los libros del usuario se guardan aquí y NUNCA se suben a ningún servidor.
import { openDB, type DBSchema } from 'idb';
import { colorDeRespaldo } from './colores';

export interface Marcador {
  cfi: string; // posición exacta en el libro
  etiqueta: string; // capítulo donde está
  pagina: number | null;
  creado: number;
}

export type ColorSubrayado = 'amarillo' | 'verde' | 'azul' | 'rosa';

export interface Subrayado {
  id: string;
  cfi: string; // rango exacto del texto subrayado
  texto: string;
  color: ColorSubrayado;
  nota: string | null;
  etiqueta: string; // capítulo donde está
  pagina: number | null;
  creado: number;
}

// Datos de cada libro que mostramos en la biblioteca.
export interface BookMeta {
  id: string;
  formato: 'epub' | 'pdf';
  title: string;
  author: string;
  cover: Blob | null; // imagen de portada
  color: string; // color del lomo y de la tapa generada
  size: number; // tamaño del archivo en bytes (define el grosor del lomo)
  addedAt: number; // fecha en que se importó (milisegundos)
  lastOpenedAt: number | null;
  location: string | null; // posición de lectura (CFI, el "marcapáginas" de los EPUB)
  progress: number; // de 0 a 1
  page: number | null; // página aproximada donde quedó
  pages: number | null; // total de páginas aproximadas
  excerpt: string | null; // frase donde quedó ("Te quedaste en…")
  locations: string | null; // páginas calculadas, guardadas para no recalcularlas
  capitulos: (string | null)[] | null; // dónde empieza cada entrada del índice (CFI)
  bookmarks: Marcador[];
  highlights: Subrayado[];
}

// Guardamos el archivo EPUB aparte para que listar la biblioteca sea liviano.
interface LibraryDB extends DBSchema {
  books: { key: string; value: BookMeta };
  // El archivo se guarda como Blob: el navegador lo escribe a disco sin cargarlo entero
  // en memoria. Los libros importados en la Fase 1 quedaron como ArrayBuffer.
  files: { key: string; value: { id: string; data: Blob | ArrayBuffer } };
}

const dbPromise = openDB<LibraryDB>('biblioteca', 1, {
  upgrade(db) {
    db.createObjectStore('books', { keyPath: 'id' });
    db.createObjectStore('files', { keyPath: 'id' });
  },
});

// Los libros importados en la Fase 1 no tienen los campos nuevos: los completamos.
function completar(book: Partial<BookMeta> & { id: string; title: string }): BookMeta {
  return {
    formato: 'epub',
    author: 'Autor desconocido',
    cover: null,
    color: colorDeRespaldo(book.title),
    size: 0,
    addedAt: Date.now(),
    lastOpenedAt: null,
    location: null,
    progress: 0,
    page: null,
    pages: null,
    excerpt: null,
    locations: null,
    capitulos: null,
    bookmarks: [],
    highlights: [],
    ...book,
  };
}

export async function getAllBooks(): Promise<BookMeta[]> {
  const books = (await (await dbPromise).getAll('books')).map(completar);
  // Primero los leídos más recientemente, después los recién importados.
  return books.sort(
    (a, b) => (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt),
  );
}

export async function getBook(id: string) {
  const book = await (await dbPromise).get('books', id);
  return book && completar(book);
}

// Devuelve el archivo listo para epub.js (que necesita un ArrayBuffer).
export async function getBookFile(id: string) {
  const file = await (await dbPromise).get('files', id);
  if (!file) return undefined;
  return file.data instanceof Blob ? file.data.arrayBuffer() : file.data;
}

export async function addBook(meta: BookMeta, data: Blob) {
  const db = await dbPromise;
  const tx = db.transaction(['books', 'files'], 'readwrite');
  await Promise.all([
    tx.objectStore('books').put(meta),
    tx.objectStore('files').put({ id: meta.id, data }),
    tx.done,
  ]);
}

// Leer y escribir dentro de la misma transacción: si llegan dos cambios a la vez
// (por ejemplo la página y la frase), el segundo no pisa al primero con datos viejos.
export async function updateBook(id: string, changes: Partial<BookMeta>) {
  const tx = (await dbPromise).transaction('books', 'readwrite');
  const book = await tx.store.get(id);
  if (book) await tx.store.put({ ...completar(book), ...changes });
  await tx.done;
}

export async function deleteBook(id: string) {
  const db = await dbPromise;
  const tx = db.transaction(['books', 'files'], 'readwrite');
  await Promise.all([
    tx.objectStore('books').delete(id),
    tx.objectStore('files').delete(id),
    tx.done,
  ]);
}
