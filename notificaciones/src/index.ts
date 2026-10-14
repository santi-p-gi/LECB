// Servidor de avisos de LECB.
//
// Lo que guarda: por cada dispositivo que aceptó los avisos, una dirección anónima de
// notificación, la zona horaria y (si el lector la compartió) una zona aproximada.
// Nunca recibe nombres, mails ni nada sobre los libros.
//
// Cada hora se fija a quién le toca (las 12 o las 18 en su hora local) y, si en su zona hay
// un momento lindo para leer (lluvia, sol, frío, calor), le manda un aviso. Máximo uno por semana.
import { clasificar, pronostico, type Pronostico, type Tipo } from './clima';
import { enviarPush, type Llaves } from './push';

interface Env {
  DB: D1Database;
  VAPID_PUBLICA: string;
  VAPID_PRIVADA: string; // secreto (JWK)
  VAPID_CONTACTO: string;
}

interface Suscripcion {
  endpoint: string;
  lat: number | null;
  lon: number | null;
  zona_horaria: string;
  creado: number;
  ultimo_envio: number | null;
  ultimo_tipo: string | null;
}

const DIA = 24 * 3600 * 1000;
const ENTRE_AVISOS = 6.5 * DIA; // uno por semana, como mucho
const SIN_CLIMA_HACE = 14 * DIA; // si en dos semanas no hubo un clima especial, va una genérica

const ORIGENES = /^(https:\/\/lecb\.ar|https:\/\/www\.lecb\.ar|http:\/\/localhost(:\d+)?)$/;
// Solo direcciones de los servicios de notificaciones de los navegadores.
const SERVICIOS_PUSH = /(^|\.)(fcm\.googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/;

const llaves = (env: Env): Llaves => ({ publica: env.VAPID_PUBLICA, privadaJwk: env.VAPID_PRIVADA, contacto: env.VAPID_CONTACTO });

/* ---------- pedidos desde LECB ---------- */

function respuesta(datos: unknown, origen: string | null, estado = 200) {
  return new Response(JSON.stringify(datos), {
    status: estado,
    headers: {
      'Content-Type': 'application/json',
      ...(origen && ORIGENES.test(origen) ? { 'Access-Control-Allow-Origin': origen, Vary: 'Origin' } : {}),
    },
  });
}

function endpointValido(e: unknown): e is string {
  if (typeof e !== 'string' || e.length > 1000) return false;
  try {
    const u = new URL(e);
    return u.protocol === 'https:' && SERVICIOS_PUSH.test(u.hostname);
  } catch {
    return false;
  }
}

function zonaHorariaValida(z: unknown): z is string {
  if (typeof z !== 'string' || z.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: z });
    return true;
  } catch {
    return false;
  }
}

// Redondeo a un decimal (unos 10 km): la zona, no el lugar exacto.
const redondear = (v: unknown, max: number) =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max ? Math.round(v * 10) / 10 : null;

