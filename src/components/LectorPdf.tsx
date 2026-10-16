// Lector de PDF: muestra las páginas del PDF tal cual (con fórmulas, tablas y gráficos),
// dentro del mismo diseño de libro que los EPUB.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as EventoMouse } from 'react';
import { getBook, getBookFile, updateBook, type BookMeta, type ColorSubrayado, type Marcador, type Subrayado } from '../db';
import { COLORES_SUBRAYADO, descargarSubrayados } from '../subrayados';
import { EditorNota, ListaSubrayados, MenuSubrayado, type PosicionMenu } from './Subrayados';
import PanelDiccionario from './Diccionario';
import { esUnaPalabra } from '../diccionario';
import { cargarPreferencias, FUENTES, guardarPreferencias, TAMANOS, type Preferencias, type Tema } from '../preferencias';
import {
  abrirPdf, buscarEnPdf, CapaTexto, cerrarPdf, enlacesDePagina, fraseDePagina, idiomaDe, indicePdf, paginaDeEnlace, parrafosDePagina,
  type DocumentoPdf, type EnlacePdf, type Parrafo, type EntradaIndicePdf, type ResultadoPdf,
} from '../pdf';
import { normalizar } from '../busqueda';
import {
  animarFundido, animarHoja, medidas, medidasPdf, mismasMedidas, type Medidas, modoCompleto, Pagina, PanelAjustes, pedirPantallaCompleta,
  usePantallaEncendida, useSalidaPantallaCompleta,
} from './MarcoLibro';
import PanelBusqueda, { type EstadoBusqueda, type ResultadoMostrado } from './Busqueda';
import { Cerrar, Cinta, Lista, Lupa, Volver } from './Iconos';
import './Reader.css';
import GuiaLector, { guiaYaVista } from './Guia';
import { contarEvento } from '../estadisticas';
import { MarcasIndice, PastillaVolver, useIndiceEnCapitulo, usePuntoLectura } from './PuntoLectura';


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

// Tope de píxeles por página: con mucho zoom el canvas sería enorme (y los celulares tienen límite).
const MAX_PIXELES = 10_000_000;

interface PaginaPdfProps {
  pdf: DocumentoPdf;
  indice: number; // empieza en 0
  left: number;
  top: number;
  ancho: number;
  alto: number;
  proporcion: number; // forma aproximada de la página, para ocupar su lugar antes de dibujarse
  tema: Tema;
  resaltes: number[][] | null; // rectángulos en unidades del PDF (búsqueda)
  subrayados: Subrayado[]; // los de esta página
  onTocarSubrayado: (id: string, rect: DOMRect) => void;
  onDibujada?: () => void;
  onIrAPagina: (pagina: number) => void; // enlaces internos del PDF ("ver página 12")
}

