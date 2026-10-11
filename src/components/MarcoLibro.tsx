// Piezas compartidas por los lectores de EPUB y PDF: medidas del libro, página y panel Aa.
import {
  ANIMACIONES, FUENTES, INTERLINEADOS, TAMANOS, TEMAS,
  type Animacion,
  type Fuente, type Preferencias, type Tema,
} from '../preferencias';
import { AnimacionIcono, Interlineado } from './Iconos';

/* ---------- medidas del libro según la pantalla (igual que la maqueta) ---------- */
export interface Medidas {
  doble: boolean;
  pw: number; ph: number; // ancho y alto de cada página
  mo: number; mi: number; // margen exterior e interior
  mt: number; mb: number; // margen superior e inferior
  cw: number; ch: number; // ancho y alto del texto
}

export function medidas(doblePref: boolean): Medidas {
  const vw = window.innerWidth, vh = window.innerHeight;
  const doble = doblePref && vw >= 820;
  const alto = vh - (vw < 600 ? 116 : 140);
  let pw: number, ph: number;
  if (doble) {
    ph = Math.min(alto, 860);
    pw = Math.round(ph * 0.68);
    const max = Math.floor((vw - 120) / 2);
    if (pw > max) { pw = max; ph = Math.round(pw / 0.68); }
  } else {
    pw = Math.min(vw - 24, 560);
    ph = vw < 600 ? alto : Math.min(alto, Math.round(pw / 0.64));
  }
  const mo = Math.round(pw * (doble ? 0.12 : 0.09)), mi = Math.round(pw * 0.09);
  const mt = Math.round(ph * 0.085), mb = Math.round(ph * 0.085);
  return { doble, pw, ph, mo, mi, mt, mb, cw: pw - mo - mi, ch: ph - mt - mb };
}

export const mismasMedidas = (a: Medidas, b: Medidas) =>
  (Object.keys(a) as (keyof Medidas)[]).every((k) => a[k] === b[k]);

// Medidas para PDF: la página respeta la forma del PDF (A4, carta…) y los márgenes son
// chicos, porque el PDF ya trae los suyos. Abajo queda lugar para el número de página.
export function medidasPdf(doblePref: boolean, proporcion: number): Medidas {
  const vw = window.innerWidth, vh = window.innerHeight;
  const doble = doblePref && vw >= 820;
  const chico = vw < 600;
  const alto = Math.min(vh - (chico ? 116 : 140), 1000);
  const anchoMax = doble ? Math.floor((vw - 120) / 2) : Math.min(vw - 24, 900);
  const m = chico ? 8 : 14, mb = chico ? 26 : 32;
  let ch = alto - m - mb;
  let cw = Math.round(ch * proporcion);
  if (cw > anchoMax - 2 * m) {
    cw = anchoMax - 2 * m;
    ch = Math.round(cw / proporcion);
  }
  return { doble, pw: cw + 2 * m, ph: ch + m + mb, mo: m, mi: m, mt: m, mb, cw, ch };
}

export function Pagina({ lado, cabecera, folio }: { lado: 'izq' | 'der' | 'unica'; cabecera: string; folio: number | null }) {
  return (
    <div className={`pagina ${lado}`}>
      <div className="cabecera">{cabecera}</div>
      <div className="folio">{folio ?? ''}</div>
    </div>
  );
}

