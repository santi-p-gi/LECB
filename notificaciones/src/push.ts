// Envío de notificaciones web (Web Push) sin contenido: el aviso solo "despierta" al
// dispositivo, y es LECB (su service worker) la que arma el mensaje con el libro del lector.
// Así no hace falta cifrar nada: lo único que va firmado es la identidad de LECB (VAPID).

const base64url = (datos: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(datos))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const texto64 = (obj: unknown) => base64url(new TextEncoder().encode(JSON.stringify(obj)));

let llaveGuardada: CryptoKey | null = null;

async function firmar(datos: string, privadaJwk: string) {
  llaveGuardada ??= await crypto.subtle.importKey(
    'jwk',
    JSON.parse(privadaJwk),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const firma = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, llaveGuardada, new TextEncoder().encode(datos));
  return base64url(firma);
}

export interface Llaves {
  publica: string; // base64url, formato "raw" (65 bytes)
  privadaJwk: string;
  contacto: string; // mailto:… (lo piden los servicios de notificaciones por si hay un problema)
}

// Devuelve "ok", "vencida" (el lector desactivó los avisos: hay que borrarlo) o "error".
export async function enviarPush(endpoint: string, llaves: Llaves): Promise<'ok' | 'vencida' | 'error'> {
  const aud = new URL(endpoint).origin;
  const cabecera = texto64({ typ: 'JWT', alg: 'ES256' });
  const datos = texto64({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: llaves.contacto });
  const jwt = `${cabecera}.${datos}.${await firmar(`${cabecera}.${datos}`, llaves.privadaJwk)}`;
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${llaves.publica}`,
      TTL: '10800', // si el dispositivo está apagado, el aviso vale 3 horas (el clima cambia)
      Urgency: 'normal',
      'Content-Length': '0',
    },
  });
  if (r.ok) return 'ok';
  if (r.status === 404 || r.status === 410) return 'vencida';
  console.log('push', r.status, await r.text().catch(() => ''));
  return 'error';
}
