import { fromZonedTime, toZonedTime, formatInTimeZone } from 'date-fns-tz';
import { addDays, differenceInCalendarDays, startOfDay } from 'date-fns';

/**
 * Conversión entre el calendario del negocio y los instantes que se guardan.
 *
 * El sistema tiene dos formas de hablar del tiempo y conviene no mezclarlas:
 *
 *  · El **calendario local**: "el martes 14 de octubre a las 9:30". Es lo que
 *    usa la barbería, lo que ve el cliente y lo que guardan las plantillas de
 *    agenda (como fecha `YYYY-MM-DD` + minutos desde medianoche).
 *  · El **instante**: un punto exacto en la línea del tiempo, en UTC. Es lo que
 *    se guarda en `Reserva.inicioEn` y lo único con lo que se puede comparar
 *    si dos citas se solapan.
 *
 * Todas las conversiones pasan por aquí. El motivo es que Colombia no tiene
 * horario de verano hoy, pero el código no debe asumirlo: si algún día el
 * negocio abre en otro país, o cambia la legislación, solo este archivo tiene
 * que entenderlo. Hacer `new Date(fecha + 'T09:30:00')` repartido por veinte
 * servicios es la forma garantizada de que las citas se desplacen una hora.
 */

/** Minutos que tiene un dia. */
const MINUTOS_DIA = 1440;

/**
 * "2026-10-14" + 570 minutos → instante UTC exacto de las 9:30 en esa zona.
 *
 * Acepta 1440 (y más) y lo resuelve pasando al día siguiente. Importa porque
 * el final de una jornada se expresa como "minuto 1440 del día", y escribir
 * `T24:00:00` produce una fecha inválida que luego envenena silenciosamente
 * cualquier filtro que la use.
 */
export function aInstante(fechaLocal: string, minutosDelDia: number, zona: string): Date {
  const diasExtra = Math.floor(minutosDelDia / MINUTOS_DIA);
  const restante = minutosDelDia - diasExtra * MINUTOS_DIA;

  const fechaBase =
    diasExtra === 0
      ? fechaLocal
      : addDays(new Date(`${fechaLocal}T00:00:00Z`), diasExtra).toISOString().slice(0, 10);

  const horas = Math.floor(restante / 60);
  const minutos = restante % 60;
  const textoLocal = `${fechaBase}T${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}:00`;

  return fromZonedTime(textoLocal, zona);
}

/** Instante → "2026-10-14" según el calendario del negocio. */
export function aFechaLocal(instante: Date, zona: string): string {
  return formatInTimeZone(instante, zona, 'yyyy-MM-dd');
}

/** Instante → minutos desde medianoche local (570 para las 9:30). */
export function aMinutosDelDia(instante: Date, zona: string): number {
  const local = toZonedTime(instante, zona);
  return local.getHours() * 60 + local.getMinutes();
}

/** Instante → "09:30" en hora del negocio. */
export function aHoraLocal(instante: Date, zona: string): string {
  return formatInTimeZone(instante, zona, 'HH:mm');
}

/** Día de la semana local: 0 = domingo … 6 = sábado. */
export function diaSemanaLocal(fechaLocal: string, zona: string): number {
  return toZonedTime(aInstante(fechaLocal, 12 * 60, zona), zona).getDay();
}

/** La fecha de hoy según el calendario del negocio. */
export function hoyLocal(zona: string): string {
  return formatInTimeZone(new Date(), zona, 'yyyy-MM-dd');
}

/** Para guardar en una columna `@db.Date`: medianoche UTC de esa fecha. */
export function aFechaPura(fechaLocal: string): Date {
  return new Date(`${fechaLocal}T00:00:00.000Z`);
}

/** Inverso de `aFechaPura`: columna `@db.Date` → "2026-10-14". */
export function deFechaPura(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/** Todas las fechas locales entre dos extremos, ambos incluidos. */
export function rangoDeFechas(desde: string, hasta: string, maximo = 120): string[] {
  const inicio = new Date(`${desde}T00:00:00Z`);
  const fin = new Date(`${hasta}T00:00:00Z`);
  const total = Math.min(differenceInCalendarDays(fin, inicio), maximo - 1);
  const fechas: string[] = [];
  for (let i = 0; i <= total; i++) {
    fechas.push(addDays(inicio, i).toISOString().slice(0, 10));
  }
  return fechas;
}

/** Fecha legible para mensajes y notificaciones: "martes 14 de octubre, 9:30 a. m." */
export function fechaLegible(instante: Date, zona: string): string {
  const texto = new Intl.DateTimeFormat('es-CO', {
    timeZone: zona,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(instante);
  return texto;
}

/** Límites del día local, como instantes: útil para filtrar reservas de un día. */
export function limitesDelDia(fechaLocal: string, zona: string): { inicio: Date; fin: Date } {
  return {
    inicio: aInstante(fechaLocal, 0, zona),
    fin: aInstante(fechaLocal, 24 * 60, zona),
  };
}

/** Límites de un rango de días locales, como instantes. */
export function limitesDelRango(
  desdeLocal: string,
  hastaLocal: string,
  zona: string,
): { inicio: Date; fin: Date } {
  return {
    inicio: aInstante(desdeLocal, 0, zona),
    fin: aInstante(hastaLocal, 24 * 60, zona),
  };
}

export { startOfDay };
