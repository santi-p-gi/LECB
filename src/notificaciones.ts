// Avisos de lectura: una notificación cuando en la zona del lector hay un lindo momento para
// leer (lluvia, sol, frío, calor), como mucho una por semana. Ver notificaciones/ (el servidor).
//
// Qué sale del dispositivo: la dirección anónima de notificación que da el navegador, la zona
// horaria y, si el lector la comparte, una zona aproximada (redondeada a unos 10 km).
// Nada de libros ni datos personales: el mensaje lo arma el propio dispositivo.
import { esIOS, estaInstalada } from './instalacion';

export const URL_AVISOS: string = import.meta.env.VITE_AVISOS_URL ?? 'https://avisos.lecb.ar';
const VAPID_PUBLICA = 'BLsLpeyLw2XQJ3pUeUcuOZHOLg30ZLc3hb1gGgbMu5ke7nSL9H6BWojhBuH5EFBLqyy4hP-asqI2_kaa7SQAymg';

const CLAVE_ZONA = 'lecb-avisos-zona'; // última zona enviada (para no mandarla de nuevo si no cambió)
const CLAVE_INVITACION = 'lecb-avisos-invitacion'; // "cerrada" = el lector dijo "ahora no"

export type EstadoAvisos = 'no-disponible' | 'instalar-ios' | 'bloqueados' | 'activados' | 'desactivados';

const hayPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function suscripcionActual() {
  if (!hayPush()) return null;
  const registro = await navigator.serviceWorker.getRegistration();
  return (await registro?.pushManager.getSubscription()) ?? null;
}

export async function estadoAvisos(): Promise<EstadoAvisos> {
  // En iPhone las notificaciones web solo existen con LECB instalada en la pantalla de inicio.
  if (esIOS() && !estaInstalada()) return 'instalar-ios';
  if (!hayPush() || !import.meta.env.PROD) return 'no-disponible';
  if (Notification.permission === 'denied') return 'bloqueados';
  return (await suscripcionActual()) ? 'activados' : 'desactivados';
}

function llaveAplicacion() {
  const b64 = VAPID_PUBLICA.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// Zona aproximada del lector, con su permiso. null si no la quiere compartir.
function pedirZona(): Promise<{ lat: number; lon: number } | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise((ok) =>
    navigator.geolocation.getCurrentPosition(
      (p) => ok({ lat: Math.round(p.coords.latitude * 10) / 10, lon: Math.round(p.coords.longitude * 10) / 10 }),
      () => ok(null),
      { enableHighAccuracy: false, maximumAge: 6 * 3600 * 1000, timeout: 15000 },
    ),
  );
}

async function enviar(ruta: string, datos: unknown) {
  const r = await fetch(`${URL_AVISOS}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos),
  });
  if (!r.ok) throw new Error(`avisos ${ruta}: ${r.status}`);
  return r.json();
}

const zonaHoraria = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Argentina/Buenos_Aires';

async function registrar(endpoint: string, zona: { lat: number; lon: number } | null) {
  await enviar('/suscribir', { endpoint, zona, zonaHoraria: zonaHoraria() });
  try {
    localStorage.setItem(CLAVE_ZONA, JSON.stringify(zona));
  } catch {
    // sin almacenamiento: se vuelve a enviar la próxima vez, no pasa nada
  }
}

// Activa los avisos apenas se aceptan las notificaciones, sin esperar a la ubicación: en algunas
// compus (Windows con la ubicación apagada) conseguirla tarda o falla. La zona se agrega cuando
// llega, y alTenerZona avisa si se consiguió o no.
export async function activarAvisos(alTenerZona?: (conZona: boolean) => void): Promise<boolean> {
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') return false;
  const registro = await navigator.serviceWorker.ready;
  const suscripcion =
    (await registro.pushManager.getSubscription()) ??
    (await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: llaveAplicacion() }));
  try {
    await registrar(suscripcion.endpoint, null);
  } catch (err) {
    await suscripcion.unsubscribe(); // si el servidor no la guardó, que no quede a medias
    throw err;
  }
  pedirZona().then(async (zona) => {
    if (zona) await registrar(suscripcion.endpoint, zona).catch(() => {});
    alTenerZona?.(zona !== null);
  });
  return true;
}

export async function desactivarAvisos() {
  const suscripcion = await suscripcionActual();
  if (!suscripcion) return;
  await enviar('/baja', { endpoint: suscripcion.endpoint }).catch(() => {});
  await suscripcion.unsubscribe();
}

// Al abrir LECB: si el lector se mudó o está de viaje, actualiza la zona (sin volver a preguntar:
// solo si ya dio permiso de ubicación).
export async function actualizarZona() {
  try {
    const suscripcion = await suscripcionActual();
    if (!suscripcion) return;
    const permiso = await navigator.permissions?.query({ name: 'geolocation' });
    if (permiso?.state !== 'granted') return;
    const zona = await pedirZona();
    if (!zona || localStorage.getItem(CLAVE_ZONA) === JSON.stringify(zona)) return;
    await registrar(suscripcion.endpoint, zona);
  } catch {
    // no es importante: se reintenta la próxima vez
  }
}

// Probar: pide al servidor que mande ya un aviso de este tipo a este dispositivo.
export async function probarAviso(tipo: string) {
  const suscripcion = await suscripcionActual();
  if (!suscripcion) throw new Error('los avisos no están activados');
  return enviar('/prueba', { endpoint: suscripcion.endpoint, tipo });
}

export function invitacionCerrada() {
  try {
    return localStorage.getItem(CLAVE_INVITACION) === 'cerrada';
  } catch {
    return true; // sin almacenamiento no insistimos
  }
}

export function cerrarInvitacion() {
  try {
    localStorage.setItem(CLAVE_INVITACION, 'cerrada');
  } catch {
    // ignorado
  }
}
