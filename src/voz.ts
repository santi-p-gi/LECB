// Lectura en voz alta: voces disponibles y división del texto en oraciones.
// Usa la voz del propio dispositivo (Web Speech API): no hay servidor ni costo.

export const vozDisponible = () =>
  typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

// Las voces más naturales primero: las del mismo país del usuario y las "neuronales"
// (Edge y Chrome las llaman "Natural", "Online" o "Google").
function puntaje(v: SpeechSynthesisVoice) {
  let p = 0;
  if (v.lang.toLowerCase() === navigator.language.toLowerCase()) p += 4;
  if (/natural|online|neural|google/i.test(v.name)) p += 2;
  if (v.localService) p += 1; // funcionan sin internet
  return p;
}

export function vocesEnEspanol(): SpeechSynthesisVoice[] {
  if (!vozDisponible()) return [];
  return speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith('es'))
    .sort((a, b) => puntaje(b) - puntaje(a) || a.name.localeCompare(b.name));
}

// Nombre corto para mostrar: "Microsoft Elena Online (Natural) - Spanish (Argentina)" → "Elena · Argentina".
export function nombreVoz(v: SpeechSynthesisVoice) {
  const pais = v.name.match(/\(([^()]+)\)\s*$/)?.[1] ?? v.lang;
  const nombre = v.name.replace(/^(Microsoft|Google|Apple)\s+/i, '').replace(/\s*[-(].*$/, '').trim() || v.name;
  return `${nombre} · ${pais}`;
}

const BLOQUES = 'p, div, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, dd, dt, pre, body';

export interface Oracion {
  texto: string;
  rango: Range;
}

// Divide el texto visible en oraciones. Leer de a una oración permite resaltar lo que se está
// leyendo y evita un error de Chrome que corta la voz en textos largos (~15 segundos).
export function oracionesDelRango(doc: Document, visible: Range): Oracion[] {
  const resultado: Oracion[] = [];
  if (!doc.body) return resultado;

  let inicio: [Text, number] | null = null;
  let fin: [Text, number] | null = null;
  let texto = '';
  let bloqueAnterior: Element | null = null;

  const cerrar = () => {
    const limpio = texto.replace(/\s+/g, ' ').trim();
    if (inicio && fin && /[\p{L}\p{N}]/u.test(limpio)) {
      const rango = doc.createRange();
      rango.setStart(inicio[0], inicio[1]);
      rango.setEnd(fin[0], fin[1]);
      resultado.push({ texto: limpio, rango });
    }
    inicio = fin = null;
    texto = '';
  };

  const recorrido = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  while (recorrido.nextNode()) {
    const nodo = recorrido.currentNode as Text;
    if (!visible.intersectsNode(nodo) || nodo.parentElement?.closest('script, style')) continue;
    // Un párrafo nuevo siempre empieza una oración nueva.
    const bloque = nodo.parentElement?.closest(BLOQUES) ?? null;
    if (bloque !== bloqueAnterior) cerrar();
    bloqueAnterior = bloque;

    const desde = nodo === visible.startContainer ? visible.startOffset : 0;
    const hasta = nodo === visible.endContainer ? visible.endOffset : nodo.length;
    for (let k = desde; k < hasta; k++) {
      const letra = nodo.data[k];
      if (!inicio) {
        if (/\s/.test(letra)) continue;
        inicio = [nodo, k];
      }
      texto += letra;
      fin = [nodo, k + 1];
      const siguiente = nodo.data[k + 1];
      const finDeOracion = '.!?…'.includes(letra) && (siguiente === undefined || /[\s»”"')\]]/.test(siguiente));
      // Las oraciones muy largas se cortan en una coma (o en un espacio, si no hay comas).
      if (finDeOracion || (texto.length > 220 && /[,;:]/.test(letra)) || (texto.length > 320 && letra === ' ')) cerrar();
    }
  }
  cerrar();
  return resultado;
}
