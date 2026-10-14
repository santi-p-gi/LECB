// Preferencias del lector y del sitio. Se guardan en este navegador (localStorage).
// Si el navegador no deja guardar (modo privado, etc.) se usan los valores por defecto.

export type Tema = 'papel' | 'sepia' | 'noche';
export type Fuente = 'literata' | 'garamond' | 'atkinson';
// Cómo se ve el paso de página: fundido suave, hoja que gira, o sin animación.
export type Animacion = 'normal' | 'hoja' | 'ninguna';

export interface Preferencias {
  tema: Tema;
  fuente: Fuente;
  tam: number; // índice dentro de TAMANOS
  lh: number; // interlineado
  doble: boolean;
  notasMargen: boolean; // tarjetas con las notas al costado del libro (pantallas anchas)
  animacion: Animacion;
  voz: string | null; // voz elegida para leer en voz alta (null = la que elija el dispositivo)
  velocidadVoz: number;
  completa: boolean; // pantalla completa: sin marco ni barras fijas
  pantallaEncendida: boolean; // que el celular no apague la pantalla mientras se lee
}

export const TAMANOS = [15, 16, 17, 18, 20, 22, 24];

export const FUENTES: Record<Fuente, { nombre: string; css: string }> = {
  literata: { nombre: 'Literata', css: '"Literata", Georgia, serif' },
  garamond: { nombre: 'Garamond', css: '"EB Garamond", Garamond, Georgia, serif' },
  atkinson: { nombre: 'Legible', css: '"Atkinson Hyperlegible", system-ui, sans-serif' },
};

// Colores de cada tema, también para el texto dentro del libro (que no ve las variables CSS).
export const TEMAS: Record<Tema, { nombre: string; hoja: string; texto: string; texto2: string; acento: string }> = {
  papel: { nombre: 'Papel', hoja: '#fbf7ef', texto: '#2a241c', texto2: '#82776a', acento: '#9b3b2a' },
  sepia: { nombre: 'Sepia', hoja: '#f3e7cc', texto: '#43341f', texto2: '#8a7352', acento: '#8c3a1f' },
  noche: { nombre: 'Noche', hoja: '#1e1b17', texto: '#d6ccbb', texto2: '#8a806f', acento: '#e08a6d' },
};

export const ANIMACIONES: { valor: Animacion; nombre: string }[] = [
  { valor: 'normal', nombre: 'Normal' },
  { valor: 'hoja', nombre: 'Hoja' },
  { valor: 'ninguna', nombre: 'Sin animación' },
];

export const INTERLINEADOS = [
  { valor: 1.45, nombre: 'Compacto' },
  { valor: 1.6, nombre: 'Normal' },
  { valor: 1.8, nombre: 'Amplio' },
];

const CLAVE = 'lecb-preferencias';

const prefiereOscuro = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;

export function cargarPreferencias(): Preferencias {
  const base: Preferencias = {
    tema: prefiereOscuro() ? 'noche' : 'papel',
    fuente: 'literata',
    tam: 3,
    lh: 1.6,
    doble: true,
    notasMargen: true,
    animacion: 'normal',
    voz: null,
    velocidadVoz: 1,
    completa: false,
    pantallaEncendida: true,
  };
  try {
    return { ...base, ...JSON.parse(localStorage.getItem(CLAVE) || '{}') };
  } catch {
    return base;
  }
}

export function guardarPreferencias(prefs: Preferencias) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(prefs));
  } catch {
    // sin almacenamiento: las preferencias duran hasta cerrar la pestaña
  }
}

// Tema claro/oscuro de la biblioteca.
export function cargarTemaSitio(): 'light' | 'dark' | null {
  try {
    const t = localStorage.getItem('lecb-tema-sitio');
    return t === 'light' || t === 'dark' ? t : null;
  } catch {
    return null;
  }
}

export function guardarTemaSitio(tema: 'light' | 'dark') {
  try {
    localStorage.setItem('lecb-tema-sitio', tema);
  } catch {
    // ignorado
  }
}
