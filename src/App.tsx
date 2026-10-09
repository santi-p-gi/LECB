// Componente principal: decide si mostramos la biblioteca o el lector.
import { useEffect, useState } from 'react';
import { addBook, deleteBook, getAllBooks, type BookMeta } from './db';
import { readEpubInfo } from './epub';
import Library from './components/Library';
import Reader from './components/Reader';

export default function App() {
  // "Estado": datos que, cuando cambian, hacen que React vuelva a dibujar la pantalla.
  const [books, setBooks] = useState<BookMeta[]>([]);
  const [openBookId, setOpenBookId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const refreshBooks = () => getAllBooks().then(setBooks);

  // Se ejecuta una vez al cargar la página: lee la biblioteca guardada.
  useEffect(() => {
    refreshBooks();
  }, []);

  async function handleImport(files: File[]) {
    setImporting(true);
    const failed: string[] = [];

    for (const file of files) {
      try {
        const data = await file.arrayBuffer();
        // Le pasamos una copia a epub.js para que el original quede intacto al guardarlo.
        const info = await readEpubInfo(data.slice(0));
        await addBook(
          {
            id: crypto.randomUUID(),
            ...info,
            addedAt: Date.now(),
            lastOpenedAt: null,
            location: null,
            progress: 0,
          },
          data,
        );
      } catch (err) {
        console.error(err);
        failed.push(file.name);
      }
    }

    setImporting(false);
    await refreshBooks();
    if (failed.length) {
      alert(`No se pudieron importar estos archivos:\n${failed.join('\n')}`);
    }
  }

  async function handleDelete(id: string) {
    await deleteBook(id);
    await refreshBooks();
  }

  function handleCloseReader() {
    setOpenBookId(null);
    refreshBooks(); // para ver el progreso actualizado
  }

  if (openBookId) {
    return <Reader bookId={openBookId} onClose={handleCloseReader} />;
  }

  return (
    <Library
      books={books}
      importing={importing}
      onImport={handleImport}
      onOpen={setOpenBookId}
      onDelete={handleDelete}
    />
  );
}
