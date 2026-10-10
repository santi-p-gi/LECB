// Lector de PDF: muestra las páginas del PDF tal cual (con fórmulas, tablas y gráficos),
// dentro del mismo diseño de libro que los EPUB.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { getBook, getBookFile, updateBook, type BookMeta, type Marcador } from '../db';
import { cargarPreferencias, guardarPreferencias, type Tema } from '../preferencias';
import {
  abrirPdf, buscarEnPdf, cerrarPdf, fraseDePagina, indicePdf,
  type DocumentoPdf, type EntradaIndicePdf, type ResultadoPdf,
} from '../pdf';
import { normalizar } from '../busqueda';
import { animarFundido, animarHoja, medidasPdf, mismasMedidas, Pagina, PanelAjustes } from './MarcoLibro';
import PanelBusqueda, { type EstadoBusqueda, type ResultadoMostrado } from './Busqueda';
import { Cerrar, Cinta, Lista, Lupa, Volver } from './Iconos';
import './Reader.css';
import { contarEvento } from '../estadisticas';


/* ---------- una página del PDF dibujada en un canvas ---------- */

interface PaginaPdfProps {
  pdf: DocumentoPdf;
  indice: number; // empieza en 0
  left: number;
  top: number;
  ancho: number;
  alto: number;
  tema: Tema;
  resaltes: number[][] | null; // rectángulos en unidades del PDF (búsqueda)
}

function PaginaPdf({ pdf, indice, left, top, ancho, alto, tema, resaltes }: PaginaPdfProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [vista, setVista] = useState<{ escala: number; ancho: number; alto: number } | null>(null);

  useEffect(() => {
    let cancelado = false;
    let tarea: { cancel(): void } | null = null;
    (async () => {
      const pagina = await pdf.getPage(indice + 1);
      if (cancelado) return;
      const base = pagina.getViewport({ scale: 1 });
      const escala = Math.min(ancho / base.width, alto / base.height);
      // Más resolución en pantallas de alta densidad (celulares), con tope para no gastar memoria.
      const densidad = Math.min(window.devicePixelRatio || 1, 2);
      const vp = pagina.getViewport({ scale: escala * densidad });
      // Se dibuja en un canvas aparte y se copia al final: así la página anterior no parpadea.
      const temporal = document.createElement('canvas');
      temporal.width = Math.ceil(vp.width);
      temporal.height = Math.ceil(vp.height);
      const render = pagina.render({ canvas: temporal, viewport: vp });
      tarea = render;
      await render.promise;
      const canvas = canvasRef.current;
      if (cancelado || !canvas) return;
      canvas.width = temporal.width;
      canvas.height = temporal.height;
      canvas.getContext('2d')?.drawImage(temporal, 0, 0);
      setVista({ escala, ancho: base.width * escala, alto: base.height * escala });
    })().catch((err) => {
      if (!cancelado && (err as { name?: string })?.name !== 'RenderingCancelledException') console.error(err);
    });
    return () => {
      cancelado = true;
      tarea?.cancel();
    };
  }, [pdf, indice, ancho, alto]);

  // Los rectángulos del PDF tienen el origen abajo a la izquierda; la pantalla, arriba a la izquierda.
  const altoPdf = vista ? vista.alto / vista.escala : 0;
  return (
    <div className={`pagina-pdf pdf-${tema}`} style={{ left, top, width: ancho, height: alto }}>
      <div className="lienzo-pdf" style={vista ? { width: vista.ancho, height: vista.alto } : undefined}>
        <canvas ref={canvasRef} style={vista ? { width: vista.ancho, height: vista.alto } : undefined} />
        {vista &&
          resaltes?.map(([x1, y1, x2, y2], i) => (
            <span
              key={i}
              className="resalte-pdf"
              style={{
                left: x1 * vista.escala,
                top: (altoPdf - y2) * vista.escala,
                width: (x2 - x1) * vista.escala,
                height: (y2 - y1) * vista.escala,
              }}
            />
          ))}
      </div>
    </div>
  );
}

/* ---------- el lector ---------- */

