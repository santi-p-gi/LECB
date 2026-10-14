// Piezas compartidas por los lectores de EPUB y PDF: medidas del libro, página y panel Aa.
import {
  ANIMACIONES, FUENTES, INTERLINEADOS, TAMANOS, TEMAS,
  type Animacion,
  type Fuente, type Preferencias, type Tema,
} from '../preferencias';
import { useEffect, useRef } from 'react';
import { AnimacionIcono, Interlineado } from './Iconos';
import { contarEvento } from '../estadisticas';

/* ---------- medidas del libro según la pantalla (igual que la maqueta) ---------- */
export interface Medidas {
  doble: boolean;
  completo: boolean; // pantalla completa: sin marco, el libro ocupa toda la pantalla
  pw: number; ph: number; // ancho y alto de cada página
  mo: number; mi: number; // margen exterior e interior
  mt: number; mb: number; // margen superior e inferior
  cw: number; ch: number; // ancho y alto del texto
}

// Pantalla completa: si el lector la pidió o, sola, con el celular acostado (ahí no hay alto
// para el marco y las barras).
export function modoCompleto(completaPref: boolean) {
  return completaPref || (window.innerHeight < 500 && window.innerWidth > window.innerHeight);
}

// Doble página: en pantallas anchas o, en pantalla completa, con la pantalla acostada.
export function dobleDisponible(completo: boolean) {
  const vw = window.innerWidth, vh = window.innerHeight;
  return vw >= 820 || (completo && vw > vh && vw >= 560);
}

// En pantalla completa el ancho del renglón tiene un tope: renglones muy largos cansan.
const TEXTO_MAX = 620;

export function medidas(doblePref: boolean, completo = false): Medidas {
  const vw = window.innerWidth, vh = window.innerHeight;
  if (completo) {
    const doble = doblePref && dobleDisponible(true);
    const pw = doble ? Math.floor(vw / 2) : vw, ph = vh;
    const lado = Math.min(40, Math.max(16, Math.round(pw * 0.06)));
    const mt = Math.min(44, Math.max(26, Math.round(ph * 0.05))), mb = mt;
    // En doble página el texto queda cerca del lomo y lo que sobra va hacia afuera.
    const mi = doble ? lado : Math.max(lado, Math.round((pw - TEXTO_MAX) / 2));
    const mo = doble ? Math.max(lado, pw - mi - TEXTO_MAX) : mi;
    return { doble, completo, pw, ph, mo, mi, mt, mb, cw: pw - mo - mi, ch: ph - mt - mb };
  }
  const doble = doblePref && dobleDisponible(false);
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
  return { doble, completo, pw, ph, mo, mi, mt, mb, cw: pw - mo - mi, ch: ph - mt - mb };
}

export const mismasMedidas = (a: Medidas, b: Medidas) =>
  (Object.keys(a) as (keyof Medidas)[]).every((k) => a[k] === b[k]);

// Medidas para PDF: la página respeta la forma del PDF (A4, carta…) y los márgenes son
// chicos, porque el PDF ya trae los suyos. Abajo queda lugar para el número de página.
export function medidasPdf(doblePref: boolean, proporcion: number, completo = false): Medidas {
  const vw = window.innerWidth, vh = window.innerHeight;
  // En el celular acostado no ponemos dos hojas de PDF: quedarían diminutas.
  const doble = doblePref && vw >= 820 && vh >= 500;
  const chico = vw < 600 || vh < 500;
  const alto = completo ? vh : Math.min(vh - (chico ? 116 : 140), 1000);
  const anchoMax = completo
    ? (doble ? Math.floor(vw / 2) : vw)
    : (doble ? Math.floor((vw - 120) / 2) : Math.min(vw - 24, 900));
  const m = completo ? 6 : chico ? 8 : 14, mb = chico ? 24 : 32;
  let ch = alto - m - mb;
  let cw = Math.round(ch * proporcion);
  if (cw > anchoMax - 2 * m) {
    cw = anchoMax - 2 * m;
    ch = Math.round(cw / proporcion);
  }
  return { doble, completo, pw: cw + 2 * m, ph: ch + m + mb, mo: m, mi: m, mt: m, mb, cw, ch };
}

