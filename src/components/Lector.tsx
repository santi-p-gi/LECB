// Elige el lector según el formato del libro (EPUB o PDF).
import { useEffect, useState } from 'react';
import { getBook } from '../db';
import Reader from './Reader';
import LectorPdf from './LectorPdf';
import './Reader.css';

export default function Lector({ bookId, onClose }: { bookId: string; onClose: () => void }) {
  const [formato, setFormato] = useState<'epub' | 'pdf' | null>(null);
  useEffect(() => {
    getBook(bookId).then((m) => setFormato(m?.formato ?? 'epub'));
  }, [bookId]);

  if (!formato) return <div className="lector" />; // un instante, mientras se lee el formato
  return formato === 'pdf' ? <LectorPdf bookId={bookId} onClose={onClose} /> : <Reader bookId={bookId} onClose={onClose} />;
}
