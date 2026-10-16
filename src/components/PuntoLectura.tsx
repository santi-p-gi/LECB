// "Volver a donde ibas": si el lector vuelve atrás a releer algo (pasando páginas hacia atrás,
// desde el índice, un marcador, la búsqueda o un enlace), LECB recuerda hasta dónde había
// llegado y le ofrece volver con un toque. Sirve igual para EPUB y PDF.
import { useEffect, useRef, useState } from 'react';
import { updateBook, type PuntoLectura } from '../db';
import { Cerrar, Cinta } from './Iconos';
import { contarEvento } from '../estadisticas';

// lugar: dónde está ahora (null mientras no se sabe la página).
// guardado: el punto que quedó guardado la última vez que se cerró el libro.
// umbral: a cuántas páginas de distancia vale la pena ofrecer volver (releer la página
// anterior no cuenta).
export function usePuntoLectura(bookId: string, lugar: PuntoLectura | null, guardado: PuntoLectura | null | undefined, umbral: number) {
  const [volver, setVolver] = useState<PuntoLectura | null>(null);
  const volverRef = useRef<PuntoLectura | null>(null);
  const ultimo = useRef<PuntoLectura | null>(null); // dónde estaba antes de este cambio
  const lejos = useRef<PuntoLectura | null>(null); // lo más lejos que llegó leyendo de corrido
  const secuencial = useRef(false); // el próximo cambio es pasar de página (no un salto)
  const guardadoRef = useRef(guardado);
  guardadoRef.current = guardado;
  const umbralRef = useRef(umbral);
  umbralRef.current = umbral;

  function fijar(v: PuntoLectura | null) {
    const antes = volverRef.current;
    if (antes?.destino === v?.destino && antes?.pagina === v?.pagina) return;
    volverRef.current = v;
    setVolver(v);
    updateBook(bookId, { volverA: v });
  }

  const destino = lugar?.destino;
  const pagina = lugar?.pagina;
  useEffect(() => {
    if (destino === undefined || pagina === undefined) return;
    const l = { destino, pagina };
    const pasoPagina = secuencial.current;
    secuencial.current = false;
    const antes = ultimo.current;
    ultimo.current = l;
    let v = volverRef.current;
    if (!antes) {
      // Al abrir el libro: retoma lo que había quedado guardado.
      v = guardadoRef.current ?? null;
      volverRef.current = v;
      setVolver(v);
      lejos.current = v && v.pagina > l.pagina ? v : l;
    } else if (pasoPagina) {
      if (l.pagina >= lejos.current!.pagina) lejos.current = l;
      if (v && l.pagina >= v.pagina) v = null; // llegó leyendo hasta donde iba
      else if (!v) v = lejos.current; // está volviendo hacia atrás página por página
    } else if (!v) {
      // Un salto (índice, marcador, búsqueda, enlace, barra): recuerda dónde iba.
      v = antes.pagina >= lejos.current!.pagina ? antes : lejos.current;
    }
    // Si está a un par de páginas, no hace falta ofrecer nada.
    if (v && Math.abs(v.pagina - l.pagina) < umbralRef.current) v = null;
    fijar(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destino, pagina]);

  return {
    volver,
    // Avisa que el próximo cambio de lugar es pasar de página (llamar antes de pasarla).
    pasarPagina: () => {
      secuencial.current = true;
    },
    // Devuelve a dónde ir y olvida el punto (el lector ya volvió).
    usar: () => {
      const v = volverRef.current;
      if (!v) return null;
      contarEvento('volver-lectura');
      lejos.current = v;
      fijar(null);
      return v.destino;
    },
    // "No, gracias": a partir de acá, este es su nuevo punto de lectura.
    descartar: () => {
      lejos.current = ultimo.current;
      fijar(null);
    },
  };
}

export function PastillaVolver({ pagina, onVolver, onDescartar }: { pagina: number; onVolver: () => void; onDescartar: () => void }) {
  return (
    <div className="pastilla-zoom pastilla-volver">
      <button onClick={onVolver}>Volver a donde ibas · pág. {pagina}</button>
      <button className="pastilla-cerrar" onClick={onDescartar} aria-label="Quedarme acá">
        <Cerrar />
      </button>
    </div>
  );
}

// Marcas al lado de cada capítulo del índice: dónde está, hasta dónde había llegado, y si tiene marcadores.
export function MarcasIndice({ aca, ibas, marcadores }: { aca: boolean; ibas: boolean; marcadores: number }) {
  return (
    <>
      {aca && <span className="etiqueta-indice">Estás acá</span>}
      {ibas && <span className="etiqueta-indice ibas">Ibas acá</span>}
      {marcadores > 0 && (
        <span className="cinta-indice" title={marcadores === 1 ? 'Tiene un marcador' : `Tiene ${marcadores} marcadores`}>
          <Cinta />
        </span>
      )}
    </>
  );
}

// Al abrir el índice, se muestra el capítulo actual (sin tener que buscarlo en libros largos).
export function useIndiceEnCapitulo(abierto: boolean) {
  useEffect(() => {
    if (!abierto) return;
    const reloj = window.setTimeout(() => {
      document.querySelector('.cajon .item.actual')?.scrollIntoView({ block: 'center' });
    }, 60);
    return () => clearTimeout(reloj);
  }, [abierto]);
}
