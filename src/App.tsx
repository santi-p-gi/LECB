// Componente principal: decide si mostramos la biblioteca o el lector.
import { useEffect, useState } from 'react';
import { addBook, deleteBook, getAllBooks, type BookMeta } from './db';
import { readEpubInfo } from './epub';
import { enMB, esFaltaDeEspacio, espacioLibre, pedirPersistencia, TAMANO_AVISO, TAMANO_MAXIMO } from './almacenamiento';
import Library from './components/Library';
import Reader from './components/Reader';

const LIBRO_DEMO = '/libros/don-quijote.epub';

// Error con un mensaje pensado para mostrarle al usuario.
class ErrorImportacion extends Error {}

// El libro abierto se guarda en la dirección (#/leer/<id>), así el botón "atrás"
// del navegador vuelve a la biblioteca y al recargar seguimos en el mismo libro.
const libroEnDireccion = () => location.hash.match(/^#\/leer\/(.+)$/)?.[1] ?? null;

export default function App() {
  // "Estado": datos que, cuando cambian, hacen que React vuelva a dibujar la pantalla.
  const [books, setBooks] = useState<BookMeta[] | null>(null); // null = todavía cargando
  const [openBookId, setOpenBookId] = useState(libroEnDireccion);
  const [importing, setImporting] = useState(false);

  const refreshBooks = () => getAllBooks().then(setBooks);

  // Se ejecuta una vez al cargar la página: lee la biblioteca y escucha los cambios de dirección.
  useEffect(() => {
    refreshBooks();
    const alCambiar = () => {
      setOpenBookId(libroEnDireccion());
      refreshBooks(); // para ver el progreso actualizado al volver
    };
    window.addEventListener('hashchange', alCambiar);
    return () => window.removeEventListener('hashchange', alCambiar);
  }, []);

  const cerrar = () => {
    if (history.state?.lecbDesdeBiblioteca) history.back();
    else location.hash = '';
  };

  // Guarda un archivo en la biblioteca y devuelve su id.
  // Lanza ErrorImportacion con un mensaje para el usuario si algo sale mal.
  async function importar(archivo: Blob, extra: Partial<BookMeta> = {}) {
    let info;
    try {
      // epub.js necesita el archivo en memoria solo para leer título y portada;
      // después se libera y en la base guardamos el Blob (sin otra copia en memoria).
      info = await readEpubInfo(await archivo.arrayBuffer());
    } catch (err) {
      console.error(err);
      throw new ErrorImportacion('no es un EPUB válido');
    }
    const id = crypto.randomUUID();
    try {
      await addBook(
        {
          id,
          ...info,
          size: archivo.size,
          addedAt: Date.now(),
          lastOpenedAt: null,
          location: null,
          progress: 0,
          page: null,
          pages: null,
          excerpt: null,
          locations: null,
          capitulos: null,
          bookmarks: [],
          highlights: [],
          ...extra,
        },
        archivo,
      );
    } catch (err) {
      console.error(err);
      throw new ErrorImportacion(
        esFaltaDeEspacio(err) ? 'no hay espacio suficiente en este navegador' : 'no se pudo guardar',
      );
    }
    return id;
  }

  async function handleImport(files: File[]) {
    setImporting(true);
    const failed: string[] = [];
    let ultimo: string | null = null;
    let libre = await espacioLibre();
    pedirPersistencia();

    for (const file of files) {
      if (file.size > TAMANO_MAXIMO) {
        failed.push(`${file.name} (pesa ${enMB(file.size)}; el máximo es ${enMB(TAMANO_MAXIMO)})`);
        continue;
      }
      // Dejamos un margen: la base de datos ocupa un poco más que el archivo.
      if (libre !== null && file.size * 1.1 > libre) {
        failed.push(`${file.name} (no hay espacio en este navegador: quedan ${enMB(libre)})`);
        continue;
      }
      if (
        file.size > TAMANO_AVISO &&
        !confirm(
          `"${file.name}" pesa ${enMB(file.size)}.\n\n` +
            'Los libros muy pesados pueden tardar en abrir o fallar en celulares con poca memoria. ¿Importarlo igual?',
        )
      ) {
        continue;
      }
      try {
        ultimo = await importar(file);
        if (libre !== null) libre -= file.size;
      } catch (err) {
        failed.push(`${file.name} (${err instanceof ErrorImportacion ? err.message : 'error inesperado'})`);
      }
    }

    setImporting(false);
    await refreshBooks();
    if (failed.length) {
      alert(`No se pudieron importar estos archivos:\n${failed.join('\n')}`);
    } else if (files.length === 1 && ultimo) {
      abrirMarcado(ultimo);
    }
  }

  // Abre el libro de muestra (dominio público). Si ya está en la biblioteca, lo reutiliza.
  async function handleDemo() {
    const existente = books?.find((b) => b.title === 'Don Quijote' && b.author.includes('Cervantes'));
    if (existente) return abrirMarcado(existente.id);
    setImporting(true);
    try {
      const respuesta = await fetch(LIBRO_DEMO);
      const id = await importar(await respuesta.blob());
      await refreshBooks();
      abrirMarcado(id);
    } catch (err) {
      console.error(err);
      alert('No se pudo cargar el libro de muestra.');
    } finally {
      setImporting(false);
    }
  }

  // Abre el libro recordando que venimos de la biblioteca (para que "volver" use el historial).
  function abrirMarcado(id: string) {
    location.hash = `/leer/${id}`;
    history.replaceState({ lecbDesdeBiblioteca: true }, '');
  }

  async function handleDelete(id: string) {
    await deleteBook(id);
    await refreshBooks();
  }

  if (openBookId) {
    return <Reader key={openBookId} bookId={openBookId} onClose={cerrar} />;
  }

  return (
    <Library
      books={books}
      importing={importing}
      onImport={handleImport}
      onDemo={handleDemo}
      onOpen={abrirMarcado}
      onDelete={handleDelete}
    />
  );
}
