// Pantalla de lectura (maqueta "lector.html").
// epub.js se encarga de paginar el texto del libro; nosotros dibujamos el "libro" alrededor:
// hojas, lomo, cantos, cabeceras, números de página, barras, índice y ajustes.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { EpubCFI, type Book, type Rendition } from 'epubjs';
import { abrirEpub, calcularPaginas, ubicarCapitulos } from '../epub';
import { getBook, getBookFile, updateBook, type BookMeta, type Marcador } from '../db';
import {
  cargarPreferencias, guardarPreferencias, FUENTES, INTERLINEADOS, TAMANOS, TEMAS,
  type Fuente, type Preferencias, type Tema,
} from '../preferencias';
import { Cerrar, Cinta, Interlineado, Lista, Volver } from './Iconos';
import './Reader.css';

interface ReaderProps {
  bookId: string;
  onClose: () => void;
}

// Cuántos caracteres cuentan como una "página". Así el número de página es el mismo
// en el celular y en la compu, aunque en pantalla entre más o menos texto.
const CARACTERES_POR_PAGINA = 1500;
const CARACTERES_POR_MINUTO = 1150; // ~230 palabras por minuto

// Fuentes que se cargan también dentro del libro (el texto vive en un iframe aparte).
const URL_FUENTES =
  'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..600;1,9..144,400..500&family=Literata:ital,opsz,wght@0,7..72,400..600;1,7..72,400&family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&display=swap';

const reducirMovimiento = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// Una entrada del índice, ya "aplanada" (los subcapítulos tienen nivel > 0).
interface ItemIndice {
  label: string;
  href: string;
  nivel: number;
  spine: number; // en qué archivo del libro está (-1 si no se encontró)
}

// Dónde estamos parados ahora.
interface Posicion {
  inicio: string; // CFI del principio de lo que se ve
  fin: string; // CFI del final de lo que se ve
  spine: number;
  pagSeccion: number; // página dentro del archivo actual (empieza en 1)
  pagSeccionFin: number;
}

// Datos de las "páginas" (se calculan una vez por libro y se guardan).
interface InfoPaginas {
  total: number;
  primeraDeSpine: Map<number, number>; // archivo del libro → primera página
}

/* ---------- medidas del libro según la pantalla (igual que la maqueta) ---------- */
interface Medidas {
  doble: boolean;
  pw: number; ph: number; // ancho y alto de cada página
  mo: number; mi: number; // margen exterior e interior
  mt: number; mb: number; // margen superior e inferior
  cw: number; ch: number; // ancho y alto del texto
}

