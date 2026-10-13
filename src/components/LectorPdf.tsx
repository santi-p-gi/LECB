// Lector de PDF: muestra las páginas del PDF tal cual (con fórmulas, tablas y gráficos),
// dentro del mismo diseño de libro que los EPUB.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as EventoMouse } from 'react';
import { getBook, getBookFile, updateBook, type BookMeta, type ColorSubrayado, type Marcador, type Subrayado } from '../db';
import { COLORES_SUBRAYADO, descargarSubrayados } from '../subrayados';
import { EditorNota, ListaSubrayados, MenuSubrayado, type PosicionMenu } from './Subrayados';
import { cargarPreferencias, guardarPreferencias, type Tema } from '../preferencias';
import {
  abrirPdf, buscarEnPdf, CapaTexto, cerrarPdf, fraseDePagina, indicePdf,
  type DocumentoPdf, type EntradaIndicePdf, type ResultadoPdf,
} from '../pdf';
import { normalizar } from '../busqueda';
import { animarFundido, animarHoja, medidasPdf, mismasMedidas, Pagina, PanelAjustes } from './MarcoLibro';
import PanelBusqueda, { type EstadoBusqueda, type ResultadoMostrado } from './Busqueda';
import { Cerrar, Cinta, Lista, Lupa, Volver } from './Iconos';
import './Reader.css';
import GuiaLector, { guiaYaVista } from './Guia';
import { contarEvento } from '../estadisticas';


/* ---------- de la selección a rectángulos guardables ---------- */

// La selección llega como muchos pedacitos (uno por palabra o fragmento de texto). Los juntamos
// en un rectángulo por renglón y los pasamos a proporciones de la página (entre 0 y 1).
function unirRenglones(rects: DOMRect[], caja: DOMRect): [number, number, number, number][] {
  const utiles = rects
    .filter((r) => r.width > 1 && r.height > 1 && r.right > caja.left && r.left < caja.right && r.bottom > caja.top && r.top < caja.bottom)
    .sort((a, b) => a.top - b.top || a.left - b.left);
  const renglones: { top: number; bottom: number; left: number; right: number }[] = [];
  for (const r of utiles) {
    const ultimo = renglones[renglones.length - 1];
    const centro = (r.top + r.bottom) / 2;
    if (ultimo && centro > ultimo.top && centro < ultimo.bottom) {
      ultimo.left = Math.min(ultimo.left, r.left);
      ultimo.right = Math.max(ultimo.right, r.right);
      ultimo.top = Math.min(ultimo.top, r.top);
      ultimo.bottom = Math.max(ultimo.bottom, r.bottom);
    } else renglones.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
  }
  const limitar = (v: number) => Math.min(1, Math.max(0, v));
  return renglones
    .map((g): [number, number, number, number] => {
      const x = limitar((g.left - caja.left) / caja.width);
      const y = limitar((g.top - caja.top) / caja.height);
      return [x, y, limitar((g.right - caja.left) / caja.width) - x, limitar((g.bottom - caja.top) / caja.height) - y];
    })
    .filter(([, , w, h]) => w > 0.002 && h > 0.002);
}

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
  subrayados: Subrayado[]; // los de esta página
  onTocarSubrayado: (id: string, rect: DOMRect) => void;
}

