// Copia de seguridad de la biblioteca: un .zip con los libros, sus portadas y un archivo
// con todo lo demás (progreso, marcadores, subrayados y notas).
//
// Dentro del .zip:
//   lecb-biblioteca.json   → datos de cada libro
//   libros/<id>.epub|pdf   → los archivos de los libros
//   portadas/<id>          → las portadas
import JSZip from 'jszip';
import { addBook, getAllBooks, getBookBlob, updateBook, type BookMeta, type Marcador, type Subrayado } from './db';
import { espacioLibre, enMB } from './almacenamiento';

const ARCHIVO_DATOS = 'lecb-biblioteca.json';

type LibroEnCopia = Omit<BookMeta, 'cover'> & {
  archivo: string;
  portada: string | null;
  tipoPortada: string | null;
};

interface DatosCopia {
  app: 'LECB';
  version: 1;
  exportado: string;
  libros: LibroEnCopia[];
}

// Error con un mensaje pensado para mostrarle al usuario.
export class ErrorCopia extends Error {}

export const nombreArchivoCopia = () => `LECB biblioteca ${new Date().toISOString().slice(0, 10)}.zip`;

/* ---------- Crear la copia ---------- */

export async function crearCopia(alProgreso: (texto: string) => void): Promise<Blob> {
  const libros = await getAllBooks();
  const zip = new JSZip();
  const datos: DatosCopia = { app: 'LECB', version: 1, exportado: new Date().toISOString(), libros: [] };

  for (const [i, libro] of libros.entries()) {
    alProgreso(`Preparando libro ${i + 1} de ${libros.length}…`);
    const archivo = await getBookBlob(libro.id);
    if (!archivo) continue;
    const ruta = `libros/${libro.id}.${libro.formato === 'pdf' ? 'pdf' : 'epub'}`;
    // Los EPUB y PDF ya vienen comprimidos: guardarlos sin volver a comprimir es mucho más rápido.
    zip.file(ruta, archivo, { compression: 'STORE' });
    let portada: string | null = null;
    if (libro.cover) {
      portada = `portadas/${libro.id}`;
      zip.file(portada, libro.cover, { compression: 'STORE' });
    }
    const { cover, ...resto } = libro;
    datos.libros.push({ ...resto, archivo: ruta, portada, tipoPortada: cover?.type || null });
  }

  zip.file(ARCHIVO_DATOS, JSON.stringify(datos));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }, (m) =>
    alProgreso(`Armando el archivo… ${Math.round(m.percent)} %`),
  );
}

/* ---------- Restaurar una copia ---------- */

// Junta dos listas sin repetir (por una clave), quedándose con la versión "preferida" si hay repetidos.
function unir<T>(propios: T[], deLaCopia: T[], clave: (x: T) => string, preferirCopia: boolean) {
  const mapa = new Map<string, T>();
  for (const x of preferirCopia ? propios : deLaCopia) mapa.set(clave(x), x);
  for (const x of preferirCopia ? deLaCopia : propios) mapa.set(clave(x), x);
  return [...mapa.values()];
}

// Un libro que ya está en este dispositivo: se combinan subrayados y marcadores de los dos lados,
// y el progreso queda el de la lectura más reciente.
function combinar(actual: BookMeta, copia: LibroEnCopia): Partial<BookMeta> {
  const copiaMasReciente = (copia.lastOpenedAt ?? 0) > (actual.lastOpenedAt ?? 0);
  const cambios: Partial<BookMeta> = {
    highlights: unir<Subrayado>(actual.highlights, copia.highlights ?? [], (s) => s.id, copiaMasReciente),
    bookmarks: unir<Marcador>(actual.bookmarks, copia.bookmarks ?? [], (m) => m.cfi, copiaMasReciente),
  };
  if (copiaMasReciente) {
    Object.assign(cambios, {
      location: copia.location,
      progress: copia.progress,
      page: copia.page,
      pages: copia.pages ?? actual.pages,
      excerpt: copia.excerpt,
      lastOpenedAt: copia.lastOpenedAt,
    });
  }
  return cambios;
}

export interface ResultadoRestauracion {
  agregados: number;
  combinados: number;
  fallidos: number;
}

export async function restaurarCopia(archivo: File, alProgreso: (texto: string) => void): Promise<ResultadoRestauracion> {
  const libre = await espacioLibre();
  if (libre !== null && archivo.size * 1.1 > libre) {
    throw new ErrorCopia(`No hay espacio suficiente en este navegador (quedan ${enMB(libre)}).`);
  }

  alProgreso('Abriendo la copia…');
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(archivo);
  } catch {
    throw new ErrorCopia('Este archivo no es una copia de seguridad de LECB.');
  }
  const archivoDatos = zip.file(ARCHIVO_DATOS);
  if (!archivoDatos) throw new ErrorCopia('Este archivo no es una copia de seguridad de LECB.');
  const datos = JSON.parse(await archivoDatos.async('string')) as DatosCopia;
  if (datos.app !== 'LECB' || !Array.isArray(datos.libros)) {
    throw new ErrorCopia('Este archivo no es una copia de seguridad de LECB.');
  }

  const existentes = new Map((await getAllBooks()).map((b) => [b.id, b]));
  const resultado: ResultadoRestauracion = { agregados: 0, combinados: 0, fallidos: 0 };

  for (const [i, libro] of datos.libros.entries()) {
    alProgreso(`Restaurando libro ${i + 1} de ${datos.libros.length}…`);
    try {
      const actual = existentes.get(libro.id);
      if (actual) {
        await updateBook(libro.id, combinar(actual, libro));
        resultado.combinados++;
        continue;
      }
      const libroZip = zip.file(libro.archivo);
      if (!libroZip) {
        resultado.fallidos++;
        continue;
      }
      const tipo = libro.formato === 'pdf' ? 'application/pdf' : 'application/epub+zip';
      const contenido = new Blob([await libroZip.async('arraybuffer')], { type: tipo });
      const portadaZip = libro.portada ? zip.file(libro.portada) : null;
      const cover = portadaZip
        ? new Blob([await portadaZip.async('arraybuffer')], { type: libro.tipoPortada || 'image/jpeg' })
        : null;
      const { archivo: _a, portada: _p, tipoPortada: _t, ...meta } = libro;
      await addBook({ ...meta, cover } as BookMeta, contenido);
      resultado.agregados++;
    } catch (err) {
      console.error(err);
      resultado.fallidos++;
    }
  }
  return resultado;
}
