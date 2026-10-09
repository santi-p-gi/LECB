// Límites de tamaño y espacio disponible en el navegador.

export const TAMANO_MAXIMO = 500 * 1024 * 1024; // más que esto no se importa
export const TAMANO_AVISO = 150 * 1024 * 1024; // desde acá avisamos que puede ir lento en el celular

export const enMB = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`;

// Cuánto espacio le queda a esta web en el navegador (null si el navegador no lo informa).
export async function espacioLibre(): Promise<number | null> {
  try {
    const { quota, usage } = await navigator.storage.estimate();
    if (quota === undefined || usage === undefined) return null;
    return quota - usage;
  } catch {
    return null;
  }
}

// Pide al navegador que no borre la biblioteca por su cuenta cuando necesite espacio
// (Safari, por ejemplo, borra los datos de webs que no se visitan hace días).
export async function pedirPersistencia() {
  try {
    if (await navigator.storage?.persisted?.()) return;
    await navigator.storage?.persist?.();
  } catch {
    // el navegador no lo soporta: seguimos igual
  }
}

export const esFaltaDeEspacio = (err: unknown) =>
  err instanceof DOMException && err.name === 'QuotaExceededError';