function PaginaPdf({ pdf, indice, left, top, ancho, alto, tema, resaltes, subrayados, onTocarSubrayado }: PaginaPdfProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const capaRef = useRef<HTMLDivElement>(null);
  const lienzoRef = useRef<HTMLDivElement>(null);
  const [vista, setVista] = useState<{ escala: number; ancho: number; alto: number } | null>(null);

  useEffect(() => {
    let cancelado = false;
    let tarea: { cancel(): void } | null = null;
    let capaTexto: { cancel(): void } | null = null;
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

      // Encima del dibujo va el texto real, invisible, en la misma posición: así se puede seleccionar.
      const capa = capaRef.current;
      if (!capa) return;
      capa.replaceChildren();
      capa.style.setProperty('--total-scale-factor', String(escala));
      const nueva = new CapaTexto({
        textContentSource: pagina.streamTextContent(),
        container: capa,
        viewport: pagina.getViewport({ scale: escala }),
      });
      capaTexto = nueva;
      await nueva.render();
    })().catch((err) => {
      const nombre = (err as { name?: string })?.name;
      if (!cancelado && nombre !== 'RenderingCancelledException' && nombre !== 'AbortException') console.error(err);
    });
    return () => {
      cancelado = true;
      tarea?.cancel();
      capaTexto?.cancel();
    };
  }, [pdf, indice, ancho, alto]);

  // Clic sobre un subrayado: abre su menú (y no pasa de página).
  function alClic(e: EventoMouse) {
    if (window.getSelection()?.toString()) return;
    const caja = lienzoRef.current?.getBoundingClientRect();
    if (!caja) return;
    const x = (e.clientX - caja.left) / caja.width, y = (e.clientY - caja.top) / caja.height;
    for (const s of subrayados) {
      const tocado = s.pdf?.rects.find(([rx, ry, rw, rh]) => x >= rx && x <= rx + rw && y >= ry && y <= ry + rh);
      if (tocado) {
        e.stopPropagation();
        const [rx, ry, rw, rh] = tocado;
        onTocarSubrayado(s.id, new DOMRect(caja.left + rx * caja.width, caja.top + ry * caja.height, rw * caja.width, rh * caja.height));
        return;
      }
    }
  }

  // Los rectángulos del PDF tienen el origen abajo a la izquierda; la pantalla, arriba a la izquierda.
  const altoPdf = vista ? vista.alto / vista.escala : 0;
  return (
    <div className={`pagina-pdf pdf-${tema}`} data-pagina={indice} style={{ left, top, width: ancho, height: alto }}>
      <div
        className="lienzo-pdf"
        ref={lienzoRef}
        onClick={alClic}
        style={vista ? { width: vista.ancho, height: vista.alto } : undefined}
      >
        <canvas ref={canvasRef} style={vista ? { width: vista.ancho, height: vista.alto } : undefined} />
        {/* Subrayados: debajo de la capa de texto, para que se pueda seguir seleccionando encima */}
        {subrayados.flatMap((s) =>
          (s.pdf?.rects ?? []).map(([x, y, w, h], i) => (
            <span
              key={`${s.id}-${i}`}
              className="subrayado-pdf"
              style={{
                left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%`,
                '--color': COLORES_SUBRAYADO[s.color].color,
              } as CSSProperties}
            />
          )),
        )}
        <div className="textLayer" ref={capaRef} />
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
  const [pestana, setPestana] = useState<'indice' | 'marcadores' | 'subrayados'>('indice');
  const [subrayados, setSubrayados] = useState<Subrayado[]>([]);
  // Menú flotante: sobre texto recién seleccionado (nuevo) o sobre un subrayado existente (id).
  const [menu, setMenu] = useState<{
    posicion: PosicionMenu;
    nuevo?: { pagina: number; rects: [number, number, number, number][]; texto: string };
    id?: string;
  } | null>(null);
  const [notaAbierta, setNotaAbierta] = useState<string | null>(null);
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
      setSubrayados(m.highlights);
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

  // La primera vez que se abre un libro (en este navegador) se muestra la guía rápida.
  const [guia, setGuia] = useState(false);
  useEffect(() => {
    if (pdf && !guiaYaVista()) setGuia(true);
  }, [pdf]);

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
    // Si se está seleccionando texto o hay un menú abierto, el clic no pasa de página.
    if (window.getSelection()?.toString()) return;
    if (menu) {
      cerrarMenu();
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
    // Con la guía abierta, el teclado no mueve el libro (Escape la cierra).
    if (guia) {
      if (e.key === 'Escape') setGuia(false);
      return;
    }
    if (e.key === 'Escape') {
      setPanel(null);
      cerrarMenu();
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

  /* ---------- subrayados y notas ---------- */
  function guardarSubrayados(nuevos: Subrayado[]) {
    setSubrayados(nuevos);
    updateBook(bookId, { highlights: nuevos });
  }

  function cerrarMenu() {
    setMenu(null);
    window.getSelection()?.removeAllRanges();
  }

  // Cuando seleccionan texto dentro de una página, aparece el menú (colores, nota, copiar).
  // Se usa "selectionchange" porque funciona igual con mouse y con el dedo (toque largo).
  useEffect(() => {
    let reloj: number | undefined;
    const alCambiarSeleccion = () => {
      clearTimeout(reloj);
      reloj = window.setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
          setMenu((m) => (m?.nuevo ? null : m));
          return;
        }
        const texto = sel.toString().replace(/\s+/g, ' ').trim();
        const rango = sel.getRangeAt(0);
        const inicioEl = rango.startContainer.nodeType === Node.ELEMENT_NODE
          ? (rango.startContainer as Element)
          : rango.startContainer.parentElement;
        const pagina = inicioEl?.closest<HTMLElement>('.pagina-pdf');
        const lienzo = pagina?.querySelector('.lienzo-pdf');
        if (!texto || !pagina || !lienzo || !contenidoRef.current?.contains(pagina)) return;
        const caja = lienzo.getBoundingClientRect();
        const rects = unirRenglones([...rango.getClientRects()], caja);
        if (!rects.length) return;
        const marco = rango.getBoundingClientRect();
        setMenu({
          posicion: { x: marco.left + marco.width / 2, arriba: marco.top, abajo: marco.bottom },
          nuevo: { pagina: Number(pagina.dataset.pagina), rects, texto },
        });
      }, 250);
    };
    document.addEventListener('selectionchange', alCambiarSeleccion);
    return () => {
      clearTimeout(reloj);
      document.removeEventListener('selectionchange', alCambiarSeleccion);
    };
  }, []);

  function crearSubrayado(color: ColorSubrayado, conNota = false) {
    if (!menu?.nuevo) return;
    const { pagina, rects, texto } = menu.nuevo;
    const id = crypto.randomUUID();
    const nuevo: Subrayado = {
      id,
      cfi: `pdf-${pagina}-${id}`, // en PDF no hay CFI: un identificador único alcanza
      texto,
      color,
      nota: null,
      etiqueta: capituloDe(pagina)?.label ?? '',
      pagina: pagina + 1,
      creado: Date.now(),
      pdf: { pagina, rects },
    };
    // Ordenados por página y, dentro de la página, de arriba hacia abajo.
    const orden = (s: Subrayado) => (s.pdf?.pagina ?? 0) * 10 + (s.pdf?.rects[0]?.[1] ?? 0);
    guardarSubrayados([...subrayados, nuevo].sort((a, b) => orden(a) - orden(b)));
    contarEvento('subrayado');
    cerrarMenu();
    if (conNota) setNotaAbierta(id);
  }

  function cambiarColor(id: string, color: ColorSubrayado) {
    guardarSubrayados(subrayados.map((s) => (s.id === id ? { ...s, color } : s)));
    setMenu(null);
  }

  function borrarSubrayado(id: string) {
    const s = subrayados.find((x) => x.id === id);
    if (s?.nota && !confirm('Este subrayado tiene una nota. ¿Borrar los dos?')) return;
    guardarSubrayados(subrayados.filter((x) => x.id !== id));
    setMenu(null);
  }

  function guardarNota(id: string, nota: string) {
    if (nota.trim() && !subrayados.find((s) => s.id === id)?.nota) contarEvento('nota');
    guardarSubrayados(subrayados.map((s) => (s.id === id ? { ...s, nota: nota.trim() || null } : s)));
    setNotaAbierta(null);
  }

  const subrayadoDelMenu = menu?.id ? subrayados.find((s) => s.id === menu.id) ?? null : null;
  const subrayadoConNota = notaAbierta ? subrayados.find((s) => s.id === notaAbierta) ?? null : null;

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
                    subrayados={subrayados.filter((s) => s.pdf?.pagina === p)}
                    onTocarSubrayado={(id, r) =>
                      setMenu({ posicion: { x: r.left + r.width / 2, arriba: r.top, abajo: r.bottom }, id })
                    }
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

      <PanelAjustes
        abierto={panel === 'ajustes'}
        prefs={prefs}
        onCambiar={(c) => setPrefs({ ...prefs, ...c })}
        soloTema
        onVerGuia={() => {
          setPanel(null);
          setGuia(true);
        }}
      />
      {guia && <GuiaLector conSubrayados conVoz={false} onCerrar={() => setGuia(false)} />}

      {menu && (
        <MenuSubrayado
          posicion={menu.posicion}
          colorActual={subrayadoDelMenu?.color ?? null}
          tieneNota={!!subrayadoDelMenu?.nota}
          onColor={(c) => (subrayadoDelMenu ? cambiarColor(subrayadoDelMenu.id, c) : crearSubrayado(c))}
          onNota={() => {
            if (subrayadoDelMenu) {
              setNotaAbierta(subrayadoDelMenu.id);
              setMenu(null);
            } else crearSubrayado('amarillo', true);
          }}
          onCopiar={
            menu.nuevo
              ? () => {
                  navigator.clipboard?.writeText(menu.nuevo!.texto).catch(() => {});
                  cerrarMenu();
                }
              : undefined
          }
          onBorrar={subrayadoDelMenu ? () => borrarSubrayado(subrayadoDelMenu.id) : undefined}
        />
      )}
      {subrayadoConNota && (
        <EditorNota
          texto={subrayadoConNota.texto}
          notaInicial={subrayadoConNota.nota ?? ''}
          onGuardar={(nota) => guardarNota(subrayadoConNota.id, nota)}
          onCancelar={() => setNotaAbierta(null)}
        />
      )}

      <aside className={`cajon ${cajonAbierto ? 'abierto' : ''}`} aria-label="Índice" aria-hidden={!cajonAbierto}>
        <div className="cajon-cab">
          <div>
            <p className="cajon-sup">{meta?.title}</p>
            <h2>{panel === 'buscar' ? 'Buscar' : { indice: 'Índice', marcadores: 'Marcadores', subrayados: 'Subrayados' }[pestana]}</h2>
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
              {(['indice', 'marcadores', 'subrayados'] as const).map((p) => (
                <button key={p} role="tab" aria-selected={pestana === p} onClick={() => setPestana(p)}>
                  {{ indice: 'Índice', marcadores: 'Marcadores', subrayados: 'Subrayados' }[p]}
                  {p === 'marcadores' && marcadores.length > 0 && <span className="cuenta">{marcadores.length}</span>}
                  {p === 'subrayados' && subrayados.length > 0 && <span className="cuenta">{subrayados.length}</span>}
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
            {pestana === 'subrayados' && (
              <ListaSubrayados
                subrayados={subrayados}
                onIr={(sub) => sub.pdf && irAPagina(sub.pdf.pagina)}
                onNota={(sub) => setNotaAbierta(sub.id)}
                onBorrar={(sub) => borrarSubrayado(sub.id)}
                onExportar={() => meta && descargarSubrayados(meta, subrayados)}
              />
            )}
          </>
        )}
      </aside>
      <div className={`velo ${cajonAbierto ? 'visible' : ''}`} onClick={() => setPanel(null)} />
    </div>
  );
}