function PaginaPdf({ pdf, indice, left, top, ancho, alto, proporcion, tema, resaltes, subrayados, onTocarSubrayado, onDibujada, onIrAPagina }: PaginaPdfProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const capaRef = useRef<HTMLDivElement>(null);
  const lienzoRef = useRef<HTMLDivElement>(null);
  // vista: cómo quedó dibujada la página la última vez (escala y tamaño en pantalla, y para qué caja).
  const [vista, setVista] = useState<{ escala: number; ancho: number; alto: number; caja: number } | null>(null);
  const yaDibujada = useRef(false);
  const avisar = useRef(onDibujada);
  avisar.current = onDibujada;
  const [enlaces, setEnlaces] = useState<EnlacePdf[]>([]);

  useEffect(() => {
    let cancelado = false;
    enlacesDePagina(pdf, indice)
      .then((e) => !cancelado && setEnlaces(e))
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [pdf, indice]);

  useEffect(() => {
    let cancelado = false;
    let tarea: { cancel(): void } | null = null;
    let capaTexto: { cancel(): void } | null = null;
    (async () => {
      // Si ya estaba dibujada y cambia el tamaño (zoom), esperamos un poquito: mientras se pellizca
      // llegan muchos tamaños seguidos y solo vale la pena dibujar el último.
      if (yaDibujada.current) await new Promise((r) => setTimeout(r, 120));
      if (cancelado) return;
      const pagina = await pdf.getPage(indice + 1);
      if (cancelado) return;
      const base = pagina.getViewport({ scale: 1 });
      const escala = Math.min(ancho / base.width, alto / base.height);
      // Más resolución en pantallas de alta densidad (celulares), con tope para no gastar memoria.
      const pixeles = base.width * escala * base.height * escala;
      const densidad = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_PIXELES / pixeles));
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
      temporal.width = temporal.height = 0; // libera la memoria del canvas auxiliar
      setVista({ escala, ancho: base.width * escala, alto: base.height * escala, caja: ancho });
      yaDibujada.current = true;
      avisar.current?.();

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

  // Tamaño en pantalla. Si cambió la caja (zoom) y todavía no se volvió a dibujar, se estira
  // el dibujo anterior (k) para que el cambio se vea al instante; después queda nítido.
  const k = vista ? ancho / vista.caja : 1;
  const tam = vista
    ? { width: vista.ancho * k, height: vista.alto * k }
    : { width: Math.min(ancho, alto * proporcion), height: Math.min(alto, ancho / proporcion) };
  // Los rectángulos del PDF tienen el origen abajo a la izquierda; la pantalla, arriba a la izquierda.
  const altoPdf = vista ? vista.alto / vista.escala : 0;
  return (
    <div className={`pagina-pdf pdf-${tema}`} data-pagina={indice} style={{ left, top, width: ancho, height: alto }}>
      <div className="lienzo-pdf" ref={lienzoRef} onClick={alClic} style={tam}>
        <div
          className="lienzo-escala"
          style={vista ? { width: vista.ancho, height: vista.alto, transform: k !== 1 ? `scale(${k})` : undefined } : undefined}
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
          {vista &&
            enlaces.map((e, i) => {
              const [x1, y1, x2, y2] = e.rect;
              const estilo = {
                left: Math.min(x1, x2) * vista.escala,
                top: (altoPdf - Math.max(y1, y2)) * vista.escala,
                width: Math.abs(x2 - x1) * vista.escala,
                height: Math.abs(y2 - y1) * vista.escala,
              };
              return e.url ? (
                <a
                  key={i}
                  className="enlace-pdf"
                  href={e.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={e.url}
                  style={estilo}
                  onClick={(ev) => ev.stopPropagation()}
                />
              ) : (
                <button
                  key={i}
                  className="enlace-pdf"
                  aria-label="Ir a otra parte del documento"
                  style={estilo}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    paginaDeEnlace(pdf, e.destino).then((p) => p !== null && onIrAPagina(p));
                  }}
                />
              );
            })}
        </div>
      </div>
    </div>
  );
}

/* ---------- modo texto: la página del PDF como texto que se acomoda ---------- */

// El texto de una página del PDF se reparte en columnas del tamaño de la hoja; si no entra,
// sigue en "partes" (como las páginas de un EPUB) que se recorren antes de pasar a la siguiente.
interface TextoPdfProps {
  pdf: DocumentoPdf;
  indice: number;
  L: Medidas;
  prefs: Preferencias;
  parte: number;
  onPartes: (cantidad: number) => void;
}

function TextoPdf({ pdf, indice, L, prefs, parte, onPartes }: TextoPdfProps) {
  const [parrafos, setParrafos] = useState<{ indice: number; lista: Parrafo[] } | null>(null);
  const columnasRef = useRef<HTMLDivElement>(null);
  const avisar = useRef(onPartes);
  avisar.current = onPartes;

  useEffect(() => {
    let cancelado = false;
    parrafosDePagina(pdf, indice)
      .then((lista) => !cancelado && setParrafos({ indice, lista }))
      .catch(() => !cancelado && setParrafos({ indice, lista: [] }));
    return () => {
      cancelado = true;
    };
  }, [pdf, indice]);

  const gap = 2 * L.mi;
  const columnas = L.doble ? 2 : 1;
  const ancho = columnas * L.cw + (columnas - 1) * gap;
  const lista = parrafos?.indice === indice ? parrafos.lista : null;

  // Cuántas partes ocupa el texto (se vuelve a medir al cambiar la letra o el tamaño).
  useLayoutEffect(() => {
    const el = columnasRef.current;
    if (!el || !lista) return;
    const medir = () => {
      const cols = Math.max(1, Math.round((el.scrollWidth + gap) / (L.cw + gap)));
      avisar.current(Math.ceil(cols / columnas));
    };
    medir();
    let vigente = true;
    document.fonts?.ready.then(() => vigente && medir());
    return () => {
      vigente = false;
    };
  }, [lista, L, gap, columnas, prefs.fuente, prefs.tam, prefs.lh]);

  return (
    <div className="texto-pdf" style={{ left: L.mo, top: L.mt, width: ancho, height: L.ch }}>
      <div
        className="texto-pdf-columnas"
        ref={columnasRef}
        lang={lista ? idiomaDe(lista) : undefined}
        style={{
          width: ancho, height: L.ch, columnCount: columnas, columnGap: gap,
          transform: `translateX(${-parte * (ancho + gap)}px)`,
          fontFamily: FUENTES[prefs.fuente].css, fontSize: TAMANOS[prefs.tam], lineHeight: prefs.lh,
        }}
      >
        {lista?.length === 0 && (
          <p className="texto-pdf-vacio">
            Esta página no tiene texto para mostrar (puede ser una imagen o una página escaneada). Para verla,
            elegí <b>Página original</b> en Aa.
          </p>
        )}
        {lista?.map((p, i) => (p.titulo ? <h3 key={i}>{p.texto}</h3> : <p key={i}>{p.texto}</p>))}
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
  const [L, setL] = useState(() => medidasPdf(prefs.doble, 0.707, modoCompleto(prefs.completa)));
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
  const [definiendo, setDefiniendo] = useState<{ texto: string; idioma: string } | null>(null); // diccionario
  const [inmersivo, setInmersivo] = useState(false);
  const [arrastre, setArrastre] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consulta, setConsulta] = useState('');
  const [resultados, setResultados] = useState<ResultadoPdf[]>([]);
  const [estadoBusqueda, setEstadoBusqueda] = useState<EstadoBusqueda>('vacia');
  const [resalte, setResalte] = useState<{ pagina: number; rects: number[][] } | null>(null);
  // Zoom (pellizcar): una sola página agrandada que se recorre arrastrando. null = página entera.
  const [zoom, setZoom] = useState<{ z: number; pagina: number } | null>(null);
  const [zoomListo, setZoomListo] = useState(false); // la página agrandada ya se dibujó
  // Modo texto: la página se lee como texto que se acomoda a la pantalla (se guarda por libro).
  const [modoTexto, setModoTexto] = useState(false);
  const [parte, setParte] = useState(0); // en modo texto, qué parte de la página se ve
  const [partes, setPartes] = useState(1);
  const alFinalDeLaPagina = useRef(false); // al volver hacia atrás se entra por la última parte

  const libroRef = useRef<HTMLDivElement>(null);
  const contenidoRef = useRef<HTMLDivElement>(null);
  const relojBarras = useRef<number | undefined>(undefined);
  const relojResalte = useRef<number | undefined>(undefined);
  const toque = useRef<{ x: number; y: number } | null>(null);
  const deslizo = useRef(false);
  const busquedaActual = useRef(0);
  const escenarioRef = useRef<HTMLElement>(null);
  const zoomRef = useRef<HTMLDivElement>(null);
  const zoomHojaRef = useRef<HTMLDivElement>(null);
  // Punto de la página (u, v entre 0 y 1) que tiene que quedar bajo el dedo (x, y) después del zoom.
  const anclaZoom = useRef<{ u: number; v: number; x: number; y: number } | null>(null);
  const ultimoToque = useRef<{ t: number; x: number; y: number } | null>(null);

  const total = pdf?.numPages ?? 0;
  // En doble página se muestran de a pares (1–2, 3–4…). En modo texto, de a una (repartida en las dos hojas).
  const deAPares = L.doble && !modoTexto;
  const inicio = deAPares ? actual - (actual % 2) : actual;
  const visibles = (deAPares ? [inicio, inicio + 1] : [inicio]).filter((p) => p < total);

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
      setModoTexto(m.modoTexto);
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
      // En modo texto se usan las medidas de los EPUB (márgenes de libro); si no, las del PDF.
      const completo = modoCompleto(prefs.completa);
      const nuevo = modoTexto ? medidas(prefs.doble, completo) : medidasPdf(prefs.doble, proporcion, completo);
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
  }, [prefs.doble, prefs.completa, proporcion, modoTexto]);

  useEffect(() => guardarPreferencias(prefs), [prefs]);
  useSalidaPantallaCompleta(() => setPrefs((p) => ({ ...p, completa: false })));
  usePantallaEncendida(prefs.pantallaEncendida, `${actual}-${parte}-${zoom?.z ?? 1}`);

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
    setZoom(null);
    // Modo texto: primero se recorren las partes de la página.
    if (modoTexto && parte + dir >= 0 && parte + dir < partes) {
      animarHoja(libroRef.current, contenidoRef.current, L, dir, prefs.animacion);
      setParte(parte + dir);
      animarFundido(contenidoRef.current, dir, prefs.animacion);
      return;
    }
    const nuevo = inicio + dir * (deAPares ? 2 : 1);
    if (nuevo < 0 || nuevo >= total) {
      libroRef.current?.animate(
        [{ transform: 'none' }, { transform: `translateX(${-dir * 8}px)` }, { transform: 'none' }],
        { duration: 260 },
      );
      return;
    }
    animarHoja(libroRef.current, contenidoRef.current, L, dir, prefs.animacion);
    alFinalDeLaPagina.current = dir < 0;
    punto.pasarPagina();
    setParte(0);
    setActual(nuevo);
    animarFundido(contenidoRef.current, dir, prefs.animacion);
  }

  function irAPagina(p: number) {
    setZoom(null);
    alFinalDeLaPagina.current = false;
    setParte(0);
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

  function tocarEn(x: number, y: number) {
    // La pantalla completa del navegador se pierde al cerrar el libro: se retoma con el primer toque.
    if (prefs.completa) pedirPantallaCompleta();
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
    // Doble toque: acerca (o vuelve a la página entera si ya hay zoom).
    const antes = ultimoToque.current;
    const dobleToque = !!antes && Date.now() - antes.t < 350 && Math.hypot(x - antes.x, y - antes.y) < 40;
    ultimoToque.current = dobleToque ? null : { t: Date.now(), x, y };
    if (zoom) {
      if (dobleToque) setZoom(null);
      else if (inmersivo) despertar();
      else setInmersivo(true);
      return;
    }
    const r = libroRef.current?.getBoundingClientRect();
    if (!r) return;
    const rel = (x - r.left) / r.width;
    // Costados: pasar página. Franja del centro: mostrar u ocultar las barras.
    // (A doble página los costados son más anchos: la franja central queda sobre el lomo.)
    const borde = L.doble ? 0.4 : 0.3;
    if (rel < borde) ir(-1);
    else if (rel > 1 - borde) ir(1);
    else if (dobleToque && !modoTexto) zoomEn(2.5, x, y);
    else if (inmersivo) despertar();
    else setInmersivo(true);
  }

  /* ---------- zoom ---------- */
  const ZOOM_MAX = 5;

  // La página que está bajo un punto de la pantalla (o la primera visible) y su lugar en pantalla.
  function paginaEn(x: number, y: number) {
    const capa = zoom ? zoomRef.current : contenidoRef.current;
    const bajo = document.elementsFromPoint(x, y)
      .map((el) => el.closest<HTMLElement>('.pagina-pdf'))
      .find((el) => el && capa?.contains(el));
    const pagina = bajo ?? capa?.querySelector<HTMLElement>('.pagina-pdf');
    const lienzo = pagina?.querySelector('.lienzo-pdf');
    if (!pagina || !lienzo) return null;
    return { indice: Number(pagina.dataset.pagina), caja: lienzo.getBoundingClientRect() };
  }

  // Lleva el zoom a z, dejando quieto el punto (x, y) de la pantalla.
  function zoomEn(z: number, x: number, y: number) {
    const p = paginaEn(x, y);
    if (!p) return;
    if (z < 1.1) {
      setZoom(null);
      return;
    }
    anclaZoom.current = { u: (x - p.caja.left) / p.caja.width, v: (y - p.caja.top) / p.caja.height, x, y };
    if (!zoom) {
      setZoomListo(false);
      contarEvento('zoom-pdf');
    }
    setZoom({ z: Math.min(z, ZOOM_MAX), pagina: p.indice });
  }

  // Después de cambiar el zoom, se mueve el desplazamiento para que el punto anclado quede bajo el dedo.
  useLayoutEffect(() => {
    const ancla = anclaZoom.current, capa = zoomRef.current;
    if (!zoom || !ancla || !capa) return;
    anclaZoom.current = null;
    const caja = capa.querySelector('.lienzo-pdf')?.getBoundingClientRect();
    if (!caja) return;
    capa.scrollLeft += caja.left + ancla.u * caja.width - ancla.x;
    capa.scrollTop += caja.top + ancla.v * caja.height - ancla.y;
  }, [zoom]);

  // Pellizcar (dos dedos) y, en la compu, Ctrl + rueda (así llega el pellizco del touchpad).
  // Mientras se pellizca solo se estira la imagen (rápido); al soltar se dibuja de nuevo, nítida.
  const pellizco = useRef<{
    d0: number; x0: number; y0: number; z0: number; f: number; x: number; y: number;
    el: HTMLElement; indice: number; u: number; v: number;
  } | null>(null);
  const gestos = useRef({
    empezar: (_: TouchEvent) => {},
    mover: (_: TouchEvent) => {},
    terminar: () => {},
    rueda: (_: WheelEvent) => {},
  });
  const dosDedos = (t: TouchList) => ({
    d: Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY),
    x: (t[0].clientX + t[1].clientX) / 2,
    y: (t[0].clientY + t[1].clientY) / 2,
  });
  gestos.current = {
    empezar(e) {
      if (e.touches.length !== 2 || !pdf || panel || modoTexto) return;
      const { d, x, y } = dosDedos(e.touches);
      const p = paginaEn(x, y);
      const el = zoom ? zoomHojaRef.current : libroRef.current;
      if (!p || !el || d < 10) return;
      toque.current = null; // que no cuente como deslizar para pasar de página
      deslizo.current = true;
      window.getSelection()?.removeAllRanges();
      setMenu(null);
      const caja = el.getBoundingClientRect();
      el.style.transformOrigin = `${x - caja.left}px ${y - caja.top}px`;
      pellizco.current = {
        d0: d, x0: x, y0: y, z0: zoom?.z ?? 1, f: 1, x, y, el, indice: p.indice,
        u: (x - p.caja.left) / p.caja.width, v: (y - p.caja.top) / p.caja.height,
      };
    },
    mover(e) {
      const p = pellizco.current;
      if (!p || e.touches.length !== 2) return;
      e.preventDefault(); // que el navegador no agrande toda la página ni la desplace
      const { d, x, y } = dosDedos(e.touches);
      p.f = Math.min(ZOOM_MAX, Math.max(0.6, (p.z0 * d) / p.d0)) / p.z0;
      p.x = x;
      p.y = y;
      p.el.style.transform = `translate(${x - p.x0}px, ${y - p.y0}px) scale(${p.f})`;
    },
    terminar() {
      const p = pellizco.current;
      if (!p) return;
      pellizco.current = null;
      const z = p.z0 * p.f;
      if (z < 1.1) {
        p.el.style.transform = '';
        setZoom(null);
        return;
      }
      anclaZoom.current = { u: p.u, v: p.v, x: p.x, y: p.y };
      if (!zoom) {
        // Al entrar al zoom, el libro estirado queda a la vista hasta que la página grande se dibuje.
        setZoomListo(false);
        contarEvento('zoom-pdf');
      } else p.el.style.transform = '';
      setZoom({ z: Math.min(z, ZOOM_MAX), pagina: p.indice });
    },
    rueda(e) {
      if (!e.ctrlKey || !pdf || panel || modoTexto) return;
      e.preventDefault();
      zoomEn((zoom?.z ?? 1) * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    },
  };
  useEffect(() => {
    const el = escenarioRef.current;
    if (!el) return;
    const empezar = (e: TouchEvent) => gestos.current.empezar(e);
    const mover = (e: TouchEvent) => gestos.current.mover(e);
    const terminar = (e: TouchEvent) => {
      if (e.touches.length < 2) gestos.current.terminar();
    };
    const rueda = (e: WheelEvent) => gestos.current.rueda(e);
    el.addEventListener('touchstart', empezar, { passive: true });
    el.addEventListener('touchmove', mover, { passive: false });
    el.addEventListener('touchend', terminar);
    el.addEventListener('touchcancel', terminar);
    el.addEventListener('wheel', rueda, { passive: false });
    return () => {
      el.removeEventListener('touchstart', empezar);
      el.removeEventListener('touchmove', mover);
      el.removeEventListener('touchend', terminar);
      el.removeEventListener('touchcancel', terminar);
      el.removeEventListener('wheel', rueda);
    };
  }, []);

  // Cuando la página agrandada ya está dibujada, el libro (que quedó estirado) vuelve a su lugar.
  useEffect(() => {
    const libro = libroRef.current;
    if (libro && (zoomListo || !zoom)) libro.style.transform = '';
  }, [zoomListo, zoom]);

  function finToque(x: number, y: number) {
    if (!toque.current || zoom) return;
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
    // Con el diccionario abierto, el teclado no mueve el libro (el panel se cierra con Escape).
    if (definiendo) return;
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

  /* ---------- volver a donde iba (si está releyendo más atrás) ---------- */
  const punto = usePuntoLectura(bookId, pdf ? { destino: String(inicio), pagina: inicio + 1 } : null, meta?.volverA, deAPares ? 5 : 3);
  useIndiceEnCapitulo(panel === 'indice' && pestana === 'indice');
  const capituloIbas = punto.volver ? capituloDe(Number(punto.volver.destino)) : null;
  const marcadoresPorCapitulo = new Map<EntradaIndicePdf, number>();
  for (const m of marcadores) {
    const c = capituloDe(Number(m.cfi));
    if (c) marcadoresPorCapitulo.set(c, (marcadoresPorCapitulo.get(c) ?? 0) + 1);
  }

  /* ---------- modo texto ---------- */
  function cambiarVista(texto: boolean) {
    if (texto === modoTexto) return;
    setZoom(null);
    setMenu(null);
    setParte(0);
    alFinalDeLaPagina.current = false;
    setModoTexto(texto);
    updateBook(bookId, { modoTexto: texto });
    if (texto) contarEvento('modo-texto');
  }

  function alMedirPartes(n: number) {
    setPartes(n);
    if (alFinalDeLaPagina.current) {
      alFinalDeLaPagina.current = false;
      setParte(n - 1);
    } else setParte((p) => Math.min(p, n - 1));
  }

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
        if (!texto || !pagina || !lienzo) return;
        if (!contenidoRef.current?.contains(pagina) && !zoomRef.current?.contains(pagina)) return;
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
    : modoTexto && partes > 1
      ? `Página ${inicio + 1} de ${total} · parte ${parte + 1} de ${partes}`
    : visibles.length > 1
      ? `Páginas ${visibles[0] + 1}–${visibles[1] + 1} de ${total}`
      : `Página ${inicio + 1} de ${total}`;
  const cajonAbierto = panel === 'indice' || panel === 'buscar';

  return (
    <div className={`lector ${inmersivo ? 'inmersivo' : ''} ${L.completo ? 'completo' : ''}`} data-tema={prefs.tema} onPointerMove={(e) => e.pointerType === 'mouse' && despertar()}>
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
        ref={escenarioRef}
        onClick={(e) => tocarEn(e.clientX, e.clientY)}
        onPointerDown={(e) => {
          if (e.pointerType !== 'mouse' && e.isPrimary) {
            toque.current = { x: e.clientX, y: e.clientY };
            deslizo.current = false;
          }
        }}
        onPointerUp={(e) => e.pointerType !== 'mouse' && finToque(e.clientX, e.clientY)}
      >
        {error ? (
          <p className="aviso">{error}</p>
        ) : (
          <div
            className={`libro ${L.doble ? '' : 'una'}`}
            ref={libroRef}
            style={{ ...varsLibro, visibility: zoom && zoomListo ? 'hidden' : undefined }}
          >
            <div className="canto canto-izq" style={{ '--w': `${2 + 10 * progreso}px` } as CSSProperties} />
            <div className="canto canto-der" style={{ '--w': `${2 + 10 * (1 - progreso)}px` } as CSSProperties} />
            {L.doble ? (
              <>
                <Pagina lado="izq" cabecera="" folio={pdf ? inicio + 1 : null} />
                <Pagina lado="der" cabecera="" folio={!modoTexto && visibles[1] !== undefined ? visibles[1] + 1 : null} />
              </>
            ) : (
              <Pagina lado="unica" cabecera="" folio={pdf ? inicio + 1 : null} />
            )}
            <div ref={contenidoRef} className="contenido-pdf">
              {pdf && modoTexto && (
                <TextoPdf pdf={pdf} indice={inicio} L={L} prefs={prefs} parte={parte} onPartes={alMedirPartes} />
              )}
              {pdf && !modoTexto &&
                visibles.map((p, i) => (
                  <PaginaPdf
                    key={i}
                    pdf={pdf}
                    indice={p}
                    left={(i === 1 ? L.pw : 0) + L.mo}
                    top={L.mt}
                    ancho={L.cw}
                    alto={L.ch}
                    proporcion={proporcion}
                    tema={prefs.tema}
                    resaltes={resalte?.pagina === p ? resalte.rects : null}
                    subrayados={subrayados.filter((s) => s.pdf?.pagina === p)}
                    onTocarSubrayado={(id, r) =>
                      setMenu({ posicion: { x: r.left + r.width / 2, arriba: r.top, abajo: r.bottom }, id })
                    }
                    onIrAPagina={irAPagina}
                  />
                ))}
            </div>
            {!pdf && <p className="cargando">Abriendo PDF…</p>}
            <div className={`cinta ${marcada ? 'activa' : ''}`} style={{ right: L.doble ? '12%' : '10%' }} />
          </div>
        )}
        {pdf && zoom && (
          <div className="zoom-pdf" ref={zoomRef} style={{ opacity: zoomListo ? 1 : 0 }}>
            <div className="zoom-hoja" ref={zoomHojaRef} style={{ width: L.cw * zoom.z, height: L.ch * zoom.z }}>
              <PaginaPdf
                pdf={pdf}
                indice={zoom.pagina}
                left={0}
                top={0}
                ancho={L.cw * zoom.z}
                alto={L.ch * zoom.z}
                proporcion={proporcion}
                tema={prefs.tema}
                resaltes={resalte?.pagina === zoom.pagina ? resalte.rects : null}
                subrayados={subrayados.filter((s) => s.pdf?.pagina === zoom.pagina)}
                onTocarSubrayado={(id, r) =>
                  setMenu({ posicion: { x: r.left + r.width / 2, arriba: r.top, abajo: r.bottom }, id })
                }
                onDibujada={() => setZoomListo(true)}
                onIrAPagina={irAPagina}
              />
            </div>
          </div>
        )}
      </main>

      {zoom && (
        <div className="pastilla-zoom">
          <span>{Math.round(zoom.z * 100)} %</span>
          <button onClick={() => setZoom(null)}>Ver página entera</button>
        </div>
      )}

      {punto.volver && !zoom && !panel && (
        <PastillaVolver
          pagina={punto.volver.pagina}
          onVolver={() => {
            const destino = punto.usar();
            if (destino !== null) irAPagina(Number(destino));
          }}
          onDescartar={punto.descartar}
        />
      )}

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
        soloTema={!modoTexto}
        vistaPdf={{ texto: modoTexto, onCambiar: cambiarVista }}
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
          onDefinir={
            menu.nuevo && pdf && esUnaPalabra(menu.nuevo.texto)
              ? () => {
                  const { texto, pagina } = menu.nuevo!;
                  cerrarMenu();
                  contarEvento('diccionario');
                  // El idioma se adivina por el texto de la página (los PDF casi nunca lo dicen).
                  parrafosDePagina(pdf, pagina)
                    .then((p) => idiomaDe(p))
                    .catch(() => 'es')
                    .then((idioma) => setDefiniendo({ texto, idioma }));
                }
              : undefined
          }
        />
      )}
      {definiendo && (
        <PanelDiccionario texto={definiendo.texto} idioma={definiendo.idioma} onCerrar={() => setDefiniendo(null)} />
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
                        <MarcasIndice aca={e === capitulo} ibas={e === capituloIbas} marcadores={marcadoresPorCapitulo.get(e) ?? 0} />
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
