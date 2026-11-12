// Recordatorio de copia de seguridad: los libros viven solo en este navegador, así que cada
// 3 libros leídos (desde la última copia o el último «Ahora no») sugerimos hacer una.
import type { BookMeta } from './db';

const CLAVE = 'lecb-copia-recordatorio'; // cuántos libros leídos había en la última copia / «Ahora no»
const CADA = 3;

const librosLeidos = (books: BookMeta[]) => books.filter((b) => b.lastOpenedAt !== null).length;

function leerBase() {
  try {
    return Number(localStorage.getItem(CLAVE)) || 0;
  } catch {
    return Infinity; // sin almacenamiento no podemos llevar la cuenta: mejor no insistir
  }
}

export function debeRecordarCopia(books: BookMeta[]) {
  return librosLeidos(books) - leerBase() >= CADA;
}

// Después de una copia o de un «Ahora no»: el próximo recordatorio, dentro de 3 libros más.
export function posponerRecordatorio(books: BookMeta[]) {
  try {
    localStorage.setItem(CLAVE, String(librosLeidos(books)));
  } catch {
    // ignorado
  }
}