export default function LectorPdf({ bookId, onClose }: { bookId: string; onClose: () => void }) {
  const [prefs, setPrefs] = useState(cargarPreferencias);
  const [pdf, setPdf] = useState<DocumentoPdf | null>(null);
  const [meta, setMeta] = useState<BookMeta | null>(null);
  const [proporcion, setProporcion] = useState(0.707); // ancho/alto de la página (A4 por defecto)
  const [L, setL] = useState(() => medidasPdf(prefs.doble, 0.707));
  const [actual, setActual] = useState(0); // página actual (empieza en 0)
  const [indice, setIndice] = useState<EntradaIndicePdf[]>([]);
  const [marcadores, setMarcadores] = useState<Marcador[]>([]);
  const [panel, setPanel] = useState<'ajustes' | 'indice' | 'buscar' | null>(null);
  const [pestana, setPestana] = useState<'indice' | 'marcadores'>('indice');
  const [inmersivo, setInmersivo] = useState(false);
  const [arrastre, setArrastre] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consulta, setConsulta] = useState('');
  const [resultados, setResultados] = useState<ResultadoPdf[]>([]);
  const [estadoBusqueda, setEstadoBusqueda] = useState<EstadoBusqueda>('vacia');
  const [resalte, setResalte] = useState<{ pagina: number; rects: number[][] } | null>(null);

  const libroRef = useRef<HTMLDivElement>(null);
  const contenidoRef = useRef<HTMLDivElement>(null);
  const relojBarras = useRef<number | undefined>(undefined);
  const relojResalte = useRef<number | undefined>(undefined);
  const toque = useRef<{ x: number; y: number } | null>(null);
  const deslizo = useRef(false);
  const busquedaActual = useRef(0);

  const total = pdf?.numPages ?? 0;
  // En doble página se muestran de a pares (1–2, 3–4…).
  const inicio = L.doble ? actual - (actual % 2) : actual;
  const visibles = (L.doble ? [inicio, inicio + 1] : [inicio]).filter((p) => p < total);

  /* ---------- abrir el PDF ---------- */
  useEffect(() => {
    let cancelado = false;
    let doc: DocumentoPdf | null = null;
    (async () => {
      const [m, data] = await Promise.all([getBook(bookId), getBookFile(bookId)]);
      if (cancelado) return;
      if (!m || !data) {
        setError('No se encontró el libro. Puede que se haya borrado de este navegador.');
        return;
      }
      doc = await abrirPdf(data);
      if (cancelado) return cerrarPdf(doc);
      const base = (await doc.getPage(1)).getViewport({ scale: 1 });
      if (cancelado) return;
      setProporcion(base.width / base.height);
      setMeta(m);
      setMarcadores(m.bookmarks);
      setActual(Math.min(Math.max(0, Number(m.location) || 0), doc.numPages - 1));
      setPdf(doc);
      updateBook(bookId, { lastOpenedAt: Date.now() });
      const entradas = await indicePdf(doc);
      if (!cancelado) setIndice(entradas);
    })().catch((err) => {
      if (cancelado) return;
      console.error(err);
      setError('No se pudo abrir el PDF.');
    });
    return () => {
      cancelado = true;
      if (doc) cerrarPdf(doc);
    };
  }, [bookId]);

  /* ---------- medidas según la pantalla y la forma del PDF ---------- */
  useEffect(() => {
    const recalcular = () => setL((prev) => {
      const nuevo = medidasPdf(prefs.doble, proporcion);
      return mismasMedidas(prev, nuevo) ? prev : nuevo;
    });
    recalcular();
    let reloj: number | undefined;
    const alCambiar = () => {
      clearTimeout(reloj);
      reloj = window.setTimeout(recalcular, 150);
    };
    window.addEventListener('resize', alCambiar);
    return () => {
      clearTimeout(reloj);
      window.removeEventListener('resize', alCambiar);
    };
  }, [prefs.doble, proporcion]);

  useEffect(() => guardarPreferencias(prefs), [prefs]);

  /* ---------- guardar el progreso al cambiar de página ---------- */
  useEffect(() => {
    if (!pdf) return;
    updateBook(bookId, {
      location: String(inicio),
      progress: total > 1 ? inicio / (total - 1) : 0,
      page: inicio + 1,
      pages: total,
      lastOpenedAt: Date.now(),
    });
    fraseDePagina(pdf, inicio).then((excerpt) => {
      if (excerpt) updateBook(bookId, { excerpt });
    });
  }, [pdf, inicio, total, bookId]);

  /* ---------- navegación ---------- */
  function ir(dir: 1 | -1) {
    const nuevo = inicio + dir * (L.doble ? 2 : 1);
    if (nuevo < 0 || nuevo >= total) {
      libroRef.current?.animate(
        [{ transform: 'none' }, { transform: `translateX(${-dir * 8}px)` }, { transform: 'none' }],
        { duration: 260 },
      );
      return;
    }
    animarHoja(libroRef.current, contenidoRef.current, L, dir, prefs.animacion);
    setActual(nuevo);
    animarFundido(contenidoRef.current, dir, prefs.animacion);
  }

  function irAPagina(p: number) {
    setActual(Math.min(Math.max(0, p), total - 1));
    setPanel(null);
  }

  function despertar() {
    setInmersivo(false);
    clearTimeout(relojBarras.current);
    relojBarras.current = window.setTimeout(() => setInmersivo(true), 3200);
  }
  useEffect(() => {
    despertar();
    return () => clearTimeout(relojBarras.current);
  }, []);
  useEffect(() => {
    if (panel) {
      clearTimeout(relojBarras.current);
      setInmersivo(false);
    }
  }, [panel]);

  function tocarEn(x: number) {
    if (deslizo.current) {
      deslizo.current = false;
      return;
    }
    if (panel) {
      setPanel(null);
      return;
    }
    const r = libroRef.current?.getBoundingClientRect();
    if (!r) return;
    const rel = (x - r.left) / r.width;
    if (L.doble) ir(rel < 0.5 ? -1 : 1);
    else if (rel < 0.3) ir(-1);
    else if (rel > 0.7) ir(1);
    else if (inmersivo) despertar();
    else setInmersivo(true);
  }

  function finToque(x: number, y: number) {
    if (!toque.current) return;
    const dx = x - toque.current.x, dy = y - toque.current.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      deslizo.current = true;
      ir(dx < 0 ? 1 : -1);
    }
    toque.current = null;
  }

  // La última versión de la función de teclado (para que el listener vea el estado actual).
  const teclado = useRef((_: KeyboardEvent) => {});
  teclado.current = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setPanel(null);
      return;
    }
    if (e.key.toLowerCase() === 'f' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setPanel('buscar');
      return;
    }
    const destino = e.target as HTMLElement | null;
    if (destino?.matches?.('textarea, input[type="text"], input[type="search"], input[type="range"]')) return;
    if (e.key === ' ' && destino?.matches?.('button, input')) return;
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) {
      e.preventDefault();
      ir(1);
    } else if (['ArrowLeft', 'PageUp'].includes(e.key)) {
      e.preventDefault();
      ir(-1);
    }
  };
  useEffect(() => {
    const f = (e: KeyboardEvent) => teclado.current(e);
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, []);

  /* ---------- capítulo actual (según el índice del PDF) ---------- */
  const ultimaVisible = visibles[visibles.length - 1] ?? 0;
  const capituloDe = (p: number) => {
    let cap: EntradaIndicePdf | null = null;
    for (const e of indice) if (e.pagina !== null && e.pagina <= p && (!cap || e.pagina >= (cap.pagina ?? 0))) cap = e;
    return cap;
  };
  const capitulo = capituloDe(ultimaVisible);

  /* ---------- marcadores (uno por página) ---------- */
  const marcada = marcadores.some((m) => visibles.includes(Number(m.cfi)));
  function alternarMarcador() {
    if (!marcada) contarEvento('marcador');
    const nuevos = marcada
      ? marcadores.filter((m) => !visibles.includes(Number(m.cfi)))
      : [...marcadores, { cfi: String(inicio), etiqueta: capitulo?.label ?? '', pagina: inicio + 1, creado: Date.now() }]
          .sort((a, b) => Number(a.cfi) - Number(b.cfi));
    setMarcadores(nuevos);
    updateBook(bookId, { bookmarks: nuevos });
  }

  /* ---------- búsqueda ---------- */
  useEffect(() => {
    const id = ++busquedaActual.current;
    if (!pdf || normalizar(consulta).length < 2) {
      setResultados([]);
      setEstadoBusqueda('vacia');
      return;
    }
    const reloj = window.setTimeout(() => {
      setResultados([]);
      setEstadoBusqueda('buscando');
      buscarEnPdf(
        pdf,
        consulta,
        (nuevos) => setResultados((previos) => [...previos, ...nuevos]),
        () => busquedaActual.current !== id,
      ).then((fin) => {
        if (fin === 'cancelada') return;
        setEstadoBusqueda(fin);
        contarEvento('busqueda');
      });
    }, 350);
    return () => clearTimeout(reloj);
  }, [consulta, pdf]);

  const resultadosMostrados = useMemo<(ResultadoMostrado & ResultadoPdf)[]>(
    () => resultados.map((r) => ({ ...r, pagina: r.spine + 1, capitulo: capituloDe(r.spine)?.label ?? '' })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resultados, indice],
  );

  function irAResultado(r: ResultadoPdf) {
    irAPagina(r.spine);
    clearTimeout(relojResalte.current);
    setResalte({ pagina: r.spine, rects: r.rects });
    relojResalte.current = window.setTimeout(() => setResalte(null), 4000);
  }
  useEffect(() => () => clearTimeout(relojResalte.current), []);

  /* ---------- dibujar ---------- */
  const progreso = total > 1 ? inicio / (total - 1) : 0;
  const anchoLibro = L.doble ? 2 * L.pw : L.pw;
  const varsLibro = {
    '--pw': `${L.pw}px`, '--ph': `${L.ph}px`, '--mo': `${L.mo}px`, '--mi': `${L.mi}px`,
    '--mt': `${L.mt}px`, '--mb': `${L.mb}px`,
  } as CSSProperties;
  const infoPaginas = !total
    ? ''
    : visibles.length > 1
      ? `Páginas ${visibles[0] + 1}–${visibles[1] + 1} de ${total}`
      : `Página ${inicio + 1} de ${total}`;
  const cajonAbierto = panel === 'indice' || panel === 'buscar';

  return (
    <div className={`lector ${inmersivo ? 'inmersivo' : ''}`} data-tema={prefs.tema} onMouseMove={despertar}>
      <header className="barra barra-sup">
        <button className="btn-l" onClick={onClose} aria-label="Volver a la biblioteca">
          <Volver />
        </button>
        <div className="titulo">
          <b>{meta?.title ?? ''}</b>
          <span>{capitulo?.label ?? ''}</span>
        </div>
        <div className="grupo-btn">
          <button className="btn-l" onClick={() => setPanel(panel === 'buscar' ? null : 'buscar')} aria-label="Buscar en el libro">
            <Lupa />
          </button>
          <button className="btn-l" onClick={() => setPanel(panel === 'indice' ? null : 'indice')} aria-label="Índice">
            <Lista />
          </button>
          <button className="btn-l" onClick={alternarMarcador} aria-label="Marcar página" aria-pressed={marcada} disabled={!pdf}>
            <Cinta />
          </button>
          <button
            className="btn-l btn-aa"
            onClick={() => setPanel(panel === 'ajustes' ? null : 'ajustes')}
            aria-label="Ajustes de lectura"
            aria-expanded={panel === 'ajustes'}
          >
            Aa
          </button>
        </div>
      </header>

      <main
        className="escenario"
        onClick={(e) => tocarEn(e.clientX)}
        onPointerDown={(e) => {
          if (e.pointerType !== 'mouse') {
            toque.current = { x: e.clientX, y: e.clientY };
            deslizo.current = false;
          }
        }}
        onPointerUp={(e) => e.pointerType !== 'mouse' && finToque(e.clientX, e.clientY)}
      >
        {error ? (
          <p className="aviso">{error}</p>
        ) : (
          <div className={`libro ${L.doble ? '' : 'una'}`} ref={libroRef} style={varsLibro}>
            <div className="canto canto-izq" style={{ '--w': `${2 + 10 * progreso}px` } as CSSProperties} />
            <div className="canto canto-der" style={{ '--w': `${2 + 10 * (1 - progreso)}px` } as CSSProperties} />
            {L.doble ? (
              <>
                <Pagina lado="izq" cabecera="" folio={pdf ? inicio + 1 : null} />
                <Pagina lado="der" cabecera="" folio={visibles[1] !== undefined ? visibles[1] + 1 : null} />
              </>
            ) : (
              <Pagina lado="unica" cabecera="" folio={pdf ? inicio + 1 : null} />
            )}
            <div ref={contenidoRef} className="contenido-pdf">
              {pdf &&
                visibles.map((p, i) => (
                  <PaginaPdf
                    key={i}
                    pdf={pdf}
                    indice={p}
                    left={(i === 1 ? L.pw : 0) + L.mo}
                    top={L.mt}
                    ancho={L.cw}
                    alto={L.ch}
                    tema={prefs.tema}
                    resaltes={resalte?.pagina === p ? resalte.rects : null}
                  />
                ))}
            </div>
            {!pdf && <p className="cargando">Abriendo PDF…</p>}
            <div className={`cinta ${marcada ? 'activa' : ''}`} style={{ right: L.doble ? '12%' : '10%' }} />
          </div>
        )}
      </main>

      <footer className="barra barra-inf">
        <span className="info-b">{arrastre !== null ? `Ir a la página ${arrastre + 1}` : infoPaginas}</span>
        <input
          className="rango"
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          value={arrastre ?? inicio}
          disabled={!total}
          aria-label="Posición en el libro"
          onChange={(e) => setArrastre(Number(e.target.value))}
          onPointerUp={() => {
            if (arrastre !== null) irAPagina(arrastre);
            setArrastre(null);
          }}
          onKeyUp={() => {
            if (arrastre !== null) irAPagina(arrastre);
            setArrastre(null);
          }}
        />
        <span className="info-b">{total ? `${Math.round(progreso * 100)} % leído` : ''}</span>
      </footer>

      <PanelAjustes abierto={panel === 'ajustes'} prefs={prefs} onCambiar={(c) => setPrefs({ ...prefs, ...c })} soloTema />

      <aside className={`cajon ${cajonAbierto ? 'abierto' : ''}`} aria-label="Índice" aria-hidden={!cajonAbierto}>
        <div className="cajon-cab">
          <div>
            <p className="cajon-sup">{meta?.title}</p>
            <h2>{panel === 'buscar' ? 'Buscar' : pestana === 'indice' ? 'Índice' : 'Marcadores'}</h2>
          </div>
          <button className="btn-l" onClick={() => setPanel(null)} aria-label="Cerrar">
            <Cerrar />
          </button>
        </div>
        {panel === 'buscar' ? (
          <PanelBusqueda
            abierto={panel === 'buscar'}
            consulta={consulta}
            onConsulta={setConsulta}
            estado={estadoBusqueda}
            resultados={resultadosMostrados}
            onIr={irAResultado}
          />
        ) : (
          <>
            <div className="pestanas" role="tablist">
              {(['indice', 'marcadores'] as const).map((p) => (
                <button key={p} role="tab" aria-selected={pestana === p} onClick={() => setPestana(p)}>
                  {p === 'indice' ? 'Índice' : 'Marcadores'}
                  {p === 'marcadores' && marcadores.length > 0 && <span className="cuenta">{marcadores.length}</span>}
                </button>
              ))}
            </div>
            {pestana === 'indice' &&
              (indice.length === 0 ? (
                <p className="vacio">Este PDF no trae índice. Podés usar la barra de abajo o la búsqueda para moverte.</p>
              ) : (
                <ol className="lista">
                  {indice.map((e, i) => (
                    <li key={i}>
                      <button
                        className={`item ${e === capitulo ? 'actual' : ''}`}
                        style={{ paddingLeft: e.nivel * 16 }}
                        disabled={e.pagina === null}
                        onClick={() => e.pagina !== null && irAPagina(e.pagina)}
                      >
                        <span className="tit">{e.label}</span>
                        <span className="lider" />
                        <span className="pag">{e.pagina !== null ? e.pagina + 1 : ''}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              ))}
            {pestana === 'marcadores' &&
              (marcadores.length === 0 ? (
                <p className="vacio">Tocá la cinta de arriba para marcar una página.</p>
              ) : (
                <ul className="lista">
                  {marcadores.map((m) => (
                    <li key={m.cfi}>
                      <button className="item" onClick={() => irAPagina(Number(m.cfi))}>
                        <span className="tit">{m.etiqueta || `Página ${Number(m.cfi) + 1}`}</span>
                        <span className="lider" />
                        <span className="pag">{m.pagina ?? ''}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ))}
          </>
        )}
      </aside>
      <div className={`velo ${cajonAbierto ? 'visible' : ''}`} onClick={() => setPanel(null)} />
    </div>
  );
}
