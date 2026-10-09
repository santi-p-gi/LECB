// Pantalla de lectura: abre el EPUB guardado y lo muestra paginado con epub.js.
import { useEffect, useRef, useState } from 'react';
import ePub, { type Rendition } from 'epubjs';
import { getBook, getBookFile, updateBook } from '../db';

interface ReaderProps {
  bookId: string;
  onClose: () => void;
}

// Una entrada del índice del libro (capítulo).
interface TocItem {
  label: string;
  href: string;
  subitems?: TocItem[];
}

export default function Reader({ bookId, onClose }: ReaderProps) {
  // useRef guarda valores que no deben redibujar la pantalla al cambiar.
  const viewerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);

  const [title, setTitle] = useState('');
  const [toc, setToc] = useState<TocItem[]>([]);
  const [showToc, setShowToc] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Abre el libro cuando aparece el lector y lo cierra al salir.
  useEffect(() => {
    let cancelled = false;
    let book: ReturnType<typeof ePub> | null = null;

    async function open() {
      const [meta, data] = await Promise.all([getBook(bookId), getBookFile(bookId)]);
      if (cancelled) return;
      if (!meta || !data || !viewerRef.current) {
        setError('No se encontró el libro.');
        return;
      }
      setTitle(meta.title);
      setProgress(meta.progress);

      book = ePub(data);
      const currentBook = book;
      const rendition = book.renderTo(viewerRef.current, {
        width: '100%',
        height: '100%',
        flow: 'paginated',
        spread: 'auto', // dos páginas en pantallas anchas, una en el móvil
      });
      renditionRef.current = rendition;

      rendition.themes.default({
        body: { 'font-family': 'Georgia, "Times New Roman", serif', 'line-height': '1.6' },
      });

      // Cada vez que el usuario cambia de página guardamos la posición.
      rendition.on('relocated', (location: { start: { cfi: string } }) => {
        const cfi = location.start.cfi;
        const changes: { location: string; lastOpenedAt: number; progress?: number } = {
          location: cfi,
          lastOpenedAt: Date.now(),
        };
        if (currentBook.locations.length()) {
          changes.progress = currentBook.locations.percentageFromCfi(cfi);
          setProgress(changes.progress);
        }
        updateBook(bookId, changes);
      });

      // Las flechas también funcionan cuando el foco está dentro del libro (iframe).
      rendition.on('keydown', handleKey);

      await rendition.display(meta.location ?? undefined);
      if (cancelled) return;

      const navigation = await book.loaded.navigation;
      if (cancelled) return;
      setToc(navigation.toc as TocItem[]);

      // Dividimos el libro en "posiciones" para poder calcular el % leído.
      // Puede tardar unos segundos en libros grandes, por eso va al final.
      await book.locations.generate(1600);
      if (cancelled) return;
      const cfi = rendition.location?.start.cfi;
      if (cfi) {
        const p = book.locations.percentageFromCfi(cfi);
        setProgress(p);
        updateBook(bookId, { progress: p });
      }
    }

    open().catch((err) => {
      if (cancelled) return;
      console.error(err);
      setError('No se pudo abrir el libro.');
    });

    return () => {
      cancelled = true;
      renditionRef.current = null;
      book?.destroy();
    };
  }, [bookId]);

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'ArrowRight') renditionRef.current?.next();
    if (e.key === 'ArrowLeft') renditionRef.current?.prev();
  }

  // Flechas del teclado en la página (fuera del libro).
  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  function goTo(href: string) {
    renditionRef.current?.display(href);
    setShowToc(false);
  }

  return (
    <div className="reader">
      <header className="reader__header">
        <button className="link-button" onClick={onClose}>
          ← Biblioteca
        </button>
        <span className="reader__title">{title}</span>
        <button className="link-button" onClick={() => setShowToc(!showToc)} disabled={!toc.length}>
          Índice
        </button>
      </header>

      <div className="reader__body">
        {showToc && (
          <nav className="toc">
            <TocList items={toc} onSelect={goTo} />
          </nav>
        )}

        <div className="reader__page">
          {error ? <p className="reader__error">{error}</p> : <div ref={viewerRef} className="reader__viewer" />}
        </div>
      </div>

      <footer className="reader__footer">
        <button className="button" onClick={() => renditionRef.current?.prev()}>
          ‹ Anterior
        </button>
        <span>{progress !== null ? `${Math.round(progress * 100)}%` : ''}</span>
        <button className="button" onClick={() => renditionRef.current?.next()}>
          Siguiente ›
        </button>
      </footer>
    </div>
  );
}

function TocList({ items, onSelect }: { items: TocItem[]; onSelect: (href: string) => void }) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item.href}>
          <button onClick={() => onSelect(item.href)}>{item.label.trim()}</button>
          {item.subitems?.length ? <TocList items={item.subitems} onSelect={onSelect} /> : null}
        </li>
      ))}
    </ul>
  );
}
