// Guía rápida que aparece la primera vez que se abre un libro.
import { useState, type ReactNode } from 'react';
import { Altavoz, Cinta, Lista, Lupa } from './Iconos';

const CLAVE = 'lecb-guia-vista';

export function guiaYaVista() {
  try {
    return localStorage.getItem(CLAVE) === '1';
  } catch {
    return true; // sin almacenamiento no la mostramos en cada apertura
  }
}

function marcarVista() {
  try {
    localStorage.setItem(CLAVE, '1');
  } catch {
    // ignorado
  }
}

// Dibujito del libro con flechas a los costados.
const DibujoPasarPagina = () => (
  <svg viewBox="0 0 160 70" className="guia-dibujo" aria-hidden="true">
    <rect x="35" y="8" width="90" height="56" rx="4" className="g-hoja" />
    <line x1="80" y1="8" x2="80" y2="64" className="g-lomo" />
    <rect x="35" y="8" width="22" height="56" rx="4" className="g-zona" />
    <rect x="103" y="8" width="22" height="56" rx="4" className="g-zona" />
    <path d="M22 36h-12m5-5-5 5 5 5" className="g-flecha" />
    <path d="M138 36h12m-5-5 5 5-5 5" className="g-flecha" />
  </svg>
);

const DibujoSubrayar = () => (
  <svg viewBox="0 0 160 70" className="guia-dibujo" aria-hidden="true">
    <rect x="30" y="8" width="100" height="56" rx="4" className="g-hoja" />
    {[18, 28, 38, 48].map((y) => <line key={y} x1="40" y1={y} x2={y === 48 ? 95 : 120} y2={y} className="g-renglon" />)}
    <rect x="52" y="24" width="52" height="8" rx="2" className="g-resaltado" />
  </svg>
);

interface Paso {
  titulo: string;
  texto: ReactNode;
  dibujo: ReactNode;
}

export default function GuiaLector({ conSubrayados, conVoz = conSubrayados, onCerrar }: { conSubrayados: boolean; conVoz?: boolean; onCerrar: () => void }) {
  const pasos: Paso[] = [
    {
      titulo: 'Pasá de página',
      texto: 'Tocá los costados del libro, usá las flechas del teclado o deslizá el dedo hacia un lado.',
      dibujo: <DibujoPasarPagina />,
    },
    {
      titulo: 'Leé sin distracciones',
      texto:
        'Las barras de arriba y abajo se esconden solas. Para volver a verlas, mové el mouse o, en el celular, tocá el centro de la página.',
      dibujo: (
        <svg viewBox="0 0 160 70" className="guia-dibujo" aria-hidden="true">
          <rect x="20" y="4" width="120" height="8" rx="4" className="g-zona" />
          <rect x="35" y="16" width="90" height="40" rx="4" className="g-hoja" />
          <circle cx="80" cy="36" r="7" className="g-toque" />
          <rect x="20" y="60" width="120" height="6" rx="3" className="g-zona" />
        </svg>
      ),
    },
    ...(conSubrayados
      ? [
          {
            titulo: 'Subrayá y anotá',
            texto: 'Seleccioná un texto para subrayarlo en colores, agregarle una nota o copiarlo. Si seleccionás una sola palabra, «Definir» te muestra qué significa.',
            dibujo: <DibujoSubrayar />,
          },
        ]
      : []),
    {
      titulo: 'Tus herramientas',
      texto: (
        <ul className="guia-herramientas">
          <li><Lupa /> Buscar en el libro</li>
          <li><Lista /> Índice{conSubrayados ? ', marcadores y subrayados' : ' y marcadores'}</li>
          <li><Cinta /> Marcar la página</li>
          <li><b className="guia-aa">Aa</b> Tema, letra, tamaño y cómo pasar página</li>
          {conVoz && <li><Altavoz /> Leer en voz alta</li>}
        </ul>
      ),
      dibujo: null,
    },
  ];
  const [n, setN] = useState(0);
  const paso = pasos[n];
  const ultimo = n === pasos.length - 1;
  const cerrar = () => {
    marcarVista();
    onCerrar();
  };

  return (
    <div className="guia-fondo" onClick={(e) => e.stopPropagation()}>
      <div className="guia" role="dialog" aria-label="Guía rápida" aria-live="polite">
        {paso.dibujo}
        <h2>{paso.titulo}</h2>
        <div className="guia-texto">{paso.texto}</div>
        <div className="guia-pie">
          <div className="guia-puntos" aria-hidden="true">
            {pasos.map((_, i) => <i key={i} className={i === n ? 'on' : ''} />)}
          </div>
          {!ultimo && (
            <button className="boton-texto" onClick={cerrar}>
              Saltar
            </button>
          )}
          <button className="boton-lleno" onClick={() => (ultimo ? cerrar() : setN(n + 1))} autoFocus>
            {ultimo ? '¡A leer!' : 'Siguiente'}
          </button>
        </div>
      </div>
    </div>
  );
}
