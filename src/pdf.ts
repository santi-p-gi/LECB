// Todo lo de PDF: abrir, leer datos y portada, índice y búsqueda de texto. Usa pdf.js.
import * as pdfjs from 'pdfjs-dist';
import urlTrabajador from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { colorDePortada, colorDeRespaldo } from './colores';
import { ESPACIO, MAX_RESULTADOS, normalizar, normalizarCodigo, OMITIR, type Resultado } from './busqueda';

// pdf.js hace el trabajo pesado en un "worker" (un hilo aparte), así la página no se traba.
pdfjs.GlobalWorkerOptions.workerSrc = urlTrabajador;

export type DocumentoPdf = pdfjs.PDFDocumentProxy;

// Capa de texto invisible encima de cada página, para poder seleccionar y subrayar.
export const CapaTexto = pdfjs.TextLayer;

// Ojo: pdf.js se queda con el ArrayBuffer (lo "transfiere" al worker); no se puede volver a usar.
export function abrirPdf(data: ArrayBuffer): Promise<DocumentoPdf> {
  return pdfjs.getDocument({ data }).promise;
}

// Cierra el PDF y libera la memoria (en pdf.js 6 se cierra desde la tarea de carga).
export const cerrarPdf = (pdf: DocumentoPdf) => pdf.loadingTask.destroy();

export const esPdfConClave = (err: unknown) => (err as { name?: string } | null)?.name === 'PasswordException';

// Muchos PDF traen como título algo como "Microsoft Word - apuntes.docx": en ese caso usamos el nombre del archivo.
function tituloUtil(titulo: string | undefined) {
  const t = titulo?.trim();
  if (!t || /^(microsoft (word|powerpoint)|untitled|sin título)|\.(docx?|pptx?|odt|pdf)$/i.test(t)) return null;
  return t;
}

export async function readPdfInfo(data: ArrayBuffer, nombreArchivo: string) {
  const pdf = await abrirPdf(data);
  try {
    const { info } = (await pdf.getMetadata()) as { info: { Title?: string; Author?: string } };
    const title = tituloUtil(info?.Title) ?? nombreArchivo.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();
    const author = info?.Author?.trim() || 'Autor desconocido';

    // La portada es la primera página dibujada en chico.
    const pagina = await pdf.getPage(1);
    const base = pagina.getViewport({ scale: 1 });
    const vista = pagina.getViewport({ scale: 360 / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vista.width);
    canvas.height = Math.ceil(vista.height);
    await pagina.render({ canvas, viewport: vista }).promise;
    const cover = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));

    return {
      title,
      author,
      cover,
      color: (cover && (await colorDePortada(cover))) || colorDeRespaldo(title),
      paginas: pdf.numPages,
    };
  } finally {
    cerrarPdf(pdf);
  }
}

/* ---------- índice (el "outline" del PDF) ---------- */

export interface EntradaIndicePdf {
  label: string;
  nivel: number;
  pagina: number | null; // empieza en 0
}

interface ItemOutline { title: string; dest: unknown; items?: ItemOutline[] }

async function paginaDeDestino(pdf: DocumentoPdf, destino: unknown): Promise<number | null> {
  try {
    const d = typeof destino === 'string' ? await pdf.getDestination(destino) : (destino as unknown[] | null);
    if (!Array.isArray(d) || !d.length) return null;
    const ref = d[0];
    if (typeof ref === 'number') return ref;
    return await pdf.getPageIndex(ref as Parameters<DocumentoPdf['getPageIndex']>[0]);
  } catch {
    return null;
  }
}

export async function indicePdf(pdf: DocumentoPdf): Promise<EntradaIndicePdf[]> {
  const outline = (await pdf.getOutline()) as ItemOutline[] | null;
  const resultado: EntradaIndicePdf[] = [];
  async function recorrer(items: ItemOutline[], nivel: number) {
    for (const item of items) {
      resultado.push({ label: item.title.trim(), nivel, pagina: await paginaDeDestino(pdf, item.dest) });
      if (item.items?.length) await recorrer(item.items, nivel + 1);
    }
  }
  if (outline) await recorrer(outline, 0);
  return resultado;
}

/* ---------- texto de cada página y búsqueda ---------- */

interface ItemTexto { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean }

interface TextoPagina {
  items: ItemTexto[];
  normal: string;
  original: string;
  item: Int32Array; // por letra normalizada: de qué item viene
  posicion: Int32Array; // y en qué posición dentro del item
}

const textosPorPdf = new WeakMap<DocumentoPdf, Map<number, TextoPagina>>();

