// Lee un archivo EPUB y saca el título, el autor y la portada.
import ePub from 'epubjs';

export async function readEpubInfo(data: ArrayBuffer) {
  const book = ePub(data);
  try {
    const metadata = await book.loaded.metadata;

    let cover: Blob | null = null;
    const coverUrl = await book.coverUrl();
    if (coverUrl) cover = await (await fetch(coverUrl)).blob();

    return {
      title: metadata.title || 'Sin título',
      author: metadata.creator || 'Autor desconocido',
      cover,
    };
  } finally {
    book.destroy();
  }
}
