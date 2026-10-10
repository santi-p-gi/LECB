// Elige el lector según el formato del libro (EPUB o PDF).
import { lazy, Suspense, useEffect, useState } from 'react';
import { getBook } from '../db';
import Reader from './Reader';
// El lector de PDF (y pdf.js, que es pesado) se descarga recién cuando se abre un PDF.
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
  if (formato === 'epub') return <Reader bookId={bookId} onClose={onClose} />;
  return (
    <Suspense fallback={<div className="lector" />}>
      <LectorPdf bookId={bookId} onClose={onClose} />
    </Suspense>
  );
}
