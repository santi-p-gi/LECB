// Abrir archivos EPUB y leer sus datos (título, autor, portada).
import ePub, { EpubCFI, type Book } from 'epubjs';
import { colorDePortada, colorDeRespaldo } from './colores';

interface SeccionSerializada {
  url: string;
  output: string;
}

// Abre un EPUB sin copiar todas sus imágenes de entrada.
// Por defecto epub.js prepara TODAS las imágenes del libro al abrirlo, lo que en un
// manual de 300 MB duplica la memoria usada. Así, cada imagen se prepara recién
// cuando se muestra el capítulo que la usa.
export function abrirEpub(data: ArrayBuffer): Book {
  const book = ePub(data, { replacements: 'none' });

  book.spine.hooks.serialize.register(async (_: string, seccion: SeccionSerializada) => {
    const recursos = book.resources as unknown as {
      urls: string[];
      relativeTo(url: string): string[];
    };
    const relativas = recursos.relativeTo(seccion.url);
    const usadas = relativas
      .map((relativa, i) => ({ relativa, absoluta: book.resolve(recursos.urls[i]) }))
      .filter(({ relativa }) => relativa && seccion.output.includes(relativa));

    const urls = await Promise.all(
      usadas.map(({ absoluta }) => book.archive.createUrl(absoluta, { base64: false }).catch(() => null)),
    );

    // Leemos seccion.output recién ahora (después de esperar), por si otro paso lo cambió.
    let html = seccion.output;
    usadas.forEach(({ relativa }, i) => {
      const url = urls[i];
      if (url) html = html.split(relativa).join(url);
    });
    seccion.output = html;
  });

  return book;
}

export interface SeccionSpine {
  index: number;
  url: string;
  cfiBase: string;
  linear: boolean;
}

export function secciones(book: Book) {
  const lista: SeccionSpine[] = [];
  book.spine.each((s: SeccionSpine) => lista.push(s));
  return lista;
}

// Lee un capítulo como copia aparte. epub.js, al terminar de usar un capítulo, lo "cierra";
// si el lector lo estaba mostrando en ese momento, se quedaba trabado (pasaba con libros grandes).
export const leerCapitulo = (book: Book, url: string) => book.load(url) as Promise<Document>;

// Calcula las "páginas" (cada `caracteres` letras) recorriendo el libro capítulo por capítulo.
// Devuelve false si se canceló a mitad de camino.
export async function calcularPaginas(book: Book, caracteres: number, cancelado: () => boolean) {
  const paginas = book.locations as unknown as {
    parse(contenido: Element, cfiBase: string, caracteres: number): string[];
    load(lista: string[]): string[];
  };
  let todas: string[] = [];
  for (const s of secciones(book)) {
    if (!s.linear) continue;
    if (cancelado()) return false;
    const doc = await leerCapitulo(book, s.url);
    todas = todas.concat(paginas.parse(doc.documentElement, s.cfiBase, caracteres));
    await new Promise((r) => setTimeout(r, 0)); // deja respirar a la página entre capítulo y capítulo
  }
  if (cancelado()) return false;
  paginas.load(todas);
  return true;
}

// Dónde empieza (CFI) cada entrada del índice. Muchos libros ponen varios capítulos
// en un mismo archivo, así que buscamos el ancla (#...) de cada uno dentro de su archivo.
export async function ubicarCapitulos(book: Book, entradas: { href: string; spine: number }[]) {
  const resultado: (string | null)[] = entradas.map(() => null);
  const porArchivo = new Map<number, number[]>();
  entradas.forEach((e, i) => {
    if (e.spine >= 0) porArchivo.set(e.spine, [...(porArchivo.get(e.spine) ?? []), i]);
  });
  for (const [spine, posiciones] of porArchivo) {
    const seccion = book.spine.get(spine) as unknown as SeccionSpine | undefined;
    if (!seccion) continue;
    try {
      const doc = await leerCapitulo(book, seccion.url);
      for (const i of posiciones) {
        const ancla = entradas[i].href.split('#')[1];
        const el = (ancla && doc.getElementById(decodeURIComponent(ancla))) || doc.body;
        if (el) resultado[i] = new EpubCFI(el, seccion.cfiBase).toString();
      }
    } catch {
      // si un archivo no se puede leer, esas entradas quedan sin posición
    }
  }
  return resultado;
}

export async function readEpubInfo(data: ArrayBuffer) {
  const book = abrirEpub(data);
  try {
    const metadata = await book.loaded.metadata;
    const title = metadata.title || 'Sin título';

    let cover: Blob | null = null;
    const coverUrl = await book.coverUrl();
    if (coverUrl) cover = await (await fetch(coverUrl)).blob();

    return {
      title,
      author: metadata.creator || 'Autor desconocido',
      cover,
      color: (cover && (await colorDePortada(cover))) || colorDeRespaldo(title),
    };
  } finally {
    // Esperamos a que epub.js termine de leer todo (por ejemplo el índice) antes de cerrarlo:
    // cerrarlo a mitad de camino producía un error.
    await book.ready.catch(() => {});
    book.destroy();
  }
}