export async function textoDePagina(pdf: DocumentoPdf, indice: number): Promise<TextoPagina> {
  let textos = textosPorPdf.get(pdf);
  if (!textos) textosPorPdf.set(pdf, (textos = new Map()));
  const guardado = textos.get(indice);
  if (guardado) return guardado;

  const contenido = await (await pdf.getPage(indice + 1)).getTextContent();
  const items = contenido.items.filter((i): i is typeof i & ItemTexto => 'str' in i) as ItemTexto[];
  const normal: number[] = [], original: number[] = [], item: number[] = [], posicion: number[] = [];
  let espacioAntes = true;
  items.forEach((it, i) => {
    for (let k = 0; k < it.str.length; k++) {
      const codigo = it.str.charCodeAt(k);
      const c = normalizarCodigo(codigo);
      if (c === OMITIR) continue;
      if (c === ESPACIO) {
        if (espacioAntes) continue;
        espacioAntes = true;
      } else espacioAntes = false;
      normal.push(c); original.push(c === ESPACIO ? ESPACIO : codigo); item.push(i); posicion.push(k);
    }
    // Fin de renglón: va un espacio para que no se peguen las palabras.
    if (it.hasEOL && !espacioAntes) {
      normal.push(ESPACIO); original.push(ESPACIO); item.push(i); posicion.push(it.str.length);
      espacioAntes = true;
    }
  });
  const texto = (codigos: number[]) => {
    let t = '';
    for (let i = 0; i < codigos.length; i += 8192) t += String.fromCharCode(...codigos.slice(i, i + 8192));
    return t;
  };
  const resultado: TextoPagina = {
    items, normal: texto(normal), original: texto(original),
    item: Int32Array.from(item), posicion: Int32Array.from(posicion),
  };
  textos.set(indice, resultado);
  return resultado;
}

// Rectángulos (en unidades del PDF) que ocupa un tramo de texto: sirven para resaltarlo.
function rectangulos(t: TextoPagina, desde: number, hasta: number) {
  const rects: number[][] = [];
  for (let i = t.item[desde]; i <= t.item[hasta]; i++) {
    const it = t.items[i];
    if (!it?.str.length) continue;
    const ini = i === t.item[desde] ? t.posicion[desde] : 0;
    const fin = i === t.item[hasta] ? t.posicion[hasta] + 1 : it.str.length;
    const [, , , , x, y] = it.transform;
    const alto = it.height || Math.abs(it.transform[3]) || 10;
    const x1 = x + (it.width * ini) / it.str.length;
    const x2 = x + (it.width * fin) / it.str.length;
    rects.push([x1, y - alto * 0.2, x2, y + alto * 0.9]);
  }
  return rects;
}

export interface ResultadoPdf extends Resultado {
  rects: number[][];
}

export async function buscarEnPdf(
  pdf: DocumentoPdf,
  consultaOriginal: string,
  alEncontrar: (nuevos: ResultadoPdf[]) => void,
  cancelada: () => boolean,
): Promise<'lista' | 'limite' | 'cancelada'> {
  const consulta = normalizar(consultaOriginal);
  if (!consulta) return 'lista';
  let total = 0;
  for (let p = 0; p < pdf.numPages; p++) {
    if (cancelada()) return 'cancelada';
    let t: TextoPagina;
    try {
      t = await textoDePagina(pdf, p);
    } catch {
      continue;
    }
    if (cancelada()) return 'cancelada';
    const nuevos: ResultadoPdf[] = [];
    let desde = 0;
    while (total + nuevos.length < MAX_RESULTADOS) {
      const pos = t.normal.indexOf(consulta, desde);
      if (pos < 0) break;
      desde = pos + consulta.length;
      nuevos.push({
        cfi: `pdf-${p}-${pos}`, // identificador único (en PDF no hay CFI)
        spine: p,
        antes: t.original.slice(Math.max(0, pos - 60), pos).replace(/^\S*\s/, '').trimStart(),
        coincidencia: t.original.slice(pos, pos + consulta.length),
        despues: t.original.slice(pos + consulta.length, pos + consulta.length + 80).replace(/\s\S*$/, ''),
        rects: rectangulos(t, pos, pos + consulta.length - 1),
      });
    }
    if (nuevos.length) {
      total += nuevos.length;
      alEncontrar(nuevos);
    }
    if (total >= MAX_RESULTADOS) return 'limite';
  }
  return 'lista';
}

// Comienzo del texto de una página, para "Te quedaste en…".
export async function fraseDePagina(pdf: DocumentoPdf, indice: number) {
  try {
    const t = (await textoDePagina(pdf, indice)).original.trim();
    if (t.length < 20) return null;
    return t.length > 160 ? t.slice(0, 160).replace(/\s+\S*$/, '') : t;
  } catch {
    return null;
  }
}