async function atender(pedido: Request, env: Env): Promise<Response> {
  const origen = pedido.headers.get('Origin');
  const url = new URL(pedido.url);
  if (pedido.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        ...(origen && ORIGENES.test(origen) ? { 'Access-Control-Allow-Origin': origen, Vary: 'Origin' } : {}),
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }
  if (pedido.method === 'GET' && url.pathname === '/') {
    return new Response('Avisos de LECB (https://lecb.ar). Acá no hay nada para ver.', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  if (pedido.method !== 'POST') return respuesta({ error: 'método no permitido' }, origen, 405);

  let datos: Record<string, unknown>;
  try {
    datos = await pedido.json();
  } catch {
    return respuesta({ error: 'pedido inválido' }, origen, 400);
  }
  const endpoint = datos.endpoint;
  if (!endpointValido(endpoint)) return respuesta({ error: 'dirección de notificación inválida' }, origen, 400);

  switch (url.pathname) {
    // Alta o actualización (también cuando el lector cambia de zona).
    case '/suscribir': {
      const zona = datos.zona as { lat?: unknown; lon?: unknown } | null | undefined;
      const lat = redondear(zona?.lat, 90), lon = redondear(zona?.lon, 180);
      if (!zonaHorariaValida(datos.zonaHoraria)) return respuesta({ error: 'zona horaria inválida' }, origen, 400);
      await env.DB.prepare(
        `INSERT INTO suscripciones (endpoint, lat, lon, zona_horaria, creado) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(endpoint) DO UPDATE SET lat = ?2, lon = ?3, zona_horaria = ?4`,
      ).bind(endpoint, lat === null || lon === null ? null : lat, lat === null || lon === null ? null : lon, datos.zonaHoraria, Date.now()).run();
      return respuesta({ ok: true }, origen);
    }
    case '/baja': {
      await env.DB.prepare('DELETE FROM suscripciones WHERE endpoint = ?1').bind(endpoint).run();
      return respuesta({ ok: true }, origen);
    }
    // El service worker pregunta qué aviso le mandamos (el aviso llega vacío).
    case '/ultimo': {
      const fila = await env.DB.prepare('SELECT ultimo_tipo, ultimo_envio FROM suscripciones WHERE endpoint = ?1')
        .bind(endpoint).first<{ ultimo_tipo: string | null; ultimo_envio: number | null }>();
      return respuesta({ tipo: fila?.ultimo_tipo ?? 'generica' }, origen);
    }
    // Probar: manda ya un aviso del tipo pedido al dispositivo que lo pide (solo a sí mismo).
    case '/prueba': {
      const tipo = ['lluvia', 'sol', 'frio', 'calor', 'generica'].includes(datos.tipo as string) ? (datos.tipo as string) : 'lluvia';
      const existe = await env.DB.prepare('UPDATE suscripciones SET ultimo_tipo = ?2 WHERE endpoint = ?1').bind(endpoint, tipo).run();
      if (!existe.meta.changes) return respuesta({ error: 'no está suscripto' }, origen, 404);
      const resultado = await enviarPush(endpoint, llaves(env));
      return respuesta({ resultado }, origen);
    }
  }
  return respuesta({ error: 'no encontrado' }, origen, 404);
}

/* ---------- cada hora: ¿a quién avisar? ---------- */

function horaLocal(zonaHoraria: string, ahora: Date) {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: zonaHoraria, hour: 'numeric', hourCycle: 'h23', weekday: 'short' })
    .formatToParts(ahora);
  const hora = Number(partes.find((p) => p.type === 'hour')?.value);
  const dia = partes.find((p) => p.type === 'weekday')?.value ?? '';
  return { hora, finDeSemana: dia === 'Sat' || dia === 'Sun', domingo: dia === 'Sun' };
}

export async function revisar(env: Env, ahora = new Date()) {
  const { results } = await env.DB.prepare('SELECT * FROM suscripciones').all<Suscripcion>();
  const pronosticos = new Map<string, Promise<Pronostico | null>>(); // uno por zona
  let enviados = 0, borrados = 0;

  for (const s of results) {
    const { hora, finDeSemana, domingo } = horaLocal(s.zona_horaria, ahora);
    if (hora !== 12 && hora !== 18) continue;
    const desde = ahora.getTime() - (s.ultimo_envio ?? s.creado);
    if (desde < ENTRE_AVISOS && s.ultimo_envio !== null) continue;
    if (s.ultimo_envio === null && ahora.getTime() - s.creado < DIA / 2) continue; // recién suscripto: que espere un poco

    let tipo: Tipo | 'generica' | null = null;
    if (s.lat !== null && s.lon !== null) {
      const clave = `${s.lat},${s.lon}`;
      if (!pronosticos.has(clave)) pronosticos.set(clave, pronostico(s.lat, s.lon).catch(() => null));
      const p = await pronosticos.get(clave)!;
      if (p) tipo = clasificar(p, hora, finDeSemana);
      // Si en dos semanas no hubo ningún clima especial, el domingo a la tarde va una genérica.
      if (!tipo && domingo && hora === 18 && desde >= SIN_CLIMA_HACE) tipo = 'generica';
    } else if (domingo && hora === 18) {
      tipo = 'generica'; // sin ubicación: una genérica por semana, el domingo a la tarde
    }
    if (!tipo) continue;

    const resultado = await enviarPush(s.endpoint, llaves(env));
    if (resultado === 'ok') {
      await env.DB.prepare('UPDATE suscripciones SET ultimo_envio = ?2, ultimo_tipo = ?3 WHERE endpoint = ?1')
        .bind(s.endpoint, ahora.getTime(), tipo).run();
      enviados++;
    } else if (resultado === 'vencida') {
      await env.DB.prepare('DELETE FROM suscripciones WHERE endpoint = ?1').bind(s.endpoint).run();
      borrados++;
    }
  }
  console.log(`revisión: ${results.length} suscripciones, ${enviados} avisos, ${borrados} vencidas`);
}

export default {
  fetch: (pedido: Request, env: Env) =>
    atender(pedido, env).catch((err) => {
      console.error(err);
      return respuesta({ error: 'error interno' }, pedido.headers.get('Origin'), 500);
    }),
  scheduled: (_evento: ScheduledController, env: Env, ctx: ExecutionContext) => ctx.waitUntil(revisar(env)),
} satisfies ExportedHandler<Env>;
