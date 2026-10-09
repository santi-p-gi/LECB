// Pantalla de la biblioteca: portadas de los libros + botón para importar.
import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { BookMeta } from '../db';

// "Props": los datos y funciones que App le pasa a este componente.
interface LibraryProps {
  books: BookMeta[];
  importing: boolean;
  onImport: (files: File[]) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

const isEpub = (file: File) => file.name.toLowerCase().endsWith('.epub');

export default function Library({ books, importing, onImport, onOpen, onDelete }: LibraryProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function importFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? []).filter(isEpub);
    if (files.length) onImport(files);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    importFiles(e.dataTransfer.files);
  }

  return (
    <div
      className={`library ${dragging ? 'library--dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <header className="library__header">
        <h1>Mi biblioteca</h1>
        <button
          className="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
        >
          {importing ? 'Importando…' : '+ Importar libro'}
        </button>
        {/* Input de archivo oculto: el botón de arriba lo abre */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".epub,application/epub+zip"
          multiple
          hidden
          onChange={(e) => {
            importFiles(e.target.files);
            e.target.value = ''; // permite volver a elegir el mismo archivo
          }}
        />
      </header>

      {books.length === 0 ? (
        <div className="library__empty">
          <p>Todavía no tienes libros.</p>
          <p>Importa un archivo EPUB o arrástralo a esta ventana.</p>
          <p className="library__note">Tus libros se guardan solo en este navegador.</p>
        </div>
      ) : (
        <ul className="library__grid">
          {books.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              onOpen={() => onOpen(book.id)}
              onDelete={() => {
                if (confirm(`¿Eliminar "${book.title}" de tu biblioteca?`)) onDelete(book.id);
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function BookCard({ book, onOpen, onDelete }: { book: BookMeta; onOpen: () => void; onDelete: () => void }) {
  // La portada está guardada como Blob; creamos una URL temporal para poder mostrarla
  // y la liberamos cuando el componente desaparece.
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!book.cover) return;
    const url = URL.createObjectURL(book.cover);
    setCoverUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [book.cover]);

  const percent = Math.round(book.progress * 100);

  return (
    <li className="book-card">
      <button className="book-card__cover" onClick={onOpen} title={`Leer "${book.title}"`}>
        {coverUrl ? (
          <img src={coverUrl} alt="" />
        ) : (
          <span className="book-card__placeholder">{book.title}</span>
        )}
      </button>
      <div className="book-card__info">
        <strong className="book-card__title">{book.title}</strong>
        <span className="book-card__author">{book.author}</span>
        <div className="progress" aria-label={`Leído ${percent}%`}>
          <div className="progress__bar" style={{ width: `${percent}%` }} />
        </div>
        <div className="book-card__footer">
          <span>{percent > 0 ? `${percent}%` : 'Sin empezar'}</span>
          <button className="link-button" onClick={onDelete}>
            Eliminar
          </button>
        </div>
      </div>
    </li>
  );
}
