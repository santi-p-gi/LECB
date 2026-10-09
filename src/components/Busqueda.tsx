// Panel de búsqueda dentro del libro (se muestra en el cajón lateral).
import { useEffect, useRef } from 'react';
import { MAX_RESULTADOS, type Resultado } from '../busqueda';

export type EstadoBusqueda = 'vacia' | 'buscando' | 'lista' | 'limite';

export interface ResultadoMostrado extends Resultado {
  pagina: number | null;
  capitulo: string;
}

interface Props {
  abierto: boolean;
  consulta: string;
  onConsulta: (texto: string) => void;
  estado: EstadoBusqueda;
  resultados: ResultadoMostrado[];
  onIr: (r: ResultadoMostrado) => void;
}

export default function PanelBusqueda({ abierto, consulta, onConsulta, estado, resultados, onIr }: Props) {
  const campo = useRef<HTMLInputElement>(null);
  // Al abrir el panel, el cursor queda listo para escribir.
  useEffect(() => {
    if (abierto) setTimeout(() => campo.current?.select(), 50);
  }, [abierto]);

  let aviso = '';
  if (estado === 'buscando') aviso = resultados.length ? `Buscando… ${resultados.length} hasta ahora` : 'Buscando…';
  else if (estado === 'lista') aviso = resultados.length ? `${resultados.length} ${resultados.length === 1 ? 'resultado' : 'resultados'}` : 'No hay resultados';
  else if (estado === 'limite') aviso = `Se muestran los primeros ${MAX_RESULTADOS} resultados. Probá con una búsqueda más precisa.`;

  return (
    <div className="busqueda">
      <input
        ref={campo}
        className="campo-busqueda"
        type="search"
        value={consulta}
        placeholder="Buscar en el libro…"
        aria-label="Buscar en el libro"
        onChange={(e) => onConsulta(e.target.value)}
      />
      {aviso && <p className="aviso-busqueda" aria-live="polite">{aviso}</p>}
      {estado === 'vacia' && <p className="vacio">Escribí al menos 2 letras. No importan las mayúsculas ni las tildes.</p>}
      <ul className="lista lista-resultados">
        {resultados.map((r) => (
          <li key={r.cfi}>
            <button className="resultado" onClick={() => onIr(r)}>
              <span className="resultado-texto">
                {r.antes && '…'}
                {r.antes}
                <mark>{r.coincidencia}</mark>
                {r.despues}…
              </span>
              <span className="resultado-meta">
                {[r.pagina ? `Pág. ${r.pagina}` : null, r.capitulo].filter(Boolean).join(' · ')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
