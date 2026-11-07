/**
 * Formato de precios, duraciones y fechas para el cliente.
 *
 * Las fechas de calendario viajan como `YYYY-MM-DD` en la zona horaria del
 * negocio. Para operar con ellas (sumar días, escribirlas) se anclan a las
 * 12:00 UTC: así ningún desfase de zona horaria puede moverlas de día.
 */

const LOCALE = 'es-CO';

export function formatearPrecio(valor: number, moneda = 'COP'): string {
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: moneda,
    maximumFractionDigits: 0,
  }).format(valor);
}

export function formatearDuracion(minutos: number): string {
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (horas === 0) return `${resto} min`;
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
}

/** La fecha de hoy (`YYYY-MM-DD`) tal como la vive el negocio, no el navegador. */
export function fechaDeHoy(zonaHoraria: string, ahora: Date = new Date()): string {
  // El locale `en-CA` formatea justo como `YYYY-MM-DD`.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zonaHoraria,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora);
}

function anclar(fecha: string): Date {
  return new Date(`${fecha}T12:00:00Z`);
}

export function sumarDias(fecha: string, dias: number): string {
  const resultado = anclar(fecha);
  resultado.setUTCDate(resultado.getUTCDate() + dias);
  return resultado.toISOString().slice(0, 10);
}

/** «viernes, 6 de noviembre» */
export function etiquetaFecha(fecha: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(anclar(fecha));
}

/** «noviembre de 2026» */
export function etiquetaMes(fecha: string): string {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(
    anclar(fecha),
  );
}

/** «viernes, 6 de noviembre · 9:30 a. m.» de un instante ISO, en la zona del negocio. */
export function etiquetaFechaHora(iso: string, zonaHoraria: string): string {
  const instante = new Date(iso);
  const dia = new Intl.DateTimeFormat(LOCALE, {
    timeZone: zonaHoraria,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(instante);
  const hora = new Intl.DateTimeFormat(LOCALE, {
    timeZone: zonaHoraria,
    hour: 'numeric',
    minute: '2-digit',
  }).format(instante);
  return `${dia} · ${hora}`;
}

/** «09:30» → «9:30 a. m.» (la hora ya viene en la zona del negocio). */
export function etiquetaHora(hora: string): string {
  const [h, m] = hora.split(':').map(Number);
  const sufijo = h < 12 ? 'a. m.' : 'p. m.';
  const hora12 = h % 12 === 0 ? 12 : h % 12;
  return `${hora12}:${String(m).padStart(2, '0')} ${sufijo}`;
}
