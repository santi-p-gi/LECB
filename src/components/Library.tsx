// Pantalla de inicio y biblioteca (maqueta "inicio.html").
import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { updateBook, type BookMeta } from '../db';
import { colorTexto, hashTexto } from '../colores';
import { guardarTemaSitio } from '../preferencias';
import { enMB, TAMANO_MAXIMO } from '../almacenamiento';
import Portada from './Portada';
import CopiaSeguridad from './CopiaSeguridad';
import Fuentes from './Fuentes';
import Contacto from './Contacto';
import { ControlAvisos, InvitacionAvisos } from './Avisos';
import { cargarFiltro, contarColecciones, FiltrosColecciones, guardarFiltro, VentanaColecciones } from './Colecciones';
import { Cinta, CompartirIOS, Instalar, LibroAbierto, Logo, Luna, Subir, Tipografia } from './Iconos';
import { esAndroid, useInstalacion } from '../instalacion';
import './Library.css';

// "Props": los datos y funciones que App le pasa a este componente.
interface LibraryProps {
  books: BookMeta[] | null;
  importing: boolean;
  onImport: (files: File[]) => void;
  onDemo: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onBibliotecaCambiada: () => void; // después de restaurar una copia
}

type Orden = 'recientes' | 'titulo' | 'autor';
const ORDENES: Record<Orden, string> = { recientes: 'Recientes', titulo: 'Título', autor: 'Autor' };

const esLibro = (file: File) => /.(epub|pdf)$/i.test(file.name);

