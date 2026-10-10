// Pantalla de lectura (maqueta "lector.html").
// epub.js se encarga de paginar el texto del libro; nosotros dibujamos el "libro" alrededor:
// hojas, lomo, cantos, cabeceras, números de página, barras, índice y ajustes.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { EpubCFI, type Book, type Rendition } from 'epubjs';
import { abrirEpub, calcularPaginas, ubicarCapitulos } from '../epub';
import { getBook, getBookFile, updateBook, type BookMeta, type ColorSubrayado, type Marcador, type Subrayado } from '../db';
import { COLORES_SUBRAYADO, descargarSubrayados } from '../subrayados';
import { EditorNota, ListaSubrayados, MenuSubrayado, NotasMargen, type NotaVisible, type PosicionMenu } from './Subrayados';
import {
  cargarPreferencias, guardarPreferencias, FUENTES, TAMANOS, TEMAS,
  type Fuente, type Preferencias, type Tema,
} from '../preferencias';
import { Cerrar, Cinta, Lista, Lupa, Volver } from './Iconos';
import { animarFundido, animarHoja, medidas, mismasMedidas, Pagina, PanelAjustes, type Medidas } from './MarcoLibro';
import PanelBusqueda, { type EstadoBusqueda, type ResultadoMostrado } from './Busqueda';
import { buscarEnLibro, normalizar, type Resultado } from '../busqueda';
import './Reader.css';
import { contarEvento } from '../estadisticas';

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
  const [panel, setPanel] = useState<'ajustes' | 'indice' | 'buscar' | null>(null);
  const [consulta, setConsulta] = useState('');
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [estadoBusqueda, setEstadoBusqueda] = useState<EstadoBusqueda>('vacia');
  const [pestana, setPestana] = useState<'indice' | 'marcadores' | 'subrayados'>('indice');
  const [subrayados, setSubrayados] = useState<Subrayado[]>([]);
  // Menú flotante: sobre texto recién seleccionado (nuevo) o sobre un subrayado existente (id).
  const [menu, setMenu] = useState<{ posicion: PosicionMenu; nuevo?: { cfi: string; texto: string }; id?: string } | null>(null);
  const [notaAbierta, setNotaAbierta] = useState<string | null>(null); // id del subrayado cuya nota se edita
  const [notasVisibles, setNotasVisibles] = useState<NotaVisible[]>([]); // notas en la página actual
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
  const subrayadosRef = useRef<Subrayado[]>([]); // copia para epub.js, que no ve el estado de React
  const clicEnSubrayado = useRef(0); // momento del último toque sobre un subrayado
  const busquedaActual = useRef(0); // cada búsqueda nueva cancela la anterior
  const resaltadoBusqueda = useRef<{ cfi: string; reloj: number } | null>(null);

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
      setSubrayados(m.highlights);
      subrayadosRef.current = m.highlights;
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
  const eventos = useRef({
    alReubicar: (_: unknown) => {},
    alTeclear: (_: KeyboardEvent) => {},
    alClic: (_: MouseEvent) => {},
    despertar: () => {},
    alTocar: (_: TouchEvent) => {},
    alSoltar: (_: TouchEvent) => {},
    alSeleccionar: (_cfi: string, _contents: { window: Window }) => {},
    alTocarSubrayado: (_id: string, _e: Event) => {},
  });

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
    rendition.on('selected', (cfi: string, contents: { window: Window }) => eventos.current.alSeleccionar(cfi, contents));

    // Los subrayados guardados se dibujan solos cuando aparece su capítulo.
    for (const s of subrayadosRef.current) dibujarSubrayado(rendition, s);

    const objetivo = cfiActual.current;
    rendition
      .display(objetivo ?? undefined)
      .catch(() => rendition.display()) // si la posición guardada ya no sirve, desde el principio
      .then(async () => {
        // Las tipografías pueden terminar de descargarse después de mostrar el texto; al cambiar
        // la letra el texto se corre y quedaríamos en otra página. Esperamos a que estén y volvemos
        // a la posición guardada (recién ahí se muestra el libro, así no se ve el salto).
        const contenidos = rendition.getContents() as unknown as { document?: Document }[];
        await Promise.all(contenidos.map((c) => c.document?.fonts?.ready));
        if (objetivo && renditionRef.current === rendition) await rendition.display(objetivo).catch(() => {});
        if (renditionRef.current !== rendition) return;
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
    // En el tema noche los subrayados se pintan distinto (sobre fondo oscuro).
    const r = renditionRef.current;
    if (r) for (const s of subrayadosRef.current) {
      quitarSubrayado(r, s);
      dibujarSubrayado(r, s);
    }
  }, [prefs.tema]);

  useEffect(() => guardarPreferencias(prefs), [prefs]);

  /* ---------- navegación ---------- */
  function ir(dir: 1 | -1) {
    const r = renditionRef.current;
    if (!r) return;
    // Al principio o al final del libro no hay a dónde ir: un pequeño "rebote" lo indica.
    const lugar = r.location as unknown as { atStart?: boolean; atEnd?: boolean } | undefined;
    if ((dir > 0 && lugar?.atEnd) || (dir < 0 && lugar?.atStart)) {
      libroRef.current?.animate(
        [{ transform: 'none' }, { transform: `translateX(${-dir * 8}px)` }, { transform: 'none' }],
        { duration: 260 },
      );
      return;
    }
    animarHoja(libroRef.current, visorRef.current, L, dir, prefs.animacion);
    (dir > 0 ? r.next() : r.prev()).then(() => animarFundido(visorRef.current, dir, prefs.animacion));
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
    // Escape siempre cierra; las demás teclas se ignoran solo mientras se escribe o se mueve la barra.
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
    // La barra espaciadora sobre un botón o interruptor lo activa; no pasa de página.
    if (e.key === ' ' && destino?.matches?.('button, input')) return;
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) {
      e.preventDefault();
      ir(1);
    } else if (['ArrowLeft', 'PageUp'].includes(e.key)) {
      e.preventDefault();
      ir(-1);
    }
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
      const x = (marco?.left ?? 0) + e.clientX;
      // Esperamos un instante: si el toque fue sobre un subrayado, se abre su menú en vez de pasar de página.
      setTimeout(() => {
        if (Date.now() - clicEnSubrayado.current > 800) tocarEn(x);
      }, 0);
    },
    despertar,
    alTocar: (e: TouchEvent) => inicioToque(e.changedTouches[0].clientX, e.changedTouches[0].clientY),
    alSoltar: (e: TouchEvent) => finToque(e.changedTouches[0].clientX, e.changedTouches[0].clientY),
    alSeleccionar,
    alTocarSubrayado,
  };

  /* ---------- subrayados ---------- */
  function dibujarSubrayado(r: Rendition, s: Subrayado) {
    const noche = temaActual.current === 'noche';
    r.annotations.highlight(
      s.cfi,
      { id: s.id },
      (e: Event) => eventos.current.alTocarSubrayado(s.id, e),
      'lecb-subrayado',
      {
        fill: COLORES_SUBRAYADO[s.color].color,
        'fill-opacity': noche ? '0.28' : '0.42',
        'mix-blend-mode': noche ? 'normal' : 'multiply',
      },
    );
  }

  function quitarSubrayado(r: Rendition, s: Subrayado) {
    r.annotations.remove(s.cfi, 'highlight');
  }

  function guardarSubrayados(nuevos: Subrayado[]) {
    subrayadosRef.current = nuevos;
    setSubrayados(nuevos);
    updateBook(bookId, { highlights: nuevos });
  }

  function limpiarSeleccion() {
    const contenidos = (renditionRef.current?.getContents() ?? []) as unknown as { window: Window }[];
    for (const c of contenidos) c.window?.getSelection()?.removeAllRanges();
  }

  function cerrarMenu() {
    setMenu(null);
    limpiarSeleccion();
  }

  // Seleccionaron texto en el libro: mostramos el menú encima.
  function alSeleccionar(cfi: string, contents: { window: Window }) {
    const seleccion = contents.window.getSelection();
    const texto = seleccion?.toString().replace(/\s+/g, ' ').trim() ?? '';
    if (!seleccion || !texto || seleccion.rangeCount === 0) return;
    const rect = seleccion.getRangeAt(0).getBoundingClientRect();
    const marco = (contents.window.frameElement as HTMLElement | null)?.getBoundingClientRect();
    const dx = marco?.left ?? 0, dy = marco?.top ?? 0;
    setMenu({
      posicion: { x: dx + rect.left + rect.width / 2, arriba: dy + rect.top, abajo: dy + rect.bottom },
      nuevo: { cfi, texto },
    });
  }

  // Tocaron un subrayado existente: menú para cambiar color, nota o borrarlo.
  function alTocarSubrayado(id: string, e: Event) {
    clicEnSubrayado.current = Date.now();
    const rect = (e.currentTarget as Element | null)?.getBoundingClientRect();
    if (!rect) return;
    setMenu({ posicion: { x: rect.left + rect.width / 2, arriba: rect.top, abajo: rect.bottom }, id });
  }

  function crearSubrayado(color: ColorSubrayado, conNota = false) {
    const r = renditionRef.current;
    if (!r || !menu?.nuevo) return;
    const nuevo: Subrayado = {
      id: crypto.randomUUID(),
      cfi: menu.nuevo.cfi,
      texto: menu.nuevo.texto,
      color,
      nota: null,
      etiqueta: capitulo?.label ?? '',
      pagina: bookRef.current && paginas ? numeroPagina(bookRef.current, menu.nuevo.cfi) : null,
      creado: Date.now(),
    };
    guardarSubrayados([...subrayados, nuevo].sort((a, b) => compararCfi(a.cfi, b.cfi)));
    contarEvento('subrayado');
    dibujarSubrayado(r, nuevo);
    cerrarMenu();
    if (conNota) setNotaAbierta(nuevo.id);
  }

  function cambiarColor(id: string, color: ColorSubrayado) {
    const r = renditionRef.current;
    const viejo = subrayados.find((s) => s.id === id);
    if (!r || !viejo) return;
    const nuevo = { ...viejo, color };
    quitarSubrayado(r, viejo);
    dibujarSubrayado(r, nuevo);
    guardarSubrayados(subrayados.map((s) => (s.id === id ? nuevo : s)));
    setMenu(null);
  }

  function borrarSubrayado(id: string) {
    const s = subrayados.find((x) => x.id === id);
    if (!s) return;
    if (s.nota && !confirm('Este subrayado tiene una nota. ¿Borrar los dos?')) return;
    if (renditionRef.current) quitarSubrayado(renditionRef.current, s);
    guardarSubrayados(subrayados.filter((x) => x.id !== id));
    setMenu(null);
  }

  function guardarNota(id: string, nota: string) {
    if (nota.trim() && !subrayados.find((s) => s.id === id)?.nota) contarEvento('nota');
    guardarSubrayados(subrayados.map((s) => (s.id === id ? { ...s, nota: nota.trim() || null } : s)));
    setNotaAbierta(null);
  }

  function copiarSeleccion() {
    if (menu?.nuevo) navigator.clipboard?.writeText(menu.nuevo.texto).catch(() => {});
    cerrarMenu();
  }

  // Dónde quedó cada subrayado con nota en la página actual (para los indicadores y tarjetas del margen).
  function medirNotas() {
    const libro = libroRef.current;
    if (!libro) return;
    const rl = libro.getBoundingClientRect();
    const conNota = new Set(subrayadosRef.current.filter((s) => s.nota).map((s) => s.id));
    const vistas = new Map<string, NotaVisible>();
    libro.querySelectorAll<SVGGElement>('g.lecb-subrayado[data-id]').forEach((g) => {
      const id = g.dataset.id;
      const r = g.querySelector('rect')?.getBoundingClientRect();
      if (!id || !conNota.has(id) || vistas.has(id) || !r || !r.width) return;
      // epub.js dibuja también los subrayados de las otras páginas del capítulo, fuera de la vista.
      if (r.right < rl.left || r.left > rl.right) return;
      const lado = L.doble && r.left + r.width / 2 < rl.left + rl.width / 2 ? 'izq' : 'der';
      vistas.set(id, { id, y: r.top - rl.top, lado });
    });
    setNotasVisibles([...vistas.values()].sort((a, b) => a.y - b.y));
  }

  // Se vuelve a medir al cambiar de página, de subrayados o de medidas (dos veces: al instante
  // y cuando terminó la animación de pasar página).
  useEffect(() => {
    if (!mostrando) return;
    const a = window.setTimeout(medirNotas, 60);
    const b = window.setTimeout(medirNotas, 400);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mostrando, pos, subrayados, L, prefs.tema]);

  /* ---------- búsqueda ---------- */
  useEffect(() => {
    const book = bookRef.current;
    const id = ++busquedaActual.current;
    if (!listo || !book || normalizar(consulta).length < 2) {
      setResultados([]);
      setEstadoBusqueda('vacia');
      return;
    }
    const reloj = window.setTimeout(() => {
      setResultados([]);
      setEstadoBusqueda('buscando');
      buscarEnLibro(
        book,
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
  }, [consulta, listo]);

  function irAResultado(r: Resultado) {
    const rendition = renditionRef.current;
    if (!rendition) return;
    setPanel(null);
    rendition.display(r.cfi).then(() => {
      // Resaltamos la coincidencia unos segundos para encontrarla en la página.
      const previo = resaltadoBusqueda.current;
      if (previo) {
        clearTimeout(previo.reloj);
        rendition.annotations.remove(previo.cfi, 'highlight');
      }
      const noche = temaActual.current === 'noche';
      rendition.annotations.highlight(r.cfi, {}, () => {}, 'lecb-busqueda', {
        fill: TEMAS[temaActual.current].acento,
        'fill-opacity': noche ? '0.4' : '0.3',
        'mix-blend-mode': noche ? 'normal' : 'multiply',
      });
      const reloj = window.setTimeout(() => {
        renditionRef.current?.annotations.remove(r.cfi, 'highlight');
        resaltadoBusqueda.current = null;
      }, 4000);
      resaltadoBusqueda.current = { cfi: r.cfi, reloj };
    });
  }

  const subrayadoDelMenu = menu?.id ? subrayados.find((s) => s.id === menu.id) ?? null : null;
  const subrayadoConNota = notaAbierta ? subrayados.find((s) => s.id === notaAbierta) ?? null : null;

  /* ---------- marcadores ---------- */
  const marcadoresAqui = pos
    ? marcadores.filter((m) => compararCfi(m.cfi, pos.inicio) >= 0 && compararCfi(m.cfi, pos.fin) <= 0)
    : [];
  const marcada = marcadoresAqui.length > 0;

  function alternarMarcador() {
    if (!marcada) contarEvento('marcador');
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

  const resultadosMostrados = useMemo<ResultadoMostrado[]>(() => {
    const book = bookRef.current;
    return resultados.map((r) => {
      // Búsqueda binaria del último capítulo que empieza antes del resultado.
      let ini = 0, fin = capitulosUbicados.length - 1, capitulo = '';
      while (ini <= fin) {
        const medio = (ini + fin) >> 1;
        if (compararCfi(capitulosUbicados[medio].cfi, r.cfi) <= 0) {
          capitulo = capitulosUbicados[medio].item.label;
          ini = medio + 1;
        } else fin = medio - 1;
      }
      if (!capitulo) capitulo = indice.find((t) => t.spine === r.spine)?.label ?? '';
      return { ...r, capitulo, pagina: book && paginas ? numeroPagina(book, r.cfi) : null };
    });
  }, [resultados, capitulosUbicados, paginas, indice]);

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
  const anchoLibro = L.doble ? 2 * L.pw : L.pw;
  // Tarjetas de notas al costado: solo si el lector las quiere y hay lugar fuera del libro.
  const espacioCostado = (window.innerWidth - anchoLibro) / 2 - 28 - 16;
  const anchoTarjeta = prefs.notasMargen && espacioCostado >= 170 ? Math.min(240, espacioCostado) : 0;
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
          <button className="btn-l" onClick={() => setPanel(panel === 'buscar' ? null : 'buscar')} aria-label="Buscar en el libro">
            <Lupa />
          </button>
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
            <NotasMargen
              notas={notasVisibles}
              subrayados={subrayados}
              anchoLibro={anchoLibro}
              altoLibro={L.ph}
              margenIzq={L.mo / 2}
              margenDer={anchoLibro - L.mo / 2}
              anchoTarjeta={anchoTarjeta}
              onAbrir={setNotaAbierta}
              onVerTodas={() => {
                setPestana('subrayados');
                setPanel('indice');
              }}
            />
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

      <aside className={`cajon ${(panel === 'indice' || panel === 'buscar') ? 'abierto' : ''}`} aria-label="Índice" aria-hidden={!(panel === 'indice' || panel === 'buscar')}>
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
                ))}
            {pestana === 'marcadores' &&
                (marcadores.length === 0 ? (
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
                ))}
            {pestana === 'subrayados' && (
              <ListaSubrayados
                subrayados={subrayados}
                onIr={(sub) => irA(sub.cfi)}
                onNota={(sub) => setNotaAbierta(sub.id)}
                onBorrar={(sub) => borrarSubrayado(sub.id)}
                onExportar={() => meta && descargarSubrayados(meta, subrayados)}
              />
            )}
          </>
        )}
      </aside>
      <div className={`velo ${(panel === 'indice' || panel === 'buscar') ? 'visible' : ''}`} onClick={() => setPanel(null)} />

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
          onCopiar={menu.nuevo ? copiarSeleccion : undefined}
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
    </div>
  );
}
