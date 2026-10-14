// Panel del diccionario: aparece abajo, sin tapar el texto que se está leyendo.
import { useEffect, useState } from 'react';
import { definir, limpiarPalabra, type Definicion } from '../diccionario';
import { Cerrar } from './Iconos';

const MAX_ACEPCIONES = 6;

export default function PanelDiccionario({ texto, idioma, onCerrar }: { texto: string; idioma: string; onCerrar: () => void }) {
  const palabra = limpiarPalabra(texto);
  const [estado, setEstado] = useState<{ tipo: 'buscando' } | { tipo: 'listo'; def: Definicion | null } | { tipo: 'error' }>({ tipo: 'buscando' });
  const [todas, setTodas] = useState(false);

  useEffect(() => {
    let vigente = true;
    setEstado({ tipo: 'buscando' });
    setTodas(false);
    definir(palabra, idioma)
      .then((def) => vigente && setEstado({ tipo: 'listo', def }))
      .catch(() => vigente && setEstado({ tipo: 'error' }));
    return () => {
      vigente = false;
    };
  }, [palabra, idioma]);

  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [onCerrar]);

  const def = estado.tipo === 'listo' ? estado.def : null;
  const acepciones = def ? (todas ? def.acepciones : def.acepciones.slice(0, MAX_ACEPCIONES)) : [];
  // Agrupadas por tipo (sustantivo, verbo…), en el orden en que vienen.
  const grupos: { tipo: string; textos: string[] }[] = [];
  for (const a of acepciones) {
    const ultimo = grupos.at(-1);
    if (ultimo?.tipo === a.tipo) ultimo.textos.push(a.texto);
    else grupos.push({ tipo: a.tipo, textos: [a.texto] });
  }
  const rae = idioma === 'es' ? `https://dle.rae.es/${encodeURIComponent((def?.palabra ?? palabra).toLowerCase())}` : null;

  return (
    <>
      <div className="diccionario-fondo" onClick={onCerrar} />
      <aside className="diccionario" role="dialog" aria-label={`Definición de ${palabra}`}>
        <div className="diccionario-cab">
          <div>
            <h2>{def?.palabra ?? palabra}</h2>
            {def && def.palabra.toLowerCase() !== palabra.toLowerCase() && (
              <p className="diccionario-forma">«{palabra}» es una forma de «{def.palabra}»</p>
            )}
            {def && def.idioma !== 'Español' && <p className="diccionario-forma">{def.idioma}</p>}
          </div>
          <button className="btn-l" onClick={onCerrar} aria-label="Cerrar">
            <Cerrar />
          </button>
        </div>
        <div className="diccionario-cuerpo">
          {estado.tipo === 'buscando' && <p className="diccionario-aviso">Buscando…</p>}
          {estado.tipo === 'error' && (
            <p className="diccionario-aviso">No se pudo consultar el diccionario. Revisá tu conexión a internet.</p>
          )}
          {estado.tipo === 'listo' && !def && (
            <p className="diccionario-aviso">No encontramos «{palabra}» en el diccionario.</p>
          )}
          {grupos.map((g, i) => (
            <section key={i}>
              <h3>{g.tipo}</h3>
              <ol>
                {g.textos.map((t, j) => <li key={j}>{t}</li>)}
              </ol>
            </section>
          ))}
          {def && !todas && def.acepciones.length > MAX_ACEPCIONES && (
            <button className="boton-texto" onClick={() => setTodas(true)}>
              Ver las {def.acepciones.length} acepciones
            </button>
          )}
        </div>
        <div className="diccionario-pie">
          <span>Fuente: Wiktionary</span>
          <span className="espacio" />
          {rae && <a href={rae} target="_blank" rel="noopener noreferrer">Ver en la RAE</a>}
          <a href={def?.url ?? `https://es.wiktionary.org/wiki/${encodeURIComponent(palabra)}`} target="_blank" rel="noopener noreferrer">
            Ver en Wiktionary
          </a>
        </div>
      </aside>
    </>
  );
}
