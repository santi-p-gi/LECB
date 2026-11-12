// Elige el lector según el formato del libro (EPUB o PDF).
import { lazy, Suspense, useEffect, useState } from 'react';
import { getBook } from '../db';
// Los lectores (con epub.js y pdf.js, que son pesados) se descargan recién cuando se abre un libro:
// así la página de inicio carga rápido.
const Reader = lazy(() => import('./Reader'));
const LectorPdf = lazy(() => import('./LectorPdf'));
import './Reader.css';
import { contarEvento } from '../estadisticas';

export default function Lector({ bookId, onClose }: { bookId: string; onClose: () => void }) {
  const [formato, setFormato] = useState<'epub' | 'pdf' | null>(null);
  useEffect(() => {
    getBook(bookId).then((m) => {
      const formato = m?.formato ?? 'epub';
      setFormato(formato);
      contarEvento(formato === 'pdf' ? 'abrir-pdf' : 'abrir-epub');
    });
  }, [bookId]);

  if (!formato) return <div className="lector" />; // un instante, mientras se lee el formato
  return (
    <Suspense fallback={<div className="lector" />}>
      {formato === 'epub' ? <Reader bookId={bookId} onClose={onClose} /> : <LectorPdf bookId={bookId} onClose={onClose} />}
    </Suspense>
  );
}
