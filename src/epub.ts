// Lee un archivo EPUB y saca el título, el autor, la portada y su color.
import ePub from 'epubjs';
import { colorDePortada, colorDeRespaldo } from './colores';

export const TAMANO_MAXIMO = 100 * 1024 * 1024; // 100 MB

export async function readEpubInfo(data: ArrayBuffer) {
  const book = ePub(data);
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
    book.destroy();
  }
}
