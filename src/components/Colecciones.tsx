// Colecciones de la estantería: filtros arriba de los lomos y la ventana para elegir
// en qué colecciones está cada libro.
import { useState } from 'react';
import type { BookMeta } from '../db';

// Todas las colecciones que existen, con cuántos libros tiene cada una (ordenadas por nombre).
export function contarColecciones(libros: BookMeta[]) {
  const cuenta = new Map<string, number>();
  for (const l of libros) for (const c of l.colecciones) cuenta.set(c, (cuenta.get(c) ?? 0) + 1);
  return [...cuenta.entries()].sort(([a], [b]) => a.localeCompare(b));
}

// El filtro elegido se recuerda en este navegador (si se puede).
const CLAVE = 'lecb-coleccion';
export function cargarFiltro() {
  try {
    return localStorage.getItem(CLAVE);
  } catch {
    return null;
  }
}
export function guardarFiltro(nombre: string | null) {
  try {
    if (nombre) localStorage.setItem(CLAVE, nombre);
    else localStorage.removeItem(CLAVE);
  } catch {
    // sin almacenamiento: el filtro dura hasta cerrar la pestaña
  }
}

/* ---------- Filtros ---------- */

interface FiltrosProps {
  colecciones: [string, number][];
  total: number;
  elegida: string | null;
  onElegir: (nombre: string | null) => void;
}

export function FiltrosColecciones({ colecciones, total, elegida, onElegir }: FiltrosProps) {
  if (colecciones.length === 0) return null;
  return (
    <div className="filtros" role="tablist" aria-label="Colecciones">
      <button role="tab" aria-selected={elegida === null} onClick={() => onElegir(null)}>
        Todos <span>{total}</span>
      </button>
      {colecciones.map(([nombre, cantidad]) => (
        <button key={nombre} role="tab" aria-selected={elegida === nombre} onClick={() => onElegir(nombre)}>
          {nombre} <span>{cantidad}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------- Ventana de un libro ---------- */

interface VentanaProps {
  libro: BookMeta;
  colecciones: string[]; // todas las que existen
  onGuardar: (colecciones: string[]) => void;
  onCerrar: () => void;
}

export function VentanaColecciones({ libro, colecciones, onGuardar, onCerrar }: VentanaProps) {
  const [elegidas, setElegidas] = useState<string[]>(libro.colecciones);
  const [nueva, setNueva] = useState('');
  // Las que existen más las recién creadas en esta ventana.
  const opciones = [...new Set([...colecciones, ...elegidas])].sort((a, b) => a.localeCompare(b));

  const alternar = (nombre: string) =>
    setElegidas((actuales) => (actuales.includes(nombre) ? actuales.filter((c) => c !== nombre) : [...actuales, nombre]));

  function crear() {
    const nombre = nueva.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!nombre) return;
    // Si ya existe con otras mayúsculas, se usa la existente.
    const existente = opciones.find((o) => o.toLowerCase() === nombre.toLowerCase());
    const final = existente ?? nombre;
    if (!elegidas.includes(final)) setElegidas([...elegidas, final]);
    setNueva('');
  }

  return (
    <div className="dialogo-fondo" onClick={onCerrar}>
      <div className="dialogo" role="dialog" aria-label={`Colecciones de ${libro.title}`} onClick={(e) => e.stopPropagation()}>
        <h2>Colecciones</h2>
        <p>
          ¿En qué colecciones va <b>{libro.title}</b>?
        </p>
        {opciones.length > 0 && (
          <ul className="lista-colecciones">
            {opciones.map((nombre) => (
              <li key={nombre}>
                <label>
                  <input type="checkbox" checked={elegidas.includes(nombre)} onChange={() => alternar(nombre)} />
                  {nombre}
                </label>
              </li>
            ))}
          </ul>
        )}
        <form
          className="nueva-coleccion"
          onSubmit={(e) => {
            e.preventDefault();
            crear();
          }}
        >
          <input
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
            placeholder="Nueva colección (ej. Facultad)"
            aria-label="Nombre de la nueva colección"
            maxLength={40}
          />
          <button className="btn btn-secundario btn-chico" type="submit" disabled={!nueva.trim()}>
            Agregar
          </button>
        </form>
        <div className="dialogo-acciones">
          <button className="btn btn-primario" onClick={() => onGuardar(elegidas)}>
            Guardar
          </button>
        </div>
        <button className="enlace dialogo-cerrar" onClick={onCerrar}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
