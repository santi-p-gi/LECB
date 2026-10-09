// Tapa de un libro: la imagen del EPUB o, si no trae, una tapa generada al estilo de la maqueta.
import { useEffect, useState, type CSSProperties } from 'react';
import type { BookMeta } from '../db';
import { colorTexto } from '../colores';

export default function Portada({ book, className = '' }: { book: BookMeta; className?: string }) {
  // La portada está guardada como Blob; creamos una URL temporal para poder mostrarla
  // y la liberamos cuando el componente desaparece.
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!book.cover) return;
    const u = URL.createObjectURL(book.cover);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [book.cover]);

  if (url) {
    return (
      <div className={`portada portada-img ${className}`}>
        <img src={url} alt="" />
      </div>
    );
  }

  const estilo = { '--c': book.color, '--t': colorTexto(book.color) } as CSSProperties;
  return (
    <div className={`portada ${className}`} style={estilo}>
      <span className="pt-autor">{book.author}</span>
      <span className="pt-titulo">{book.title}</span>
      <span className="pt-marco" />
    </div>
  );
}