export default function Library({ books, importing, onImport, onDemo, onOpen, onDelete, onBibliotecaCambiada }: LibraryProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [orden, setOrden] = useState<Orden>('recientes');
  const [editando, setEditando] = useState(false);
  const [filtro, setFiltro] = useState<string | null>(cargarFiltro);
  const [libroColecciones, setLibroColecciones] = useState<BookMeta | null>(null);
  const [ayudaIOS, setAyudaIOS] = useState(false);
  const [copiaAbierta, setCopiaAbierta] = useState(false);
  const instalacion = useInstalacion();

  const elegirArchivo = () => fileInputRef.current?.click();

  // Al llegar desde un aviso ("buscá un libro nuevo"), la página baja sola a la sección.
  const cargada = books !== null;
  useEffect(() => {
    if (cargada && location.hash === '#conseguir') document.getElementById('conseguir')?.scrollIntoView();
  }, [cargada]);

  function importarArchivos(fileList: FileList | null) {
    const todos = Array.from(fileList ?? []);
    const libros = todos.filter(esLibro);
    const kindle = todos.filter((f) => /\.(mobi|azw\d?|kfx|prc)$/i.test(f.name));
    if (kindle.length) {
      alert(
        'Los archivos de Kindle (.mobi, .azw) no son compatibles con LECB.\n\n' +
          'Si el libro no tiene DRM, podés convertirlo a EPUB con Calibre, un programa gratuito.',
      );
    }
    if (libros.length) onImport(libros);
    else if (todos.length && !kindle.length) alert('Solo se pueden importar archivos .epub o .pdf');
  }

  // Arrastrar archivos funciona en toda la página, no solo en la zona de subir.
  function alSoltar(e: DragEvent) {
    e.preventDefault();
    setArrastrando(false);
    importarArchivos(e.dataTransfer.files);
  }

  function cambiarTema() {
    const r = document.documentElement;
    const oscuroAhora = r.dataset.theme
      ? r.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    const nuevo = oscuroAhora ? 'light' : 'dark';
    r.dataset.theme = nuevo;
    guardarTemaSitio(nuevo);
  }

  const vacia = books !== null && books.length === 0;
  const leyendo = (books ?? []).filter((b) => b.lastOpenedAt !== null).slice(0, 3);
  const colecciones = contarColecciones(books ?? []);
  // Si la colección elegida ya no existe (se vaciaron sus libros), se muestran todos.
  const filtroActivo = filtro && colecciones.some(([c]) => c === filtro) ? filtro : null;
  const estante = [...(books ?? [])].filter((b) => !filtroActivo || b.colecciones.includes(filtroActivo)).sort((a, b) =>
    orden === 'titulo' ? a.title.localeCompare(b.title)
    : orden === 'autor' ? a.author.localeCompare(b.author)
    : 0, // "recientes": ya vienen ordenados así
  );

  return (
    <div
      className="inicio"
      onDragOver={(e) => {
        e.preventDefault();
        setArrastrando(true);
      }}
      onDragLeave={(e) => {
        if (e.relatedTarget === null) setArrastrando(false); // salió de la ventana
      }}
      onDrop={alSoltar}
    >
      {/* Input de archivo oculto: los botones "Subir" lo abren */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".epub,.pdf,application/epub+zip,application/pdf"
        multiple
        hidden
        onChange={(e) => {
          importarArchivos(e.target.files);
          e.target.value = ''; // permite volver a elegir el mismo archivo
        }}
      />

      {/* ================= NAV ================= */}
      <header className="nav">
        <div className="contenedor nav-in">
          <a className="logo" href="#">
            <Logo />
            LECB
          </a>
          <nav className="nav-links">
            {!vacia && <a href="#biblioteca">Biblioteca</a>}
            {!vacia && <a href="#estanteria">Estantería</a>}
            <a href="#conseguir">Conseguir libros</a>
            <a href="#como">Cómo funciona</a>
          </nav>
          <div className="nav-acc">
            {(instalacion.puedeInstalar || instalacion.necesitaAyudaIOS) && (
              <button
                className="btn btn-secundario btn-chico boton-instalar"
                onClick={() => (instalacion.puedeInstalar ? instalacion.instalar() : setAyudaIOS(true))}
                aria-label="Instalar LECB como app"
              >
                <Instalar />
                <span>Instalar app</span>
              </button>
            )}
            <button className="btn-icono" onClick={cambiarTema} aria-label="Cambiar tema claro u oscuro">
              <Luna />
            </button>
            <button className="btn btn-primario btn-chico" onClick={elegirArchivo} disabled={importing}>
              {importing ? 'Importando…' : 'Subir libro'}
            </button>
          </div>
        </div>
      </header>

      <main>
        {/* ================= HERO (solo con la biblioteca vacía) ================= */}
        {vacia && <Hero onSubir={elegirArchivo} onDemo={onDemo} onRestaurar={() => setCopiaAbierta(true)} importing={importing} />}

        {/* ================= SEGUIR LEYENDO ================= */}
        {leyendo.length > 0 && (
          <section className="seccion" id="biblioteca">
            <div className="contenedor">
              <div className="seccion-cab">
                <h2 className="titulo-seccion">Seguir leyendo</h2>
                <a href="#estanteria">Ver toda la biblioteca</a>
              </div>
              <div className={`grid-seguir grid-seguir-${leyendo.length}`}>
                {leyendo.map((book, i) => (
                  <TarjetaLectura key={book.id} book={book} destacada={i === 0} onOpen={() => onOpen(book.id)} />
                ))}
              </div>
              <InvitacionAvisos />
            </div>
          </section>
        )}

        {/* ================= ESTANTERÍA ================= */}
        {(books?.length ?? 0) > 0 && (
          <section className="seccion" id="estanteria">
            <div className="contenedor">
              <div className="seccion-cab">
                <h2 className="titulo-seccion">Tu estantería</h2>
                <div className="seccion-acc">
                  <button
                    className="enlace"
                    onClick={() => setOrden(orden === 'recientes' ? 'titulo' : orden === 'titulo' ? 'autor' : 'recientes')}
                  >
                    Orden: {ORDENES[orden]}
                  </button>
                  <button className="enlace" onClick={() => setCopiaAbierta(true)}>
                    Copia de seguridad
                  </button>
                  <button className="enlace" onClick={() => setEditando(!editando)}>
                    {editando ? 'Listo' : 'Editar'}
                  </button>
                </div>
              </div>
              <FiltrosColecciones
                colecciones={colecciones}
                total={books?.length ?? 0}
                elegida={filtroActivo}
                onElegir={(c) => {
                  setFiltro(c);
                  guardarFiltro(c);
                }}
              />
              {editando && (
                <p className="aviso-edicion">
                  Tocá un libro para elegir sus colecciones (por ejemplo «Facultad» o «Novelas»), o la × para quitarlo.
                </p>
              )}
              <div className="estante-wrap">
                <div className="estante">
                  {estante.map((book) => (
                    <Lomo
                      key={book.id}
                      book={book}
                      editando={editando}
                      onOpen={() => (editando ? setLibroColecciones(book) : onOpen(book.id))}
                      onDelete={() => {
                        if (confirm(`¿Quitar "${book.title}" de tu estantería?`)) onDelete(book.id);
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ================= SUBIR ================= */}
        <section className="seccion" id="subir">
          <div className="contenedor">
            <div
              className={`subir ${arrastrando ? 'activo' : ''}`}
              onClick={elegirArchivo}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && elegirArchivo()}
            >
              <span className="subir-icono"><Subir /></span>
              <h2>{importing ? 'Importando…' : 'Arrastrá tu archivo .epub o .pdf acá'}</h2>
              <p>Lo agregamos a tu estantería y lo abrimos donde lo dejaste.</p>
              <span className="btn btn-primario">Elegir archivo</span>
              <small>EPUB y PDF · hasta {enMB(TAMANO_MAXIMO)} · tus libros quedan solo en este navegador</small>
              <small className="nota-drm">Los libros comprados con protección anticopia (DRM) no se pueden abrir.</small>
              {esAndroid() && (
                <small className="nota-drm">
                  Con LECB instalada, también podés tocar <b>Compartir → LECB</b> en un libro de WhatsApp, el mail o
                  tus descargas.
                </small>
              )}
            </div>
          </div>
        </section>

        {/* ================= DÓNDE CONSEGUIR LIBROS ================= */}
        <Fuentes />

        {/* ================= CÓMO FUNCIONA ================= */}
        <section className="seccion" id="como">
          <div className="contenedor">
            <div className="seccion-cab">
              <h2 className="titulo-seccion">Pensado para leer, no para mirar pantallas</h2>
            </div>
            <div className="caracts">
              <div className="caract">
                <div className="caract-ico"><LibroAbierto /></div>
                <h3>Formato libro de verdad</h3>
                <p>Doble página, lomo, cabeceras y números de página. Como abrir un libro.</p>
              </div>
              <div className="caract">
                <div className="caract-ico"><Tipografia /></div>
                <h3>Tu tipografía, tu luz</h3>
                <p>Temas papel, sepia y noche. Tres familias tipográficas, tamaño e interlineado a tu medida.</p>
              </div>
              <div className="caract">
                <div className="caract-ico"><Cinta /></div>
                <h3>Marcadores con cinta</h3>
                <p>Marcá páginas, volvé al índice cuando quieras y retomá siempre donde lo dejaste.</p>
              </div>
            </div>
            <p className="ornamento">❦</p>
          </div>
        </section>
      </main>

      {ayudaIOS && (
        <div className="dialogo-fondo" onClick={() => setAyudaIOS(false)}>
          <div className="dialogo ayuda-ios" role="dialog" aria-label="Instalar en iPhone" onClick={(e) => e.stopPropagation()}>
            <h2>Instalar LECB en tu iPhone</h2>
            <ol>
              <li>
                Tocá el botón <b>Compartir</b> <span className="icono-linea"><CompartirIOS /></span> de Safari (abajo en el centro).
              </li>
              <li>Elegí <b>«Agregar a inicio»</b>.</li>
              <li>Tocá <b>«Agregar»</b>. LECB aparece en tu pantalla como cualquier app.</li>
            </ol>
            <p>Instalada, funciona sin internet y tu biblioteca queda protegida.</p>
            <button className="btn btn-primario" onClick={() => setAyudaIOS(false)}>Entendido</button>
          </div>
        </div>
      )}

      {libroColecciones && (
        <VentanaColecciones
          libro={libroColecciones}
          colecciones={colecciones.map(([c]) => c)}
          onCerrar={() => setLibroColecciones(null)}
          onGuardar={async (elegidas) => {
            await updateBook(libroColecciones.id, { colecciones: elegidas });
            setLibroColecciones(null);
            onBibliotecaCambiada();
          }}
        />
      )}

      {copiaAbierta && (
        <CopiaSeguridad
          cantidadLibros={books?.length ?? 0}
          pesoLibros={(books ?? []).reduce((total, b) => total + b.size, 0)}
          onCerrar={() => setCopiaAbierta(false)}
          onRestaurada={onBibliotecaCambiada}
        />
      )}

      <footer className="pie">
        <div className="contenedor">
          <Contacto />
          <span>LECB — tus libros y notas nunca salen de tu dispositivo</span>
          <span>Contamos visitas de forma anónima y sin cookies (GoatCounter)</span>
          <ControlAvisos />
          <span>
            Si activás los avisos de lectura, guardamos una dirección anónima de notificación y tu zona aproximada (unos
            10 km), solo para saber el clima. Nunca tus libros ni datos personales.
          </span>
        </div>
      </footer>
    </div>
  );
}

function Hero({ onSubir, onDemo, onRestaurar, importing }: { onSubir: () => void; onDemo: () => void; onRestaurar: () => void; importing: boolean }) {
  return (
    <section className="hero">
      <div className="contenedor hero-in">
        <div>
          <p className="eyebrow">Lector de EPUB y PDF</p>
          <h1>
            Leer como en papel, <em>en cualquier pantalla.</em>
          </h1>
          <p className="hero-sub">
            Subí tus libros y leelos a doble página, con márgenes de verdad, tu tipografía favorita y la luz que te
            quede cómoda.
          </p>
          <div className="hero-cta">
            <button className="btn btn-primario" onClick={onSubir} disabled={importing}>
              Subir mi primer libro
            </button>
            <button className="btn btn-secundario" onClick={onDemo} disabled={importing}>
              Probar con Don Quijote →
            </button>
          </div>
          <p className="hero-nota">Compatible con EPUB y PDF · En la compu y en el celu</p>
          <p className="hero-nota">
            <a className="enlace" href="#conseguir">¿Qué es un EPUB y dónde lo consigo?</a>
          </p>
          <p className="hero-nota">
            ¿Venís de otro dispositivo?{' '}
            <button className="enlace" onClick={onRestaurar}>Restaurá tu copia de seguridad</button>
          </p>
        </div>

        {/* Ilustración decorativa: libro abierto y dos tapas */}
        <div className="hero-arte" aria-hidden="true">
          <div className="portada t1" style={{ '--c': '#1f2a44', '--t': '#e9dfcd' } as CSSProperties}>
            <span className="pt-autor">Leopoldo Alas «Clarín»</span>
            <span className="pt-titulo">La <em>Regenta</em></span>
            <span className="pt-inicial">R</span>
          </div>
          <div className="mini-libro">
            <div className="mini-pag">
              <div className="mini-cab">Miguel de Cervantes</div>
              <div className="mini-renglones">
                {Array.from({ length: 14 }, (_, i) => <i key={i} className={i === 9 ? 'corto' : ''} />)}
              </div>
              <span className="mini-folio">12</span>
            </div>
            <div className="mini-pag">
              <div className="mini-num">Capítulo II</div>
              <div className="mini-tit">La primera salida</div>
              <div className="mini-renglones">
                <div className="capital"><b>H</b><span><i /><i /><i /></span></div>
                {Array.from({ length: 8 }, (_, i) => <i key={i} className={i === 5 ? 'corto' : ''} />)}
              </div>
              <span className="mini-folio">13</span>
              <span className="mini-cinta" />
            </div>
          </div>
          <div className="portada t2" style={{ '--c': '#2f4a3a', '--t': '#e2cf8d' } as CSSProperties}>
            <span className="pt-autor">Benito Pérez Galdós</span>
            <span className="pt-titulo">Mariane&shy;la</span>
            <span className="pt-reglas" />
          </div>
        </div>
      </div>
    </section>
  );
}

function TarjetaLectura({ book, destacada, onOpen }: { book: BookMeta; destacada: boolean; onOpen: () => void }) {
  const porcentaje = Math.round(book.progress * 100);
  const pagina = book.page && book.pages ? `Pág. ${book.page} de ${book.pages}` : 'Empezado';
  const formato = book.formato === 'pdf' ? 'PDF · ' : '';
  return (
    <button className={`tarjeta ${destacada ? 'destacada' : ''}`} onClick={onOpen}>
      <Portada book={book} />
      <div className="tarjeta-info">
        <h3>{book.title}</h3>
        <p className="autor">{book.author}</p>
        {destacada && book.excerpt && (
          <p className="cita">
            <small>Te quedaste en</small>«…{book.excerpt}…»
          </p>
        )}
        <div className="progreso">
          <div className="barra-prog">
            <span style={{ width: `${porcentaje}%` }} />
          </div>
          <div className="meta">
            <span>{formato}{pagina}</span>
            <span>{porcentaje} %</span>
          </div>
        </div>
        {destacada && <span className="btn btn-primario">Continuar leyendo</span>}
      </div>
    </button>
  );
}

function Lomo({ book, editando, onOpen, onDelete }: { book: BookMeta; editando: boolean; onOpen: () => void; onDelete: () => void }) {
  // Grosor según el tamaño del archivo y alto variable, para que el estante no se vea uniforme.
  const ancho = book.size ? Math.min(56, Math.max(28, 24 + Math.sqrt(book.size / 1e6) * 14)) : 40;
  const alto = 68 + (hashTexto(book.title) % 26);
  const estilo = { '--c': book.color, '--t': colorTexto(book.color), '--w': `${ancho}px`, '--h': `${alto}%` } as CSSProperties;

  return (
    <div className="lomo-wrap" style={estilo}>
      <button className="lomo" onClick={onOpen} title={`${book.title} — ${book.author}`}>
        <span className="lt">{book.title}</span>
        <span className="la">{apellido(book.author)}</span>
      </button>
      {editando && (
        <button className="lomo-quitar" onClick={onDelete} aria-label={`Quitar ${book.title}`}>
          ×
        </button>
      )}
    </div>
  );
}

// "Miguel de Cervantes Saavedra" → "Cervantes Saavedra"; "Cervantes, Miguel de" → "Cervantes".
function apellido(autor: string) {
  if (autor.includes(',')) return autor.split(',')[0].trim();
  const partes = autor.trim().split(/\s+/);
  const i = partes.findIndex((p, j) => j > 0 && /^(de|del|y)$/i.test(p));
  return i > 0 ? partes.slice(i + 1).join(' ') : partes[partes.length - 1];
}
