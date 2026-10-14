// Diccionario: definiciones de Wiktionary en español (es.wiktionary.org), un diccionario abierto.
// Solo se envía la palabra elegida: ni el libro ni nada que identifique al lector.
// Para libros en otros idiomas se usa la sección de ese idioma (por ejemplo "Inglés"),
// que explica las palabras en español: sirve también como traductor.

export interface Acepcion {
  tipo: string; // "Sustantivo masculino", "Verbo transitivo"…
  texto: string;
}

export interface Definicion {
  palabra: string; // la que se muestra (puede ser el infinitivo de un verbo conjugado)
  buscada: string; // la que se tocó en el libro
  idioma: string; // nombre de la sección usada ("Español", "Inglés"…)
  acepciones: Acepcion[];
  url: string; // la página en Wiktionary
}

const API = 'https://es.wiktionary.org/w/api.php';

// Código de idioma del libro → nombre de la sección en Wiktionary en español.
const SECCIONES: Record<string, string> = {
  es: 'Español', en: 'Inglés', pt: 'Portugués', fr: 'Francés', it: 'Italiano', de: 'Alemán',
  la: 'Latín', ca: 'Catalán', gl: 'Gallego',
};

// Partes que no son definiciones.
const NO_DEFINICION = /^(etimolog|pronunciaci|traducci|informaci|véase|referencias|conjugaci|locuciones|refranes|descendientes|derivad|relacionad)/i;

const guardadas = new Map<string, Promise<Definicion | null>>();

// La palabra limpia: sin signos alrededor ("¡Hidalgo!," → "Hidalgo").
export function limpiarPalabra(texto: string) {
  return texto.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

// ¿La selección es una sola palabra? (el botón "Definir" aparece solo en ese caso)
export const esUnaPalabra = (texto: string) => {
  const p = limpiarPalabra(texto);
  return p.length > 1 && p.length <= 40 && !/\s/.test(p) && /\p{L}/u.test(p);
};

export function definir(texto: string, idioma = 'es'): Promise<Definicion | null> {
  const palabra = limpiarPalabra(texto);
  const clave = `${idioma}:${palabra}`;
  let p = guardadas.get(clave);
  if (!p) {
    p = buscar(palabra, idioma);
    guardadas.set(clave, p);
    p.catch(() => guardadas.delete(clave)); // un error de conexión no queda guardado
  }
  return p;
}

async function buscar(palabra: string, idioma: string): Promise<Definicion | null> {
  // Primero en minúscula (como están en el diccionario); si no, tal cual (nombres propios).
  const candidatas = [...new Set([palabra.toLowerCase(), palabra])];
  for (const c of candidatas) {
    const d = await consultar(c, idioma, palabra, 0);
    if (d) return d;
  }
  return null;
}

async function consultar(titulo: string, idioma: string, buscada: string, saltos: number): Promise<Definicion | null> {
  const url = `${API}?action=parse&page=${encodeURIComponent(titulo)}&prop=text&format=json&formatversion=2&redirects=1&origin=*`;
  const respuesta = await fetch(url);
  if (!respuesta.ok) throw new Error(`Wiktionary respondió ${respuesta.status}`);
  const datos = (await respuesta.json()) as { parse?: { title: string; text: string }; error?: { code: string } };
  if (!datos.parse) return null; // la palabra no está

  const doc = new DOMParser().parseFromString(datos.parse.text, 'text/html');
  const seccion = elegirSeccion(doc, SECCIONES[idioma] ?? 'Español');
  if (!seccion) return null;
  const { acepciones, lema } = leerSeccion(seccion.elementos);

  // Una forma conjugada o plural ("frisaba", "lantejas"): mostramos la palabra base.
  const soloFormas = acepciones.length > 0 && acepciones.every((a) => a.tipo === 'forma');
  if (soloFormas && lema && lema !== titulo && saltos < 2) {
    const base = await consultar(lema, idioma, buscada, saltos + 1);
    if (base) return base;
  }
  if (!acepciones.length) return null;
  return {
    palabra: datos.parse.title,
    buscada,
    idioma: seccion.nombre,
    acepciones: acepciones.map((a) => (a.tipo === 'forma' ? { ...a, tipo: 'Forma de otra palabra' } : a)),
    url: `https://es.wiktionary.org/wiki/${encodeURIComponent(datos.parse.title)}`,
  };
}

// Cada idioma es una sección que empieza con un título grande (h2). Devuelve los elementos
// de la sección pedida (o de la primera, si no está).
function elegirSeccion(doc: Document, nombre: string) {
  const raiz = doc.querySelector('.mw-parser-output') ?? doc.body;
  const secciones: { nombre: string; elementos: Element[] }[] = [];
  for (const el of [...raiz.children]) {
    const h2 = el.matches('h2') ? el : el.querySelector(':scope > h2');
    if (h2) secciones.push({ nombre: (h2.textContent ?? '').replace(/\[editar\]/, '').trim(), elementos: [] });
    else secciones.at(-1)?.elementos.push(el);
  }
  return secciones.find((s) => s.nombre === nombre) ?? null;
}

function leerSeccion(elementos: Element[]) {
  const acepciones: Acepcion[] = [];
  let tipo = '';
  let lema: string | null = null;
  for (const el of elementos) {
    const titulo = el.matches('h3, h4, h5') ? el : el.querySelector(':scope > h3, :scope > h4, :scope > h5');
    if (titulo) {
      tipo = (titulo.textContent ?? '').trim();
      continue;
    }
    if (!el.matches('dl') || !tipo || NO_DEFINICION.test(tipo)) continue;
    // Solo las definiciones numeradas (un dd justo después de su número, dt). Los ejemplos de uso
    // también vienen en dd, pero sin número.
    for (const dd of el.querySelectorAll(':scope > dd')) {
      if (dd.previousElementSibling?.tagName !== 'DT') continue;
      dd.querySelectorAll('style, link, sup, .mw-editsection, .mw-collapsible').forEach((x) => x.remove());
      dd.querySelectorAll('li').forEach((li) => /^\s*(ejemplos?|traducci)/i.test(li.textContent ?? '') && li.remove());
      const impropia = dd.querySelector('.definicion-impropia');
      const texto = (dd.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!texto) continue;
      if (impropia) {
        // "Primera persona del singular … de frisar." → el último enlace es la palabra base.
        const enlaces = [...dd.querySelectorAll('a')];
        lema ??= enlaces.at(-1)?.textContent?.trim() || null;
        acepciones.push({ tipo: 'forma', texto });
      } else {
        acepciones.push({ tipo, texto });
      }
    }
  }
  return { acepciones, lema };
}
