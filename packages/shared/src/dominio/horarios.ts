/**
 * Utilidades de horario compartidas entre API y frontend.
 *
 * Decisión clave: las plantillas semanales (agenda del barbero, horario de la
 * sede) guardan "minutos desde medianoche" en lugar de una hora con fecha.
 * Un `Date` obliga a inventar un día concreto y arrastra la zona horaria a
 * sitios donde no aporta nada: "el martes trabajo de 8 a 20" no depende de
 * ninguna fecha. La conversión a instantes reales ocurre solo al proyectar la
 * plantilla sobre un día concreto, y eso lo hace la API con la zona horaria
 * del negocio.
 */

export const MINUTOS_POR_DIA = 1440;

export const DIAS_SEMANA = [
  { valor: 0, nombre: 'Domingo', corto: 'Dom' },
  { valor: 1, nombre: 'Lunes', corto: 'Lun' },
  { valor: 2, nombre: 'Martes', corto: 'Mar' },
  { valor: 3, nombre: 'Miércoles', corto: 'Mié' },
  { valor: 4, nombre: 'Jueves', corto: 'Jue' },
  { valor: 5, nombre: 'Viernes', corto: 'Vie' },
  { valor: 6, nombre: 'Sábado', corto: 'Sáb' },
] as const;

export type DiaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export function nombreDia(dia: number): string {
  return DIAS_SEMANA[dia]?.nombre ?? '—';
}

/** 510 → "08:30" */
export function minutosAHora(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 510 → "8:30 a. m." (para mostrar al cliente) */
export function minutosAHora12(minutos: number): string {
  const h24 = Math.floor(minutos / 60);
  const m = minutos % 60;
  const sufijo = h24 < 12 ? 'a. m.' : 'p. m.';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${sufijo}`;
}

/** "08:30" → 510. Devuelve null si el formato no es válido. */
export function horaAMinutos(hora: string): number | null {
  const coincidencia = /^(\d{1,2}):(\d{2})$/.exec(hora.trim());
  if (!coincidencia) return null;
  const h = Number(coincidencia[1]);
  const m = Number(coincidencia[2]);
  if (h < 0 || h > 24 || m < 0 || m > 59) return null;
  const total = h * 60 + m;
  return total > MINUTOS_POR_DIA ? null : total;
}

export interface RangoMinutos {
  horaInicio: number;
  horaFin: number;
}

/** Dos rangos se solapan si comparten al menos un minuto. */
export function seSolapan(a: RangoMinutos, b: RangoMinutos): boolean {
  return a.horaInicio < b.horaFin && b.horaInicio < a.horaFin;
}

/** El rango `interior` cabe completamente dentro de `exterior`. */
export function contiene(exterior: RangoMinutos, interior: RangoMinutos): boolean {
  return interior.horaInicio >= exterior.horaInicio && interior.horaFin <= exterior.horaFin;
}

/**
 * Resta los bloques (almuerzo, descansos) de la jornada y devuelve los tramos
 * en los que el barbero realmente atiende.
 */
export function restarBloques(
  jornada: RangoMinutos,
  bloques: readonly RangoMinutos[],
): RangoMinutos[] {
  const ordenados = [...bloques]
    .filter((b) => seSolapan(jornada, b))
    .sort((a, b) => a.horaInicio - b.horaInicio);

  const tramos: RangoMinutos[] = [];
  let cursor = jornada.horaInicio;

  for (const bloque of ordenados) {
    if (bloque.horaInicio > cursor) {
      tramos.push({ horaInicio: cursor, horaFin: Math.min(bloque.horaInicio, jornada.horaFin) });
    }
    cursor = Math.max(cursor, bloque.horaFin);
    if (cursor >= jornada.horaFin) break;
  }

  if (cursor < jornada.horaFin) {
    tramos.push({ horaInicio: cursor, horaFin: jornada.horaFin });
  }

  return tramos.filter((t) => t.horaFin > t.horaInicio);
}

/**
 * Genera los puntos de inicio candidatos dentro de un tramo.
 *
 * `paso` es el slot configurado (20, 30, 45 min…) y `duracionNecesaria` es lo
 * que dura el servicio con su buffer. Solo se ofrece un inicio si el servicio
 * completo cabe antes de que acabe el tramo: así nunca se ofrece una cita que
 * termine después del cierre o dentro del almuerzo.
 */
export function generarInicios(
  tramo: RangoMinutos,
  paso: number,
  duracionNecesaria: number,
): number[] {
  if (paso <= 0 || duracionNecesaria <= 0) return [];
  const inicios: number[] = [];
  for (let t = tramo.horaInicio; t + duracionNecesaria <= tramo.horaFin; t += paso) {
    inicios.push(t);
  }
  return inicios;
}

/** Redondea hacia arriba al siguiente múltiplo del slot (para walk-ins). */
export function siguienteSlot(minutos: number, paso: number): number {
  if (paso <= 0) return minutos;
  return Math.ceil(minutos / paso) * paso;
}
