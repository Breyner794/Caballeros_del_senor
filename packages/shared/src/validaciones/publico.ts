import { z } from 'zod';
import {
  arrayDeQuery,
  emailOpcionalSchema,
  fechaHoraSchema,
  fechaSchema,
  idSchema,
  telefonoSchema,
  textoOpcional,
  textoRequerido,
} from './comunes.js';

/**
 * Esquemas del canal público (la web de reservas que usa el cliente final).
 *
 * Se declaran campo a campo, a propósito, y nunca derivados de los esquemas
 * del panel con `.omit()`, `.pick()` o `.extend()`. Derivarlos es una lista
 * negra: el día que alguien añada un campo al esquema del panel (un descuento,
 * un estado, un canal), entraría solo en el público sin que nadie lo decidiera.
 * Escrito desde cero es una lista blanca: lo que no está aquí, no entra.
 */

const servicioIdsSchema = z
  .array(idSchema)
  .min(1, 'Elige al menos un servicio')
  .max(6, 'Demasiados servicios en una sola cita');

/**
 * Prueba anti-bots de Cloudflare Turnstile. El token lo emite Turnstile en el navegador
 * y la API lo verifica contra Cloudflare; aquí solo se exige que venga.
 */
const tokenTurnstileSchema = z
  .string({ required_error: 'Falta la verificación anti-bots' })
  .min(1, 'Falta la verificación anti-bots')
  .max(4096, 'Verificación anti-bots no válida');

// ========================== ESCRITURA =======================================

export const crearReservaPublicaSchema = z.object({
  sedeId: idSchema,
  servicioIds: servicioIdsSchema,
  inicioEn: fechaHoraSchema,
  /** Sin barbero, la API asigna uno libre en esa hora. */
  barberoId: idSchema.optional(),
  cliente: z.object({
    nombreCompleto: textoRequerido('El nombre', 160),
    telefono: telefonoSchema,
    email: emailOpcionalSchema.optional(),
  }),
  notaCliente: textoOpcional(500),
  tokenTurnstile: tokenTurnstileSchema,
});
export type CrearReservaPublicaDto = z.infer<typeof crearReservaPublicaSchema>;

export const cancelarReservaPublicaSchema = z.object({
  motivo: textoOpcional(500),
  tokenTurnstile: tokenTurnstileSchema,
});
export type CancelarReservaPublicaDto = z.infer<typeof cancelarReservaPublicaSchema>;

export const reprogramarReservaPublicaSchema = z.object({
  inicioEn: fechaHoraSchema,
  barberoId: idSchema.optional(),
  tokenTurnstile: tokenTurnstileSchema,
});
export type ReprogramarReservaPublicaDto = z.infer<typeof reprogramarReservaPublicaSchema>;

// =========================== CONSULTAS ======================================

/** Las consultas viajan por query string: los servicios llegan como lista. */
const servicioIdsDeQuerySchema = arrayDeQuery(idSchema).pipe(servicioIdsSchema);

export const consultarDisponibilidadPublicaSchema = z.object({
  sedeId: idSchema,
  fecha: fechaSchema,
  servicioIds: servicioIdsDeQuerySchema,
  barberoId: idSchema.optional(),
});
export type ConsultarDisponibilidadPublicaDto = z.infer<typeof consultarDisponibilidadPublicaSchema>;

export const consultarCalendarioPublicoSchema = z
  .object({
    sedeId: idSchema,
    desde: fechaSchema,
    hasta: fechaSchema,
    servicioIds: servicioIdsDeQuerySchema,
  })
  .refine((v) => v.desde <= v.hasta, {
    message: 'El rango de fechas está invertido',
    path: ['hasta'],
  });
export type ConsultarCalendarioPublicoDto = z.infer<typeof consultarCalendarioPublicoSchema>;

// ============================ RESPUESTAS ====================================
// Solo lo que el cliente final puede ver: nada de costos, notas internas,
// teléfonos de otros clientes ni identificadores que no necesite.

export interface SedePublica {
  id: string;
  nombre: string;
  direccion: string | null;
  ciudad: string | null;
  zonaHoraria: string;
}

export interface ServicioPublico {
  id: string;
  nombre: string;
  descripcion: string | null;
  duracionMinutos: number;
  precio: number;
}

export interface BarberoPublico {
  id: string;
  nombre: string;
  alias: string | null;
  fotoUrl: string | null;
}

/** Todo lo que el formulario necesita para arrancar, en una sola petición. */
export interface OpcionesPublicas {
  sedes: SedePublica[];
  servicios: ServicioPublico[];
  barberos: BarberoPublico[];
}

export interface ReservaPublica {
  id: string;
  estado: string;
  inicioEn: string;
  finEn: string;
  sede: SedePublica;
  barbero: BarberoPublico;
  servicios: ServicioPublico[];
  total: number;
  /** Si todavía se puede cancelar o mover, según la antelación mínima. */
  modificable: boolean;
}

export interface HuecoPublico {
  /** Instante ISO del inicio del hueco. */
  inicioEn: string;
  /** "09:30", ya en la zona horaria del negocio. */
  hora: string;
  /** Barberos libres en ese hueco: permite elegir sin exponer la agenda. */
  barberoIds: string[];
}

export interface DiaCalendarioPublico {
  fecha: string;
  /** Hay al menos un hueco libre para los servicios elegidos. */
  disponible: boolean;
}
