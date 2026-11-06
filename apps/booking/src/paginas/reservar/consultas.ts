import type { DiaCalendarioPublico, HuecoPublico, OpcionesPublicas } from '@cds/shared';
import { peticion } from '@/lib/api';

/**
 * Consultas de solo lectura del canal público, con las claves de caché.
 *
 * Viven aquí, y no dentro de cada pantalla, porque quien reprograma una cita
 * pide exactamente lo mismo que quien reserva, y quien maneja un error de
 * reserva necesita escribir en la caché de la rejilla con la misma clave que
 * ella lee.
 */

export interface RespuestaDisponibilidad {
  fecha: string;
  laborable: boolean;
  huecos: HuecoPublico[];
}

export const claveOpciones = ['publico', 'opciones'] as const;

export function pedirOpciones(): Promise<OpcionesPublicas> {
  return peticion<OpcionesPublicas>('/publico/opciones');
}

/** Los ids se ordenan: elegir en otro orden los mismos servicios es la misma consulta. */
const ordenados = (ids: string[]) => [...ids].sort();

function consulta(parametros: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const [clave, valor] of Object.entries(parametros)) {
    if (valor === undefined) continue;
    for (const v of Array.isArray(valor) ? valor : [valor]) query.append(clave, v);
  }
  return query.toString();
}

export interface ParametrosCalendario {
  sedeId: string;
  servicioIds: string[];
  desde: string;
  hasta: string;
}

export const claveCalendario = (p: ParametrosCalendario) =>
  ['publico', 'calendario', p.sedeId, ordenados(p.servicioIds), p.desde, p.hasta] as const;

export function pedirCalendario(p: ParametrosCalendario): Promise<DiaCalendarioPublico[]> {
  return peticion<DiaCalendarioPublico[]>(
    `/publico/calendario?${consulta({
      sedeId: p.sedeId,
      desde: p.desde,
      hasta: p.hasta,
      servicioIds: ordenados(p.servicioIds),
    })}`,
  );
}

export interface ParametrosDisponibilidad {
  sedeId: string;
  fecha: string;
  servicioIds: string[];
  /** `null` o ausente: la unión de los huecos de toda la sede. */
  barberoId?: string | null;
}

export const claveDisponibilidad = (p: ParametrosDisponibilidad) =>
  ['publico', 'disponibilidad', p.sedeId, p.fecha, ordenados(p.servicioIds), p.barberoId ?? null] as const;

export function pedirDisponibilidad(p: ParametrosDisponibilidad): Promise<RespuestaDisponibilidad> {
  return peticion<RespuestaDisponibilidad>(
    `/publico/disponibilidad?${consulta({
      sedeId: p.sedeId,
      fecha: p.fecha,
      servicioIds: ordenados(p.servicioIds),
      barberoId: p.barberoId ?? undefined,
    })}`,
  );
}
