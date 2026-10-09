// Colores de lomos y tapas.

// Paleta de la maqueta, para libros sin portada.
const PALETA = [
  '#9b3b2a', '#2f4a3a', '#1f2a44', '#c08f42', '#5a3d5c', '#6d7a80',
  '#3e5a6e', '#7a2e3a', '#44614a', '#8c5a3a', '#2b2d33', '#d9c79f',
];

// Un número estable a partir de un texto (el mismo título da siempre el mismo número).
export function hashTexto(texto: string) {
  let h = 0;
  for (const c of texto) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

export function colorDeRespaldo(titulo: string) {
  return PALETA[hashTexto(titulo) % PALETA.length];
}

// Color del texto que se lee bien sobre un fondo dado.
export function colorTexto(fondo: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(fondo.slice(i, i + 2), 16));
  const luz = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luz > 0.6 ? '#2b2219' : '#f3ead9';
}

// Saca el color promedio de la portada y lo ajusta para que parezca un lomo de tela.
export async function colorDePortada(portada: Blob): Promise<string | null> {
  try {
    const imagen = await createImageBitmap(portada);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 24;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(imagen, 0, 0, 24, 24);
    const px = ctx.getImageData(0, 0, 24, 24).data;

    // Promedio pesado por saturación: los colores vivos pesan más que el blanco y el gris.
    let r = 0, g = 0, b = 0, peso = 0;
    for (let i = 0; i < px.length; i += 4) {
      const max = Math.max(px[i], px[i + 1], px[i + 2]);
      const min = Math.min(px[i], px[i + 1], px[i + 2]);
      const p = 0.05 + (max - min) / 255;
      r += px[i] * p; g += px[i + 1] * p; b += px[i + 2] * p; peso += p;
    }
    return ajustarLomo(r / peso, g / peso, b / peso);
  } catch {
    return null;
  }
}

// Lleva el color a una luminosidad de lomo (ni muy claro ni negro).
function ajustarLomo(r: number, g: number, b: number) {
  const [h, s, l] = rgbAHsl(r, g, b);
  return hslAHex(h, Math.min(s, 0.55), Math.min(Math.max(l, 0.22), 0.45));
}

function rgbAHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslAHex(h: number, s: number, l: number) {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
