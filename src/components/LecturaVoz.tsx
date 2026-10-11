// Leer en voz alta (EPUB): el "motor" (useLecturaEnVoz) y la barrita de controles (BarraVoz).
//
// Cómo funciona: toma el texto de la página visible, lo divide en oraciones y las lee de a una,
// resaltando la que suena. Al terminar la página, pasa a la siguiente y sigue solo.
import { useEffect, useRef, useState, type MutableRefObject, type SyntheticEvent } from 'react';
import type { Rendition } from 'epubjs';
import { TEMAS, type Tema } from '../preferencias';
import { nombreVoz, oracionesDelRango, vocesEnEspanol, vozDisponible } from '../voz';
import { contarEvento } from '../estadisticas';
import { Detener, Pausa, Reproducir } from './Iconos';

export type EstadoVoz = 'detenido' | 'leyendo' | 'pausado';

interface Opciones {
  renditionRef: MutableRefObject<Rendition | null>;
  temaRef: MutableRefObject<Tema>;
  vozNombre: string | null;
  velocidad: number;
}

// Lo que epub.js nos da de cada capítulo cargado (solo lo que usamos).
interface Contenido {
  sectionIndex: number;
  document: Document;
  range(cfi: string): Range;
  cfiFromRange(rango: Range): string;
}

export function useLecturaEnVoz({ renditionRef, temaRef, vozNombre, velocidad }: Opciones) {
  const [estado, setEstadoReact] = useState<EstadoVoz>('detenido');
  const [voces, setVoces] = useState<SpeechSynthesisVoice[]>([]);

  // Todo lo que cambia mientras lee va en refs: los avisos de la voz (onend) llegan "tarde"
  // y tienen que ver siempre los valores actuales.
  const estadoRef = useRef<EstadoVoz>('detenido');
  const config = useRef({ vozNombre, velocidad });
  config.current = { vozNombre, velocidad };
  const m = useRef({
    oraciones: [] as { texto: string; cfi: string }[],
    indice: 0,
    turno: 0, // cada vez que se corta la voz cambia; los avisos de turnos viejos se ignoran
    esperandoPagina: false, // pasamos de página nosotros y esperamos que epub.js avise
    resaltado: null as string | null,
    bloqueo: null as { release(): Promise<void> } | null, // mantiene la pantalla encendida
  });

  const setEstado = (e: EstadoVoz) => {
    estadoRef.current = e;
    setEstadoReact(e);
  };

  // Las voces se cargan de forma asíncrona (sobre todo en Chrome).
  useEffect(() => {
    if (!vozDisponible()) return;
    const cargar = () => setVoces(vocesEnEspanol());
    cargar();
    speechSynthesis.addEventListener('voiceschanged', cargar);
    return () => {
      speechSynthesis.removeEventListener('voiceschanged', cargar);
      speechSynthesis.cancel(); // al salir del libro, deja de hablar
    };
  }, []);

  /* ---------- pantalla encendida mientras lee ---------- */
  async function pedirBloqueo() {
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
      m.current.bloqueo = (await wl?.request('screen')) ?? null;
    } catch {
      // no disponible: la pantalla se puede apagar y cortar la lectura
    }
  }
  function soltarBloqueo() {
    m.current.bloqueo?.release().catch(() => {});
    m.current.bloqueo = null;
  }
  // El navegador suelta el bloqueo si cambiás de pestaña: al volver se pide de nuevo.
  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState === 'visible' && estadoRef.current === 'leyendo') pedirBloqueo();
    };
    document.addEventListener('visibilitychange', alVolver);
    return () => document.removeEventListener('visibilitychange', alVolver);
  }, []);

  /* ---------- resaltar la oración que se lee ---------- */
  function quitarResaltado() {
    const r = renditionRef.current;
    if (r && m.current.resaltado) r.annotations.remove(m.current.resaltado, 'highlight');
    m.current.resaltado = null;
  }
  function resaltar(cfi: string) {
    quitarResaltado();
    const r = renditionRef.current;
    if (!r) return;
    const noche = temaRef.current === 'noche';
    r.annotations.highlight(cfi, {}, () => {}, 'lecb-voz', {
      fill: TEMAS[temaRef.current].acento,
      'fill-opacity': noche ? '0.3' : '0.18',
      'mix-blend-mode': noche ? 'normal' : 'multiply',
    });
    m.current.resaltado = cfi;
  }

  /* ---------- texto de la página visible ---------- */
  function prepararPagina() {
    const r = renditionRef.current;
    const lugar = r?.location as unknown as { start?: { cfi: string; index: number }; end?: { cfi: string } } | undefined;
    if (!r || !lugar?.start || !lugar.end) return false;
    const contenidos = r.getContents() as unknown as Contenido[];
    const c = contenidos.find((x) => x.sectionIndex === lugar.start!.index) ?? contenidos[0];
    if (!c) return false;
    try {
      const ini = c.range(lugar.start.cfi);
      const fin = c.range(lugar.end.cfi);
      const visible = c.document.createRange();
      visible.setStart(ini.startContainer, ini.startOffset);
      visible.setEnd(fin.startContainer, fin.startOffset);
      m.current.oraciones = oracionesDelRango(c.document, visible).map((o) => ({ texto: o.texto, cfi: c.cfiFromRange(o.rango) }));
      m.current.indice = 0;
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  }

  /* ---------- leer ---------- */
  function vozElegida() {
    const todas = vocesEnEspanol();
    return todas.find((v) => v.voiceURI === config.current.vozNombre) ?? todas[0] ?? null;
  }

  function leer() {
    const st = m.current;
    const turno = ++st.turno;
    if (st.indice >= st.oraciones.length) return avanzar();
    const oracion = st.oraciones[st.indice];
    resaltar(oracion.cfi);
    const u = new SpeechSynthesisUtterance(oracion.texto);
    const voz = vozElegida();
    u.lang = voz?.lang ?? 'es-ES';
    try {
      if (voz) u.voice = voz;
    } catch {
      // si el dispositivo informa una voz "rara", se usa la voz por defecto del idioma
    }
    u.rate = config.current.velocidad;
    u.onend = () => {
      if (turno !== st.turno || estadoRef.current !== 'leyendo') return;
      st.indice++;
      leer();
    };
    u.onerror = (e) => {
      if (turno !== st.turno || e.error === 'interrupted' || e.error === 'canceled') return;
      console.error('Voz:', e.error);
      detener();
    };
    speechSynthesis.speak(u);
  }

  // Terminó la página: pasa a la siguiente (y sigue cuando epub.js avise que cambió).
  function avanzar() {
    const r = renditionRef.current;
    const lugar = r?.location as unknown as { atEnd?: boolean } | undefined;
    if (!r || lugar?.atEnd) return detener();
    m.current.esperandoPagina = true;
    quitarResaltado();
    r.next();
  }

  // El lector avisa cada cambio de página (lo llama Reader en "relocated").
  function alCambiarPagina() {
    const st = m.current;
    if (estadoRef.current === 'pausado') {
      st.oraciones = []; // al reanudar, empieza por la página nueva
      return;
    }
    if (estadoRef.current !== 'leyendo') return;
    if (!st.esperandoPagina) {
      // Cambiaron de página a mano: seguimos leyendo desde la página nueva.
      st.turno++;
      speechSynthesis.cancel();
    }
    st.esperandoPagina = false;
    // Un instante para que epub.js termine de dibujar la página nueva.
    setTimeout(() => {
      if (estadoRef.current !== 'leyendo') return;
      if (!prepararPagina() || st.oraciones.length === 0) return avanzar(); // página sin texto (una imagen)
      leer();
    }, 150);
  }

  function iniciar() {
    if (!vozDisponible()) return;
    speechSynthesis.cancel();
    m.current.turno++;
    if (!prepararPagina()) return;
    setEstado('leyendo');
    pedirBloqueo();
    contarEvento('voz');
    if (m.current.oraciones.length === 0) return avanzar();
    leer();
  }

  function pausar() {
    m.current.turno++;
    speechSynthesis.cancel(); // "pause" no funciona bien en todos los navegadores: cortamos y retomamos la oración
    setEstado('pausado');
    soltarBloqueo();
  }

  function reanudar() {
    setEstado('leyendo');
    pedirBloqueo();
    if (m.current.oraciones.length === 0 && (!prepararPagina() || m.current.oraciones.length === 0)) return avanzar();
    leer();
  }

  function detener() {
    m.current.turno++;
    speechSynthesis.cancel();
    quitarResaltado();
    m.current.oraciones = [];
    m.current.esperandoPagina = false;
    setEstado('detenido');
    soltarBloqueo();
  }

  // Si cambian la voz o la velocidad mientras lee, se repite la oración actual con el cambio.
  useEffect(() => {
    if (estadoRef.current !== 'leyendo') return;
    m.current.turno++;
    speechSynthesis.cancel();
    leer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vozNombre, velocidad]);

  // Al cerrar el libro: silencio y pantalla libre.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => detener(), []);

  return { estado, voces, iniciar, pausar, reanudar, detener, alCambiarPagina };
}

