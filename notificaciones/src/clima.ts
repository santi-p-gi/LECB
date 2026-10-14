// El clima de una zona (Open-Meteo, gratis y sin registro) y las reglas que deciden si es un
// "momento lindo para leer".

export type Tipo = 'lluvia' | 'sol' | 'frio' | 'calor';

export interface Pronostico {
  utc_offset_seconds: number;
  hourly: {
    time: string[]; // hora local, "2026-10-14T13:00" (ayer y hoy)
    temperature_2m: number[];
    precipitation_probability: (number | null)[];
    precipitation: number[];
    cloud_cover: number[];
  };
  daily: {
    time: string[]; // [ayer, hoy]
    temperature_2m_max: number[];
    precipitation_sum: number[];
  };
}

export async function pronostico(lat: number, lon: number): Promise<Pronostico> {
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${lat}&longitude=${lon}` +
    '&hourly=temperature_2m,precipitation_probability,precipitation,cloud_cover' +
    '&daily=temperature_2m_max,precipitation_sum' +
    '&past_days=1&forecast_days=1&timezone=auto';
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Open-Meteo respondió ${r.status}`);
  return r.json();
}

const promedio = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);

// hora: hora local en que se avisaría (12 o 18). finDeSemana: sábado o domingo en la zona.
// Se mira el rato que viene (de esa hora hasta 6 horas después) y el día de hoy.
export function clasificar(p: Pronostico, hora: number, finDeSemana: boolean): Tipo | null {
  const h = p.hourly;
  const hoy = p.daily.time[p.daily.time.length - 1];
  const ayer = p.daily.time[0];
  const indices = (dia: string, desde: number, hasta: number) =>
    h.time.map((t, i) => ({ t, i })).filter(({ t }) => {
      const hh = Number(t.slice(11, 13));
      return t.startsWith(dia) && hh >= desde && hh <= hasta;
    }).map(({ i }) => i);

  const rato = indices(hoy, hora, Math.min(hora + 6, 22));
  const maxHoy = p.daily.temperature_2m_max[p.daily.time.length - 1];
  const horasConLluvia = rato.filter((i) => (h.precipitation_probability[i] ?? 0) >= 60 && h.precipitation[i] >= 0.3).length;

  // 🌧️ Lluvia: al menos dos horas de lluvia probable en el rato que viene.
  if (horasConLluvia >= 2) return 'lluvia';
  // 🥶 Frío: la máxima de hoy no pasa los 10 °C.
  if (maxHoy <= 10) return 'frio';
  // 🔥 Calor: 32 °C o más (solo al mediodía: a la tarde ya es tarde para "buscar la sombra").
  if (hora === 12 && maxHoy >= 32) return 'calor';
  // ☀️ Sol: tarde despejada y agradable, sin lluvia. Para que sea especial: fin de semana,
  // o el primer día lindo después de un día feo.
  if (hora === 12 && horasConLluvia === 0 && maxHoy >= 15 && maxHoy <= 30) {
    const nubesHoy = promedio(rato.map((i) => h.cloud_cover[i]));
    const nubesAyer = promedio(indices(ayer, 10, 18).map((i) => h.cloud_cover[i]));
    const ayerFeo = nubesAyer >= 60 || p.daily.precipitation_sum[0] >= 1;
    if (nubesHoy <= 25 && (finDeSemana || ayerFeo)) return 'sol';
  }
  return null;
}
