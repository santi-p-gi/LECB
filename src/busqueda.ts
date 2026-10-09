// Búsqueda de texto dentro de un libro EPUB.
// Recorre el libro capítulo por capítulo (con copias aparte, sin tocar lo que se está mostrando)
// e ignora mayúsculas y tildes: "accion" encuentra "Acción".
import { EpubCFI, type Book } from 'epubjs';
import { leerCapitulo, secciones } from './epub';

export interface Resultado {
  cfi: string; // rango exacto de la coincidencia
  spine: number;
  antes: string; // texto antes de la coincidencia
  coincidencia: string;
  despues: string;
}

export const MAX_RESULTADOS = 300;

/* ---------- normalizar letras (rápido, con tabla) ---------- */

const ESPACIO = 32;
const OMITIR = -1; // marcas de tilde sueltas: no cuentan como letra

// Para cada código de letra, su versión sin tilde y en minúscula. Se calcula una sola vez.
const TABLA = new Int32Array(0x300);
for (let c = 0; c < TABLA.length; c++) {
  const n = String.fromCharCode(c).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  TABLA[c] = n.length === 0 ? OMITIR : n.charCodeAt(0);
}

function esEspacio(c: number) {
  return c === 9 || c === 10 || c === 13 || c === 32 || c === 160 || (c >= 0x2000 && c <= 0x200a) || c === 0x202f || c === 0x3000;
}

function normalizarCodigo(c: number) {
  if (esEspacio(c)) return ESPACIO;
  if (c < TABLA.length) return TABLA[c];
  if (c >= 0x300 && c <= 0x36f) return OMITIR; // tildes combinadas sueltas
  return String.fromCharCode(c).toLowerCase().charCodeAt(0);
}

export function normalizar(texto: string) {
  let r = '';
  let espacioAntes = true;
  for (let i = 0; i < texto.length; i++) {
    const c = normalizarCodigo(texto.charCodeAt(i));
    if (c === OMITIR) continue;
    if (c === ESPACIO) {
      if (espacioAntes) continue;
      espacioAntes = true;
    } else espacioAntes = false;
    r += String.fromCharCode(c);
  }
  return r.trimEnd();
}

/* ---------- índice de cada capítulo ---------- */

// El texto del capítulo "normalizado" y, para cada letra, de qué nodo y posición original viene:
// así una coincidencia se puede convertir en un rango del libro (CFI).
interface IndiceCapitulo {
  spine: number;
  cfiBase: string;
  doc: Document;
  nodos: Text[];
  normal: string;
  original: string;
  nodo: Int32Array;
  posicion: Int32Array;
}

const BLOQUES = 'p, div, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, section, dd, dt, pre, body';

// Arma un texto a partir de códigos de letras (por tramos, para no pasarse del límite de argumentos).
function deCodigos(codigos: number[]) {
  let texto = '';
  for (let i = 0; i < codigos.length; i += 8192) texto += String.fromCharCode(...codigos.slice(i, i + 8192));
  return texto;
}

function indexar(doc: Document, spine: number, cfiBase: string): IndiceCapitulo {
  const nodos: Text[] = [];
  const normal: number[] = [];
  const original: number[] = [];
  const nodo: number[] = [];
  const posicion: number[] = [];
  let espacioAntes = true;
  let bloqueAnterior: Element | null = null;

  if (doc.body) {
    const recorrido = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    while (recorrido.nextNode()) {
      const n = recorrido.currentNode as Text;
      const i = nodos.push(n) - 1;
      // Entre párrafos distintos va un espacio, para que no se peguen las palabras.
      const bloque = n.parentElement?.closest(BLOQUES) ?? null;
      if (bloqueAnterior && bloque !== bloqueAnterior && !espacioAntes) {
        normal.push(ESPACIO); original.push(ESPACIO); nodo.push(i); posicion.push(0);
        espacioAntes = true;
      }
      bloqueAnterior = bloque;

      const texto = n.data;
      for (let k = 0; k < texto.length; k++) {
        const codigo = texto.charCodeAt(k);
        const c = normalizarCodigo(codigo);
        if (c === OMITIR) continue;
        if (c === ESPACIO) {
          if (espacioAntes) continue; // espacios repetidos cuentan como uno
          espacioAntes = true;
        } else espacioAntes = false;
        normal.push(c);
        original.push(c === ESPACIO ? ESPACIO : codigo);
        nodo.push(i);
        posicion.push(k);
      }
    }
  }

  return {
    spine, cfiBase, doc, nodos,
    normal: deCodigos(normal),
    original: deCodigos(original),
    nodo: Int32Array.from(nodo),
    posicion: Int32Array.from(posicion),
  };
}