/* ---------- Barrita de controles ---------- */

export const VELOCIDADES = [0.8, 1, 1.2, 1.5, 1.8];

interface BarraProps {
  estado: EstadoVoz;
  voces: SpeechSynthesisVoice[];
  vozNombre: string | null;
  velocidad: number;
  onPausar: () => void;
  onReanudar: () => void;
  onDetener: () => void;
  onVoz: (voiceURI: string) => void;
  onVelocidad: (v: number) => void;
}

export function BarraVoz({ estado, voces, vozNombre, velocidad, onPausar, onReanudar, onDetener, onVoz, onVelocidad }: BarraProps) {
  const actual = voces.find((v) => v.voiceURI === vozNombre) ?? voces[0];
  // Los clics en la barrita no deben llegar al libro (pasaría de página).
  const frenar = (e: SyntheticEvent) => e.stopPropagation();
  return (
    <div className="barra-voz" role="toolbar" aria-label="Lectura en voz alta" onClick={frenar} onPointerDown={frenar} onPointerUp={frenar}>
      {estado === 'leyendo' ? (
        <button className="voz-boton principal" onClick={onPausar} aria-label="Pausar">
          <Pausa />
        </button>
      ) : (
        <button className="voz-boton principal" onClick={onReanudar} aria-label="Seguir leyendo">
          <Reproducir />
        </button>
      )}
      <button className="voz-boton" onClick={onDetener} aria-label="Dejar de leer">
        <Detener />
      </button>
      <select value={velocidad} onChange={(e) => onVelocidad(Number(e.target.value))} aria-label="Velocidad">
        {VELOCIDADES.map((v) => (
          <option key={v} value={v}>
            {String(v).replace('.', ',')}×
          </option>
        ))}
      </select>
      {voces.length > 1 && (
        <select value={actual?.voiceURI} onChange={(e) => onVoz(e.target.value)} aria-label="Voz" className="voz-elegir">
          {voces.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {nombreVoz(v)}
            </option>
          ))}
        </select>
      )}
      {voces.length === 0 && <span className="voz-aviso">Sin voces en español en este dispositivo</span>}
    </div>
  );
}