// soloTema: para PDF, donde la tipografía no se puede cambiar.
export function PanelAjustes({ abierto, prefs, onCambiar, soloTema = false, onVerGuia }: { abierto: boolean; prefs: Preferencias; onCambiar: (c: Partial<Preferencias>) => void; soloTema?: boolean; onVerGuia?: () => void }) {
  const dobleDisponible = window.innerWidth >= 820;
  return (
    <aside className={`panel ${abierto ? 'abierto' : ''}`} aria-label="Ajustes de lectura" aria-hidden={!abierto}>
      <div className="grupo">
        <p className="grupo-tit">Tema</p>
        <div className="temas">
          {(Object.keys(TEMAS) as Tema[]).map((t) => (
            <button key={t} className="tema-op" data-tema={t} aria-pressed={prefs.tema === t} onClick={() => onCambiar({ tema: t })}>
              <i>Aa</i>
              {TEMAS[t].nombre}
            </button>
          ))}
        </div>
      </div>
      {!soloTema && (
        <>
          <div className="grupo">
            <p className="grupo-tit">Tipografía</p>
            <div className="opciones">
              {(Object.keys(FUENTES) as Fuente[]).map((f) => (
                <button key={f} className="op" aria-pressed={prefs.fuente === f} onClick={() => onCambiar({ fuente: f })}>
                  <b style={{ fontFamily: FUENTES[f].css }}>Aa</b>
                  {FUENTES[f].nombre}
                </button>
              ))}
            </div>
          </div>
          <div className="grupo">
            <p className="grupo-tit">Tamaño</p>
            <div className="tamano">
              <button className="chica" aria-label="Achicar letra" disabled={prefs.tam === 0} onClick={() => onCambiar({ tam: prefs.tam - 1 })}>
                A
              </button>
              <div className="puntos">
                {TAMANOS.map((_, i) => <i key={i} className={i <= prefs.tam ? 'on' : ''} />)}
              </div>
              <button
                className="grande"
                aria-label="Agrandar letra"
                disabled={prefs.tam === TAMANOS.length - 1}
                onClick={() => onCambiar({ tam: prefs.tam + 1 })}
              >
                A
              </button>
            </div>
          </div>
          <div className="grupo">
            <p className="grupo-tit">Interlineado</p>
            <div className="opciones">
              {INTERLINEADOS.map((op, i) => (
                <button key={op.valor} className="op" aria-pressed={prefs.lh === op.valor} onClick={() => onCambiar({ lh: op.valor })}>
                  <Interlineado separacion={4 + i * 1.5} />
                  {op.nombre}
                </button>
              ))}
            </div>
          </div>
          <div className="grupo">
            <label className="interruptor">
              Notas al costado del libro
              <input type="checkbox" checked={prefs.notasMargen} onChange={(e) => onCambiar({ notasMargen: e.target.checked })} />
            </label>
          </div>
        </>
      )}
      <div className="grupo">
        <p className="grupo-tit">Pasar página</p>
        <div className="opciones">
          {ANIMACIONES.map((op) => (
            <button key={op.valor} className="op" aria-pressed={prefs.animacion === op.valor} onClick={() => onCambiar({ animacion: op.valor })}>
              <AnimacionIcono tipo={op.valor} />
              {op.nombre}
            </button>
          ))}
        </div>
      </div>
      <div className="grupo">
        <label className="interruptor">
          Doble página
          <input
            type="checkbox"
            checked={prefs.doble && dobleDisponible}
            disabled={!dobleDisponible}
            onChange={(e) => onCambiar({ doble: e.target.checked })}
          />
        </label>
      </div>
      {onVerGuia && (
        <button className="ver-guia" onClick={onVerGuia}>
          Ver la guía de nuevo
        </button>
      )}
    </aside>
  );
}

/* ---------- animación al pasar página ---------- */

const reducirMovimiento = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// "normal": el texto nuevo entra con un fundido corto (se llama después de cambiar la página).
export function animarFundido(contenido: HTMLElement | null, dir: 1 | -1, tipo: Animacion) {
  if (tipo !== 'normal' || reducirMovimiento()) return;
  contenido?.animate(
    [{ opacity: 0.25, transform: `translateX(${dir * 12}px)` }, { opacity: 1, transform: 'none' }],
    { duration: 280, easing: 'ease-out' },
  );
}

// "hoja": una hoja de papel lisa gira sobre el lomo mientras el texto cambia por debajo
// (se llama apenas se pide el cambio de página). Es "liviana": la hoja no lleva texto,
// así no hace falta sacarle una foto a la página (lo caro y frágil de un giro real).
export function animarHoja(libro: HTMLElement | null, contenido: HTMLElement | null, L: Medidas, dir: 1 | -1, tipo: Animacion) {
  if (tipo !== 'hoja' || reducirMovimiento() || !libro) return;
  const hoja = document.createElement('div');
  hoja.className = `hoja-giro ${L.doble ? '' : 'sola'}`;
  hoja.innerHTML = '<div class="cara frente"></div><div class="cara dorso"></div>';
  // En doble página gira desde la página derecha; en una sola, desde la misma página.
  Object.assign(hoja.style, { left: `${L.doble ? L.pw : 0}px`, width: `${L.pw}px`, height: `${L.ph}px` });
  libro.append(hoja);

  const duracion = 620;
  const [desde, hasta] = dir > 0 ? [0, -180] : [-180, 0];
  hoja
    .animate(
      [
        { transform: `rotateY(${desde}deg)`, opacity: 1 },
        { transform: `rotateY(${(desde + hasta) / 2}deg)`, opacity: 1, offset: 0.5 },
        { transform: `rotateY(${hasta}deg)`, opacity: 0.85, offset: 0.9 },
        { transform: `rotateY(${hasta}deg)`, opacity: 0 },
      ],
      { duration: duracion, easing: 'cubic-bezier(.42,.08,.22,1)', fill: 'forwards' },
    )
    .finished.finally(() => hoja.remove());
  // El texto se atenúa mientras pasa la hoja y reaparece al final.
  contenido?.animate([{ opacity: 1 }, { opacity: 0.12, offset: 0.25 }, { opacity: 0.12, offset: 0.7 }, { opacity: 1 }], {
    duration: duracion,
  });
}
