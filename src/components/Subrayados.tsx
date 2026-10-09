// Piezas visuales de los subrayados: menú flotante, editor de notas y lista del cajón.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ColorSubrayado, Subrayado } from '../db';
import { COLORES_SUBRAYADO, ORDEN_COLORES } from '../subrayados';

/* ---------- Menú flotante (al seleccionar texto o tocar un subrayado) ---------- */

export interface PosicionMenu {
  x: number; // centro horizontal del texto, en la pantalla
  arriba: number; // borde superior del texto
  abajo: number; // borde inferior del texto
}

interface MenuProps {
  posicion: PosicionMenu;
  colorActual: ColorSubrayado | null; // null = texto recién seleccionado (todavía sin subrayar)
  tieneNota: boolean;
  onColor: (c: ColorSubrayado) => void;
  onNota: () => void;
  onCopiar?: () => void;
  onBorrar?: () => void;
}

export function MenuSubrayado({ posicion, colorActual, tieneNota, onColor, onNota, onCopiar, onBorrar }: MenuProps) {
  // En pantallas táctiles el sistema pone su propio menú arriba de la selección: el nuestro va abajo.
  const tactil = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const arriba = !tactil && posicion.arriba > 120;
  const x = Math.min(Math.max(posicion.x, 150), window.innerWidth - 150);
  const estilo = arriba
    ? { left: x, top: posicion.arriba - 10, transform: 'translate(-50%, -100%)' }
    : { left: x, top: Math.min(posicion.abajo + 10, window.innerHeight - 70), transform: 'translateX(-50%)' };

  return (
    <div
      className="menu-subrayado"
      style={estilo}
      role="toolbar"
      aria-label="Subrayar"
      // Evita que el clic en el menú borre la selección del texto antes de usarla.
      onMouseDown={(e) => e.preventDefault()}
    >
      {ORDEN_COLORES.map((c) => (
        <button
          key={c}
          className="color-subrayado"
          style={{ background: COLORES_SUBRAYADO[c].color }}
          aria-label={`Subrayar en ${COLORES_SUBRAYADO[c].nombre.toLowerCase()}`}
          aria-pressed={colorActual === c}
          onClick={() => onColor(c)}
        />
      ))}
      <span className="menu-sep" />
      <button className="menu-accion" onClick={onNota}>{tieneNota ? 'Editar nota' : 'Nota'}</button>
      {onCopiar && <button className="menu-accion" onClick={onCopiar}>Copiar</button>}
      {onBorrar && <button className="menu-accion peligro" onClick={onBorrar}>Borrar</button>}
    </div>
  );
}

/* ---------- Editor de notas ---------- */

interface EditorProps {
  texto: string;
  notaInicial: string;
  onGuardar: (nota: string) => void;
  onCancelar: () => void;
}

export function EditorNota({ texto, notaInicial, onGuardar, onCancelar }: EditorProps) {
  const [nota, setNota] = useState(notaInicial);
  const campo = useRef<HTMLTextAreaElement>(null);
  useEffect(() => campo.current?.focus(), []);

  return (
    <div className="modal-fondo" onClick={onCancelar}>
      <div className="modal" role="dialog" aria-label="Nota" onClick={(e) => e.stopPropagation()}>
        <p className="modal-cita">«{texto.length > 220 ? texto.slice(0, 220) + '…' : texto}»</p>
        <textarea
          ref={campo}
          value={nota}
          placeholder="Escribí tu nota…"
          rows={5}
          onChange={(e) => setNota(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancelar();
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onGuardar(nota);
          }}
        />
        <div className="modal-botones">
          {notaInicial && (
            <button className="boton-texto peligro" onClick={() => onGuardar('')}>Quitar nota</button>
          )}
          <span className="espacio" />
          <button className="boton-texto" onClick={onCancelar}>Cancelar</button>
          <button className="boton-lleno" onClick={() => onGuardar(nota)}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Lista del cajón ---------- */

interface ListaProps {
  subrayados: Subrayado[];
  onIr: (s: Subrayado) => void;
  onNota: (s: Subrayado) => void;
  onBorrar: (s: Subrayado) => void;
  onExportar: () => void;
}

export function ListaSubrayados({ subrayados, onIr, onNota, onBorrar, onExportar }: ListaProps) {
  if (subrayados.length === 0) {
    return <p className="vacio">Seleccioná un texto del libro para subrayarlo o agregarle una nota.</p>;
  }
  return (
    <>
      <button className="boton-exportar" onClick={onExportar}>Exportar subrayados y notas</button>
      <ul className="lista lista-subrayados">
        {subrayados.map((s) => (
          <li key={s.id} className="subrayado-item" style={{ '--color': COLORES_SUBRAYADO[s.color].color } as CSSProperties}>
            <button className="subrayado-texto" onClick={() => onIr(s)}>
              {s.texto}
            </button>
            {s.nota && <p className="subrayado-nota">{s.nota}</p>}
            <div className="subrayado-pie">
              <span>{[s.pagina ? `Pág. ${s.pagina}` : null, s.etiqueta].filter(Boolean).join(' · ')}</span>
              <button className="boton-texto" onClick={() => onNota(s)}>{s.nota ? 'Editar nota' : 'Nota'}</button>
              <button className="boton-texto peligro" onClick={() => onBorrar(s)}>Borrar</button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
