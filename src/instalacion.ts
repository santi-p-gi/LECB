// Todo lo de "instalar LECB como app": registrar el service worker y el botón "Instalar app".
import { useEffect, useState } from 'react';
import { pedirPersistencia } from './almacenamiento';

// Evento que Chrome, Edge y Android disparan cuando la web se puede instalar.
// (No está en los tipos estándar de TypeScript porque no todos los navegadores lo tienen.)
interface EventoInstalacion extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let eventoGuardado: EventoInstalacion | null = null;
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach((f) => f());

// El navegador avisa una sola vez, al cargar: guardamos el aviso para usarlo cuando toquen el botón.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // evita la barra automática; mostramos nuestro propio botón
  eventoGuardado = e as EventoInstalacion;
  avisar();
});
window.addEventListener('appinstalled', () => {
  eventoGuardado = null;
  avisar();
});

export const estaInstalada = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

// iPhone y iPad (los iPad nuevos dicen ser Mac, pero tienen pantalla táctil).
export const esIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Se llama una vez al arrancar la web.
export function iniciarApp() {
  // El service worker solo en la versión publicada: mientras desarrollamos guardaría versiones viejas.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => console.error('Service worker:', err));
    });
  }
  // Abierta como app instalada: pedimos que el navegador no borre la biblioteca por su cuenta.
  if (estaInstalada()) pedirPersistencia();
}

// Para los componentes: ¿se puede mostrar el botón? ¿y qué hace al tocarlo?
export function useInstalacion() {
  const [, redibujar] = useState(0);
  useEffect(() => {
    const f = () => redibujar((n) => n + 1);
    oyentes.add(f);
    return () => {
      oyentes.delete(f);
    };
  }, []);

  return {
    // Chrome / Edge / Android: hay aviso guardado.
    puedeInstalar: eventoGuardado !== null,
    // iPhone: no hay aviso; se muestran instrucciones.
    necesitaAyudaIOS: esIOS() && !estaInstalada(),
    instalar: async () => {
      if (!eventoGuardado) return false;
      await eventoGuardado.prompt();
      const { outcome } = await eventoGuardado.userChoice;
      eventoGuardado = null; // el aviso se puede usar una sola vez
      avisar();
      if (outcome === 'accepted') pedirPersistencia();
      return outcome === 'accepted';
    },
  };
}
