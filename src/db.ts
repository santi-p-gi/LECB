// Base de datos local del navegador (IndexedDB).
// Los libros del usuario se guardan aquí y NUNCA se suben a ningún servidor.
import { openDB, type DBSchema } from 'idb';

// Datos de cada libro que mostramos en la biblioteca.
export interface BookMeta {
  id: string;
  title: string;
  author: string;
  cover: Blob | null; // imagen de portada
  addedAt: number; // fecha en que se importó (milisegundos)
  lastOpenedAt: number | null;
  location: string | null; // posición de lectura (CFI, el "marcapáginas" de los EPUB)
  progress: number; // de 0 a 1
}

// Guardamos el archivo EPUB aparte para que listar la biblioteca sea liviano.
interface LibraryDB extends DBSchema {
  books: { key: string; value: BookMeta };
  files: { key: string; value: { id: string; data: ArrayBuffer } };
}

const dbPromise = openDB<LibraryDB>('biblioteca', 1, {
  upgrade(db) {
    db.createObjectStore('books', { keyPath: 'id' });
    db.createObjectStore('files', { keyPath: 'id' });
  },
});

export async function getAllBooks(): Promise<BookMeta[]> {
  const books = await (await dbPromise).getAll('books');
  // Primero los leídos más recientemente, después los recién importados.
  return books.sort(
    (a, b) => (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt),
  );
}

export async function getBook(id: string) {
  return (await dbPromise).get('books', id);
}

export async function getBookFile(id: string) {
  const file = await (await dbPromise).get('files', id);
  return file?.data;
}

export async function addBook(meta: BookMeta, data: ArrayBuffer) {
  const db = await dbPromise;
  const tx = db.transaction(['books', 'files'], 'readwrite');
  await Promise.all([
    tx.objectStore('books').put(meta),
    tx.objectStore('files').put({ id: meta.id, data }),
    tx.done,
  ]);
}

export async function updateBook(id: string, changes: Partial<BookMeta>) {
  const db = await dbPromise;
  const book = await db.get('books', id);
  if (book) await db.put('books', { ...book, ...changes });
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
