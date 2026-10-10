// Estadísticas anónimas con GoatCounter (sin cookies, sin datos personales).
// Solo contamos QUÉ pasa ("alguien importó un libro"), nunca títulos, textos ni notas.
//
// El script de GoatCounter se carga en index.html. Si no está (en localhost, sin internet o
// con un bloqueador de anuncios), estas funciones simplemente no hacen nada.

interface GoatCounter {
  count(datos: { path: string; title?: string; event?: boolean }): void;
}

export type Evento =
  | 'importar-epub'
  | 'importar-pdf'
  | 'importar-error'
  | 'probar-demo'
  | 'abrir-epub'
  | 'abrir-pdf'
  | 'app-instalada'
  | 'subrayado'
  | 'nota'
  | 'busqueda'
  | 'marcador'
  | 'importar-drm'
  | 'copia-exportada'
  | 'copia-restaurada';

export function contarEvento(evento: Evento) {
  const gc = (window as Window & { goatcounter?: GoatCounter }).goatcounter;
  try {
    gc?.count({ path: evento, title: evento, event: true });
  } catch {
    // las estadísticas nunca deben romper la app
  }
}
