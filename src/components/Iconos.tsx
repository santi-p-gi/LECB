// Íconos SVG de las maquetas, como componentes reutilizables.

export const Logo = () => (
  <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
    <path d="M16 8c-3-2.2-7-3-11-2.6v18c4-.4 8 .4 11 2.6 3-2.2 7-3 11-2.6v-18c-4-.4-8 .4-11 2.6Z" />
    <path d="M16 8v18" />
  </svg>
);

export const Luna = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
  </svg>
);

export const Subir = () => (
  <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M32 16c-5-3.6-12-5-20-4.4v34c8-.6 15 .8 20 4.4 5-3.6 12-5 20-4.4v-34c-8-.6-15 .8-20 4.4Z" />
    <path d="M32 16v34" />
    <path d="M32 2v8M28 6l4-4 4 4" />
  </svg>
);

export const LibroAbierto = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 6c-2.3-1.6-5.3-2.2-9-2v14c3.7-.2 6.7.4 9 2 2.3-1.6 5.3-2.2 9-2V4c-3.7-.2-6.7.4-9 2Z" />
    <path d="M12 6v14" />
  </svg>
);

export const Tipografia = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M4 19 9 5h1l5 14M6 14h7" />
    <path d="M17 11.5c.6-.9 1.4-1.3 2.4-1.3 1.6 0 2.6 1 2.6 2.6V19m0-4.2c-.8-.3-1.5-.4-2.3-.4-1.7 0-2.7.8-2.7 2.1 0 1.2.9 2 2.2 2 1.3 0 2.3-.8 2.8-1.9" />
  </svg>
);

export const Cinta = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 3h10v18l-5-4-5 4V3Z" />
  </svg>
);

export const Volver = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

export const Lista = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
  </svg>
);

export const Cerrar = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const Interlineado = ({ separacion }: { separacion: number }) => (
  <svg viewBox="0 0 22 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
    <path d={`M2 ${9 - separacion}h18M2 9h18M2 ${9 + separacion}h18`} />
  </svg>
);

export const Lupa = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </svg>
);