// Índices ya armados de cada libro abierto: la segunda búsqueda no vuelve a leer los capítulos.
const indicesPorLibro = new WeakMap<Book, Map<number, IndiceCapitulo>>();

function buscarEnIndice(ind: IndiceCapitulo, consulta: string, maximo: number) {
  const resultados: Resultado[] = [];
  let desde = 0;
  while (resultados.length < maximo) {
    const pos = ind.normal.indexOf(consulta, desde);
    if (pos < 0) break;
    desde = pos + consulta.length;
    const ultimo = pos + consulta.length - 1;
    try {
      const rango = ind.doc.createRange();
      rango.setStart(ind.nodos[ind.nodo[pos]], ind.posicion[pos]);
      rango.setEnd(ind.nodos[ind.nodo[ultimo]], ind.posicion[ultimo] + 1);
      resultados.push({
        cfi: new EpubCFI(rango, ind.cfiBase).toString(),
        spine: ind.spine,
        antes: ind.original.slice(Math.max(0, pos - 60), pos).replace(/^\S*\s/, '').trimStart(),
        coincidencia: ind.original.slice(pos, pos + consulta.length),
        despues: ind.original.slice(pos + consulta.length, pos + consulta.length + 80).replace(/\s\S*$/, ''),
      });
    } catch {
      // coincidencia que no se pudo ubicar: la salteamos
    }
  }
  return resultados;
}

// Busca en todo el libro. Va avisando los resultados de cada capítulo a medida que los encuentra.
// Devuelve 'limite' si cortó por llegar al máximo, 'cancelada' si se pidió otra búsqueda, o 'lista'.
export async function buscarEnLibro(
  book: Book,
  consultaOriginal: string,
  alEncontrar: (nuevos: Resultado[]) => void,
  cancelada: () => boolean,
): Promise<'lista' | 'limite' | 'cancelada'> {
  const consulta = normalizar(consultaOriginal);
  if (!consulta) return 'lista';
  let indices = indicesPorLibro.get(book);
  if (!indices) indicesPorLibro.set(book, (indices = new Map()));

  let total = 0;
  let desdeUltimaPausa = performance.now();
  for (const s of secciones(book)) {
    if (!s.linear) continue;
    if (cancelada()) return 'cancelada';
    let ind = indices.get(s.index);
    if (!ind) {
      try {
        ind = indexar(await leerCapitulo(book, s.url), s.index, s.cfiBase);
      } catch {
        continue;
      }
      indices.set(s.index, ind);
      if (cancelada()) return 'cancelada';
    }
    const nuevos = buscarEnIndice(ind, consulta, MAX_RESULTADOS - total);
    if (nuevos.length) {
      total += nuevos.length;
      alEncontrar(nuevos);
    }
    if (total >= MAX_RESULTADOS) return 'limite';
    // Cada tanto deja respirar a la página para que no se trabe mientras busca.
    if (performance.now() - desdeUltimaPausa > 30) {
      await new Promise((r) => setTimeout(r, 0));
      desdeUltimaPausa = performance.now();
    }
  }
  return 'lista';
}