/* ---------- pantalla completa del navegador ---------- */
// Esconde la barra de direcciones y la del sistema. No existe en el iPhone (ahí solo cambia el
// diseño, y si LECB está instalada ya no hay barra de direcciones).
export function pedirPantallaCompleta() {
  if (!document.fullscreenElement && document.fullscreenEnabled) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  }
}

export function salirPantallaCompleta() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

// Si el lector sale de la pantalla completa por su cuenta (Escape, botón atrás), se apaga la
// opción. Al cerrar el libro se sale de la pantalla completa, pero la opción queda guardada
// y se retoma con el primer toque la próxima vez.
export function useSalidaPantallaCompleta(alSalir: () => void) {
  const avisar = useRef(alSalir);
  avisar.current = alSalir;
  useEffect(() => {
    let estaba = !!document.fullscreenElement;
    const alCambiar = () => {
      if (document.fullscreenElement) estaba = true;
      else if (estaba) {
        estaba = false;
        avisar.current();
      }
    };
    document.addEventListener('fullscreenchange', alCambiar);
    return () => {
      document.removeEventListener('fullscreenchange', alCambiar);
      salirPantallaCompleta();
    };
  }, []);
}

/* ---------- pantalla encendida mientras se lee ---------- */
// Le pide al dispositivo que no apague ni oscurezca la pantalla (Wake Lock). Si pasan 10 minutos
// sin pasar de página ni tocar nada (por ejemplo, el lector se durmió), lo suelta y la pantalla
// se apaga como siempre. "senal" cambia en cada página: cuenta como actividad.
const SIN_ACTIVIDAD = 10 * 60 * 1000;

type BloqueoPantalla = { release(): Promise<void>; released?: boolean };
const wakeLock = () =>
  (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<BloqueoPantalla> } }).wakeLock;

export function usePantallaEncendida(activa: boolean, senal: unknown) {
  const bloqueo = useRef<BloqueoPantalla | null>(null);
  const reloj = useRef<number | undefined>(undefined);
  const activaRef = useRef(activa);
  activaRef.current = activa;

  // "quiero": si en este momento corresponde tenerlo. El pedido tarda un instante: si mientras
  // tanto se soltó (se cerró el libro, pasó el tiempo), se suelta apenas llega.
  const quiero = useRef(false);
  const pidiendo = useRef(false);
  const soltar = useRef(() => {
    quiero.current = false;
    bloqueo.current?.release().catch(() => {});
    bloqueo.current = null;
  });
  const actividad = useRef(() => {});
  actividad.current = async () => {
    clearTimeout(reloj.current);
    if (!activaRef.current || document.visibilityState !== 'visible') return;
    quiero.current = true;
    reloj.current = window.setTimeout(soltar.current, SIN_ACTIVIDAD);
    if ((bloqueo.current && !bloqueo.current.released) || pidiendo.current) return;
    pidiendo.current = true;
    try {
      const nuevo = (await wakeLock()?.request('screen')) ?? null;
      if (quiero.current) bloqueo.current = nuevo;
      else nuevo?.release().catch(() => {});
    } catch {
      // no disponible (navegador viejo, modo ahorro de batería): la pantalla se apaga como siempre
    } finally {
      pidiendo.current = false;
    }
  };

  // Cada página nueva y cada toque o tecla cuentan como "sigue leyendo".
  useEffect(() => {
    actividad.current();
  }, [senal, activa]);
  useEffect(() => {
    const f = () => actividad.current();
    // Al volver a la pestaña o a la app, el navegador ya soltó el bloqueo: se pide de nuevo.
    const alVolver = () => document.visibilityState === 'visible' && f();
    window.addEventListener('pointerdown', f);
    window.addEventListener('keydown', f);
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      window.removeEventListener('pointerdown', f);
      window.removeEventListener('keydown', f);
      document.removeEventListener('visibilitychange', alVolver);
      clearTimeout(reloj.current);
      soltar.current();
    };
  }, []);
  // Si se apaga la opción, se suelta enseguida.
  useEffect(() => {
    if (!activa) {
      clearTimeout(reloj.current);
      soltar.current();
    }
  }, [activa]);
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
// vistaPdf: en PDF, elegir entre la página original y el modo texto (ahí sí hay tipografía).
interface PanelAjustesProps {
  abierto: boolean;
  prefs: Preferencias;
  onCambiar: (c: Partial<Preferencias>) => void;
  soloTema?: boolean;
  onVerGuia?: () => void;
  vistaPdf?: { texto: boolean; onCambiar: (texto: boolean) => void };
}