function medidas(doblePref: boolean): Medidas {
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

const mismasMedidas = (a: Medidas, b: Medidas) =>
  (Object.keys(a) as (keyof Medidas)[]).every((k) => a[k] === b[k]);

// Dónde va el visor de epub.js para que cada columna de texto caiga justo dentro de su página.
// epub.js deja medio "gap" de margen a cada lado de cada columna y 20px arriba y abajo.
function geometriaVisor(L: Medidas) {
  const gap = 2 * L.mi;
  return {
    gap,
    left: L.mo - L.mi,
    top: L.mt - 20,
    width: L.doble ? 2 * (L.pw - L.mo + L.mi) : L.cw + gap,
    height: L.ch + 40,
  };
}

/* ---------- estilos que imponemos dentro del libro ---------- */
function cssTipografia(p: Preferencias) {
  return `
    body {
      font-family: ${FUENTES[p.fuente].css} !important;
      font-size: ${TAMANOS[p.tam]}px !important;
      line-height: ${p.lh} !important;
      text-align: justify; hyphens: auto; -webkit-hyphens: auto;
      widows: 2; orphans: 2; font-optical-sizing: auto; font-kerning: normal;
    }
    p, li, blockquote, dd, dt, td, th, div, span, a, em, i, b, strong, small, cite, section {
      font-family: inherit !important; line-height: inherit !important;
    }
    p { text-wrap: pretty; }
    h1, h2, h3, h4, h5, h6 {
      font-family: "Fraunces", Georgia, serif !important; font-weight: 400 !important;
      line-height: 1.3 !important; text-align: center !important; hyphens: none; text-wrap: balance;
    }
    h1 { font-size: 1.55em !important; } h2 { font-size: 1.3em !important; } h3 { font-size: 1.12em !important; }
    img, svg, video { max-width: 100%; }
    pre, code { white-space: pre-wrap; }`;
}

function cssColores(tema: Tema) {
  const t = TEMAS[tema];
  // color-scheme tiene que coincidir con el de la página: si no, el navegador
  // pinta un fondo blanco opaco detrás del texto (se notaba en el tema noche).
  return `
    :root { color-scheme: ${tema === 'noche' ? 'dark' : 'light'}; }
    html, body { background: transparent !important; color: ${t.texto} !important; }
    body * { color: inherit !important; background-color: transparent !important; }
    a, a * { color: ${t.acento} !important; text-decoration: none !important; }
    ::selection { background: ${t.acento}40; }`;
}

/* ---------- ayudas para el índice y las páginas ---------- */
function indiceSpine(book: Book, href: string) {
  const sinAncla = href.split('#')[0];
  const seccion = book.spine.get(sinAncla);
  if (seccion) return seccion.index;
  // Algunos libros guardan rutas relativas distintas: buscamos por nombre de archivo.
  const nombre = sinAncla.split('/').pop();
  let encontrado = -1;
  book.spine.each((s: { index: number; href: string }) => {
    if (encontrado < 0 && s.href.split('/').pop() === nombre) encontrado = s.index;
  });
  return encontrado;
}

interface NavItemSimple { label: string; href: string; subitems?: NavItemSimple[] }

function aplanarIndice(book: Book, items: NavItemSimple[], nivel = 0): ItemIndice[] {
  return items.flatMap((item) => [
    { label: item.label.trim().replace(/\s+/g, ' '), href: item.href, nivel, spine: indiceSpine(book, item.href) },
    ...aplanarIndice(book, item.subitems ?? [], nivel + 1),
  ]);
}

function infoPaginas(book: Book): InfoPaginas {
  const total = book.locations.length();
  const primeraDeSpine = new Map<number, number>();
  for (let i = 0; i < total; i++) {
    const cfi = book.locations.cfiFromLocation(i);
    if (typeof cfi !== 'string') continue;
    const spine = new EpubCFI(cfi).spinePos;
    if (!primeraDeSpine.has(spine)) primeraDeSpine.set(spine, i);
  }
  return { total, primeraDeSpine };
}

interface CapituloUbicado { item: ItemIndice; cfi: string }

// La frase donde quedó el lector, para mostrar "Te quedaste en…" en la biblioteca.
async function fraseEn(book: Book, cfi: string) {
  try {
    const rango = await book.getRange(cfi);
    const nodo = rango.startContainer;
    const elemento = nodo.nodeType === Node.TEXT_NODE ? nodo.parentElement : (nodo as Element);
    const bloque = elemento?.closest('p, li, blockquote, div') ?? elemento;
    const texto = (bloque?.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (texto.length < 20) return null;
    return texto.length > 160 ? texto.slice(0, 160).replace(/\s+\S*$/, '') : texto;
  } catch {
    return null;
  }
}

// Una promesa que se cumple cuando llamamos a avisar().
function crearAviso() {
  let avisar = () => {};
  const promesa = new Promise<void>((r) => (avisar = r));
  return { promesa, avisar };
}

const compararCfi = (a: string, b: string) => new EpubCFI().compare(a, b);

// Número de página (empieza en 1). Los tipos de epub.js dicen otra cosa, pero devuelve un número.
const numeroPagina = (book: Book, cfi: string) => Number(book.locations.locationFromCfi(cfi)) + 1;

export default function Reader({ bookId, onClose }: ReaderProps) {
  // useState: datos que redibujan la pantalla al cambiar.
  const [prefs, setPrefs] = useState(cargarPreferencias);
  const [L, setL] = useState(() => medidas(prefs.doble));
  const [meta, setMeta] = useState<BookMeta | null>(null);
  const [listo, setListo] = useState(false); // el libro está abierto
  const [mostrando, setMostrando] = useState(false); // ya se ve la primera página
  const [error, setError] = useState<string | null>(null);
  const [indice, setIndice] = useState<ItemIndice[]>([]);
  const [capCfis, setCapCfis] = useState<(string | null)[] | null>(null);
  const [paginas, setPaginas] = useState<InfoPaginas | null>(null);
  const [pos, setPos] = useState<Posicion | null>(null);
  const [marcadores, setMarcadores] = useState<Marcador[]>([]);
  const [panel, setPanel] = useState<'ajustes' | 'indice' | null>(null);
  const [inmersivo, setInmersivo] = useState(false);
  const [arrastre, setArrastre] = useState<number | null>(null); // valor de la barra mientras se arrastra

  // useRef: valores que no redibujan la pantalla (el libro, el visor, temporizadores...).
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const visorRef = useRef<HTMLDivElement>(null);
  const libroRef = useRef<HTMLDivElement>(null);
  const cfiActual = useRef<string | null>(null); // para reabrir en el mismo lugar al cambiar ajustes
  const temaActual = useRef(prefs.tema);
  const relojBarras = useRef<number | undefined>(undefined);
  const toque = useRef<{ x: number; y: number } | null>(null);
  const deslizo = useRef(false);
  // Se cumple cuando ya se ve la primera página: recién ahí arrancan los cálculos pesados.
  const primeraVista = useRef(crearAviso());

  /* ---------- 1. Abrir el libro ---------- */
  useEffect(() => {
    let cancelado = false;
    let book: Book | null = null;

    async function abrir() {
      const [m, data] = await Promise.all([getBook(bookId), getBookFile(bookId)]);
      if (cancelado) return;
      if (!m || !data) {
        setError('No se encontró el libro. Puede que se haya borrado de este navegador.');
        return;
      }
      book = abrirEpub(data);
      await book.ready;
      if (cancelado) return; // se cerró el lector mientras cargaba
      const navegacion = await book.loaded.navigation;
      if (cancelado) return;

      bookRef.current = book;
      cfiActual.current = m.location;
      const plano = aplanarIndice(book, navegacion.toc as NavItemSimple[]);
      setMeta(m);
      setMarcadores(m.bookmarks);
      setIndice(plano);
      if (m.locations) {
        book.locations.load(m.locations);
        setPaginas(infoPaginas(book));
      }
      setListo(true);
      updateBook(bookId, { lastOpenedAt: Date.now() });

      await primeraVista.current.promesa;
      if (cancelado) return;

      // Dónde empieza cada capítulo (se calcula una vez y se guarda).
      let capitulos = m.capitulos;
      if (!capitulos || capitulos.length !== plano.length) {
        capitulos = await ubicarCapitulos(book, plano);
        if (cancelado) return;
        updateBook(bookId, { capitulos });
      }
      setCapCfis(capitulos);

      // Primera vez que se abre: calculamos las páginas (puede tardar unos segundos).
      if (!m.locations) {
        const terminado = await calcularPaginas(book, CARACTERES_POR_PAGINA, () => cancelado);
        if (!terminado || cancelado) return;
        updateBook(bookId, { locations: book.locations.save(), pages: book.locations.length() });
        setPaginas(infoPaginas(book));
      }
    }

    abrir().catch((err) => {
      if (cancelado) return;
      console.error(err);
      setError('No se pudo abrir el libro.');
    });

    return () => {
      cancelado = true;
      bookRef.current = null;
      book?.destroy();
    };
  }, [bookId]);

  /* ---------- 2. Recalcular medidas al cambiar el tamaño de la ventana ---------- */
  useEffect(() => {
    const recalcular = () => setL((prev) => {
      const nuevo = medidas(prefs.doble);
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
  }, [prefs.doble]);

  /* ---------- 3. Mostrar el libro (se rehace al cambiar medidas o tipografía) ---------- */
  // Las funciones de eventos cambian en cada dibujo; epub.js siempre llama a la última versión.
  const eventos = useRef({ alReubicar: (_: unknown) => {}, alTeclear: (_: KeyboardEvent) => {}, alClic: (_: MouseEvent) => {}, despertar: () => {}, alTocar: (_: TouchEvent) => {}, alSoltar: (_: TouchEvent) => {} });

  useEffect(() => {
    const book = bookRef.current, visor = visorRef.current;
    if (!listo || !book || !visor) return;

    const g = geometriaVisor(L);
    // Algunas opciones (gap, minSpreadWidth) no figuran en los tipos de epub.js, pero existen.
    const opciones = {
      width: g.width,
      height: g.height,
      flow: 'paginated',
      spread: L.doble ? 'always' : 'none',
      minSpreadWidth: 1,
      gap: g.gap,
      allowScriptedContent: false,
    };
    const rendition = book.renderTo(visor, opciones);
    renditionRef.current = rendition;

    // Cada capítulo que se carga recibe nuestras fuentes, tipografía y colores.
    rendition.hooks.content.register((contents: { document: Document; addStylesheet: (url: string) => Promise<boolean> }) => {
      const doc = contents.document;
      const tipo = doc.createElement('style');
      tipo.id = 'lecb-tipografia';
      tipo.textContent = cssTipografia(prefs);
      const colores = doc.createElement('style');
      colores.id = 'lecb-colores';
      colores.textContent = cssColores(temaActual.current);
      doc.head.append(tipo, colores);
      return contents.addStylesheet(URL_FUENTES);
    });

    rendition.on('relocated', (l: unknown) => eventos.current.alReubicar(l));
    rendition.on('keydown', (e: KeyboardEvent) => eventos.current.alTeclear(e));
    rendition.on('click', (e: MouseEvent) => eventos.current.alClic(e));
    rendition.on('mousemove', () => eventos.current.despertar());
    rendition.on('touchstart', (e: TouchEvent) => eventos.current.alTocar(e));
    rendition.on('touchend', (e: TouchEvent) => eventos.current.alSoltar(e));

    rendition
      .display(cfiActual.current ?? undefined)
      .catch(() => rendition.display()) // si la posición guardada ya no sirve, desde el principio
      .then(() => {
        setMostrando(true);
        primeraVista.current.avisar();
      })
      .catch((err) => {
        console.error(err);
        setError('No se pudo mostrar el libro.');
      });

    return () => {
      renditionRef.current = null;
      try {
        rendition.destroy();
      } catch {
        // ya destruido junto con el libro
      }
      visor.innerHTML = '';
    };
    // prefs.tema no está: el color se cambia sin rehacer (efecto 4).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listo, L, prefs.fuente, prefs.tam, prefs.lh]);

  /* ---------- 4. Cambiar colores sin volver a paginar ---------- */
  useEffect(() => {
    temaActual.current = prefs.tema;
    const contenidos = (renditionRef.current?.getContents() ?? []) as unknown as { document: Document }[];
    for (const c of contenidos) {
      const estilo = c.document?.getElementById('lecb-colores');
      if (estilo) estilo.textContent = cssColores(prefs.tema);
    }
  }, [prefs.tema]);

  useEffect(() => guardarPreferencias(prefs), [prefs]);

  /* ---------- navegación ---------- */
  function ir(dir: 1 | -1) {
    const r = renditionRef.current;
    if (!r) return;
    (dir > 0 ? r.next() : r.prev()).then(() => {
      if (reducirMovimiento()) return;
      visorRef.current?.animate(
        [{ opacity: 0.25, transform: `translateX(${dir * 12}px)` }, { opacity: 1, transform: 'none' }],
        { duration: 280, easing: 'ease-out' },
      );
    });
  }

  function irA(destino: string) {
    renditionRef.current?.display(destino);
    setPanel(null);
  }

  function irAPagina(n: number) {
    const cfi = bookRef.current?.locations.cfiFromLocation(n);
    if (typeof cfi === 'string') irA(cfi);
  }

  // Barras que se esconden solas después de 3 segundos sin mover el mouse.
  function despertar() {
    setInmersivo(false);
    clearTimeout(relojBarras.current);
    relojBarras.current = window.setTimeout(() => setInmersivo(true), 3200);
  }
  useEffect(() => {
    despertar();
    return () => clearTimeout(relojBarras.current);
  }, []);
  // Con un panel abierto, las barras no se esconden.
  useEffect(() => {
    if (panel) {
      clearTimeout(relojBarras.current);
      setInmersivo(false);
    }
  }, [panel]);

  // Clic o toque sobre el libro: izquierda = atrás, derecha = adelante, centro = mostrar/ocultar barras.
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

  function inicioToque(x: number, y: number) {
    toque.current = { x, y };
    deslizo.current = false;
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

  function alTeclear(e: KeyboardEvent) {
    if ((e.target as HTMLElement | null)?.matches?.('input, textarea')) return;
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) {
      e.preventDefault();
      ir(1);
    } else if (['ArrowLeft', 'PageUp'].includes(e.key)) {
      e.preventDefault();
      ir(-1);
    } else if (e.key === 'Escape') setPanel(null);
  }
  useEffect(() => {
    const f = (e: KeyboardEvent) => eventos.current.alTeclear(e);
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, []);

  // Cada vez que cambia la página: guardamos la posición y el progreso.
  function alReubicar(l: unknown) {
    const loc = l as {
      start: { cfi: string; index: number; displayed: { page: number } };
      end: { cfi: string; displayed: { page: number } };
    };
    const book = bookRef.current;
    if (!book) return;
    cfiActual.current = loc.start.cfi;
    setPos({
      inicio: loc.start.cfi,
      fin: loc.end.cfi,
      spine: loc.start.index,
      pagSeccion: loc.start.displayed.page,
      pagSeccionFin: loc.end.displayed.page,
    });

    const cambios: Partial<BookMeta> = { location: loc.start.cfi, lastOpenedAt: Date.now() };
    const total = book.locations.length();
    if (total) {
      cambios.progress = book.locations.percentageFromCfi(loc.start.cfi);
      cambios.page = numeroPagina(book, loc.start.cfi);
      cambios.pages = total;
    }
    updateBook(bookId, cambios);
    fraseEn(book, loc.start.cfi).then((excerpt) => {
      if (excerpt && cfiActual.current === loc.start.cfi) updateBook(bookId, { excerpt });
    });
  }

  eventos.current = {
    alReubicar,
    alTeclear,
    alClic: (e: MouseEvent) => {
      // Clic dentro del libro (iframe): respetamos enlaces y texto seleccionado.
      const destino = e.target as Element | null;
      if (destino?.closest?.('a')) return;
      if (e.view?.getSelection()?.toString()) return;
      const marco = (e.view?.frameElement as HTMLElement | null)?.getBoundingClientRect();
      tocarEn((marco?.left ?? 0) + e.clientX);
    },
    despertar,
    alTocar: (e: TouchEvent) => inicioToque(e.changedTouches[0].clientX, e.changedTouches[0].clientY),
    alSoltar: (e: TouchEvent) => finToque(e.changedTouches[0].clientX, e.changedTouches[0].clientY),
  };

  /* ---------- marcadores ---------- */
  const marcadoresAqui = pos
    ? marcadores.filter((m) => compararCfi(m.cfi, pos.inicio) >= 0 && compararCfi(m.cfi, pos.fin) <= 0)
    : [];
  const marcada = marcadoresAqui.length > 0;

  function alternarMarcador() {
    if (!pos) return;
    const nuevos = marcada
      ? marcadores.filter((m) => !marcadoresAqui.includes(m))
      : [...marcadores, { cfi: pos.inicio, etiqueta: capitulo?.label ?? meta?.title ?? '', pagina: pagIni, creado: Date.now() }]
          .sort((a, b) => compararCfi(a.cfi, b.cfi));
    setMarcadores(nuevos);
    updateBook(bookId, { bookmarks: nuevos });
  }

  /* ---------- datos para dibujar ---------- */
  const book = bookRef.current;

  // Capítulos ordenados según su posición en el libro.
  const capitulosUbicados = useMemo<CapituloUbicado[]>(() => {
    if (!capCfis) return [];
    return indice
      .map((item, i) => ({ item, cfi: capCfis[i] }))
      .filter((c): c is CapituloUbicado => typeof c.cfi === 'string')
      .sort((a, b) => compararCfi(a.cfi, b.cfi));
  }, [indice, capCfis]);

  // El capítulo actual es el último que empieza antes del final de lo que se ve.
  let capitulo: ItemIndice | null = null;
  let siguienteCapitulo: CapituloUbicado | null = null;
  if (pos && capitulosUbicados.length) {
    for (const c of capitulosUbicados) {
      if (compararCfi(c.cfi, pos.fin) <= 0) capitulo = c.item;
      else {
        siguienteCapitulo = c;
        break;
      }
    }
  } else if (pos) {
    capitulo = indice.find((t) => t.spine === pos.spine) ?? null; // mientras se calculan
  }
  const capituloEmpiezaAqui =
    !!pos && capitulosUbicados.some((c) => compararCfi(c.cfi, pos.inicio) >= 0 && compararCfi(c.cfi, pos.fin) <= 0);

  const total = paginas?.total ?? 0;
  const pagIni = paginas && pos && book ? numeroPagina(book, pos.inicio) : null;
  const pagFinCruda = paginas && pos && book ? numeroPagina(book, pos.fin) : null;
  // A la derecha no hay texto cuando el capítulo termina en la página izquierda.
  const derechaVacia = L.doble && !!pos && pos.pagSeccionFin === pos.pagSeccion;
  const pagDer = pagIni && pagFinCruda ? Math.min(total, Math.max(pagFinCruda, pagIni + 1)) : null;
  const inicioCapitulo = pos?.pagSeccion === 1 || capituloEmpiezaAqui;
  const progreso = pagIni && total > 1 ? (pagIni - 1) / (total - 1) : 0;

  let infoPaginasTexto = 'Calculando páginas…';
  if (pagIni && total) {
    infoPaginasTexto = L.doble && !derechaVacia && pagDer && pagDer > pagIni
      ? `Páginas ${pagIni}–${pagDer} de ${total}`
      : `Página ${pagIni} de ${total}`;
  }

  let tiempoTexto = '';
  if (book && pagIni && capitulosUbicados.length) {
    const finCapitulo = siguienteCapitulo ? numeroPagina(book, siguienteCapitulo.cfi) - 1 : total;
    const restantes = finCapitulo - (L.doble && pagDer ? pagDer : pagIni);
    tiempoTexto = restantes > 0
      ? `${Math.max(1, Math.ceil((restantes * CARACTERES_POR_PAGINA) / CARACTERES_POR_MINUTO))} min para terminar el capítulo`
      : 'Último tramo del capítulo';
  }

  // Página donde empieza cada entrada del índice.
  const paginaDeItem = (i: number) => {
    if (!book || !paginas) return null;
    const cfi = capCfis?.[i];
    if (cfi) return numeroPagina(book, cfi);
    const p = paginas.primeraDeSpine.get(indice[i].spine);
    return p === undefined ? null : p + 1;
  };

  const autor = meta?.author ?? '';
  const tituloCap = capitulo?.label ?? '';
  const g = geometriaVisor(L);
  const varsLibro = {
    '--pw': `${L.pw}px`, '--ph': `${L.ph}px`, '--mo': `${L.mo}px`, '--mi': `${L.mi}px`,
    '--mt': `${L.mt}px`, '--mb': `${L.mb}px`,
  } as CSSProperties;
  const valorBarra = arrastre ?? (pagIni ? pagIni - 1 : 0);

  return (
    <div className={`lector ${inmersivo ? 'inmersivo' : ''}`} data-tema={prefs.tema} onMouseMove={despertar}>
      <header className="barra barra-sup">
        <button className="btn-l" onClick={onClose} aria-label="Volver a la biblioteca">
          <Volver />
        </button>
        <div className="titulo">
          <b>{meta?.title ?? ''}</b>
          <span>{tituloCap}</span>
        </div>
        <div className="grupo-btn">
          <button className="btn-l" onClick={() => setPanel(panel === 'indice' ? null : 'indice')} aria-label="Índice">
            <Lista />
          </button>
          <button className="btn-l" onClick={alternarMarcador} aria-label="Marcar página" aria-pressed={marcada} disabled={!pos}>
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
        onPointerDown={(e) => e.pointerType !== 'mouse' && inicioToque(e.clientX, e.clientY)}
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
                <Pagina lado="izq" cabecera={inicioCapitulo ? '' : autor} folio={pagIni} />
                <Pagina lado="der" cabecera={derechaVacia ? '' : tituloCap} folio={derechaVacia ? null : pagDer} />
              </>
            ) : (
              <Pagina lado="unica" cabecera={inicioCapitulo ? '' : tituloCap} folio={pagIni} />
            )}

            <div
              className={`visor ${mostrando ? 'visible' : ''}`}
              ref={visorRef}
              style={{ left: g.left, top: g.top, width: g.width, height: g.height }}
            />
            {!mostrando && <p className="cargando">Abriendo libro…</p>}
            <div className={`cinta ${marcada ? 'activa' : ''}`} style={{ right: L.doble ? '12%' : '10%' }} />
          </div>
        )}
      </main>

      <footer className="barra barra-inf">
        <span className="info-b">{arrastre !== null ? `Ir a la página ${arrastre + 1}` : infoPaginasTexto}</span>
        <input
          className="rango"
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          value={valorBarra}
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
        <span className="info-b">{tiempoTexto}</span>
      </footer>

      <PanelAjustes abierto={panel === 'ajustes'} prefs={prefs} onCambiar={(c) => setPrefs({ ...prefs, ...c })} />

      <aside className={`cajon ${panel === 'indice' ? 'abierto' : ''}`} aria-label="Índice" aria-hidden={panel !== 'indice'}>
        <div className="cajon-cab">
          <div>
            <p className="cajon-sup">{meta?.title}</p>
            <h2>Índice</h2>
          </div>
          <button className="btn-l" onClick={() => setPanel(null)} aria-label="Cerrar índice">
            <Cerrar />
          </button>
        </div>
        {indice.length === 0 ? (
          <p className="vacio">Este libro no trae índice.</p>
        ) : (
          <ol className="lista">
            {indice.map((item, i) => {
              const pag = paginaDeItem(i);
              return (
                <li key={`${item.href}-${i}`}>
                  <button
                    className={`item ${item === capitulo ? 'actual' : ''}`}
                    style={{ paddingLeft: item.nivel * 16 }}
                    onClick={() => irA(item.href)}
                  >
                    <span className="tit">{item.label}</span>
                    <span className="lider" />
                    <span className="pag">{pag ?? ''}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        <h3>Marcadores</h3>
        {marcadores.length === 0 ? (
          <p className="vacio">Tocá la cinta de arriba para marcar una página.</p>
        ) : (
          <ul className="lista">
            {marcadores.map((m) => (
              <li key={m.cfi}>
                <button className="item" onClick={() => irA(m.cfi)}>
                  <span className="tit">{m.etiqueta || 'Marcador'}</span>
                  <span className="lider" />
                  <span className="pag">{m.pagina ?? ''}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <div className={`velo ${panel === 'indice' ? 'visible' : ''}`} onClick={() => setPanel(null)} />
    </div>
  );
}

function Pagina({ lado, cabecera, folio }: { lado: 'izq' | 'der' | 'unica'; cabecera: string; folio: number | null }) {
  return (
    <div className={`pagina ${lado}`}>
      <div className="cabecera">{cabecera}</div>
      <div className="folio">{folio ?? ''}</div>
    </div>
  );
}

function PanelAjustes({ abierto, prefs, onCambiar }: { abierto: boolean; prefs: Preferencias; onCambiar: (c: Partial<Preferencias>) => void }) {
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
          Doble página
          <input
            type="checkbox"
            checked={prefs.doble && dobleDisponible}
            disabled={!dobleDisponible}
            onChange={(e) => onCambiar({ doble: e.target.checked })}
          />
        </label>
      </div>
    </aside>
  );
}