export function PanelAjustes({ abierto, prefs, onCambiar, soloTema = false, onVerGuia, vistaPdf }: PanelAjustesProps) {
  // (en PDF, con el celular acostado no hay doble página: las hojas quedarían diminutas)
  const hayDoble = vistaPdf && !vistaPdf.texto
    ? window.innerWidth >= 820 && window.innerHeight >= 500
    : dobleDisponible(modoCompleto(prefs.completa));
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
      {vistaPdf && (
        <div className="grupo">
          <p className="grupo-tit">Vista</p>
          <div className="opciones">
            <button className="op" aria-pressed={!vistaPdf.texto} onClick={() => vistaPdf.onCambiar(false)}>
              <b>▢</b>
              Página original
            </button>
            <button className="op" aria-pressed={vistaPdf.texto} onClick={() => vistaPdf.onCambiar(true)}>
              <b>¶</b>
              Modo texto
            </button>
          </div>
          <p className="nota-op">
            {vistaPdf.texto
              ? 'El texto se acomoda a tu pantalla. Fórmulas, tablas e imágenes no se ven: para eso, volvé a la página original.'
              : 'Modo texto: para PDF de texto corrido. Lo acomoda a tu pantalla, con tu letra y tamaño.'}
          </p>
        </div>
      )}
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
          {!vistaPdf && <div className="grupo">
            <label className="interruptor">
              Notas al costado del libro
              <input type="checkbox" checked={prefs.notasMargen} onChange={(e) => onCambiar({ notasMargen: e.target.checked })} />
            </label>
          </div>}
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
            checked={prefs.doble && hayDoble}
            disabled={!hayDoble}
            onChange={(e) => onCambiar({ doble: e.target.checked })}
          />
        </label>
        {!hayDoble && window.innerWidth < 820 && (
          <p className="nota-op">Acostá el celular para leer a doble página.</p>
        )}
      </div>
      <div className="grupo">
        <label className="interruptor">
          Pantalla completa
          <input
            type="checkbox"
            checked={prefs.completa}
            onChange={(e) => {
              const activar = e.target.checked;
              if (activar) {
                pedirPantallaCompleta();
                contarEvento('pantalla-completa');
              } else salirPantallaCompleta();
              onCambiar({ completa: activar });
            }}
          />
        </label>
        <p className="nota-op">Sin marco ni barras: el libro ocupa toda la pantalla. Tocá el centro para ver los botones.</p>
      </div>
      {'wakeLock' in navigator && (
        <div className="grupo">
          <label className="interruptor">
            Pantalla siempre encendida
            <input type="checkbox" checked={prefs.pantallaEncendida} onChange={(e) => onCambiar({ pantallaEncendida: e.target.checked })} />
          </label>
          <p className="nota-op">Mientras leés, la pantalla no se apaga ni se oscurece. Si pasan 10 minutos sin pasar de página, se apaga como siempre.</p>
        </div>
      )}
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
