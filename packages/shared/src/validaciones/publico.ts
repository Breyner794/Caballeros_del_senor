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
import type { EstadoReserva } from './reservas.js';

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

/** Largo máximo de un token de Turnstile, el documentado por Cloudflare. */
export const MAX_TOKEN_TURNSTILE = 2048;

/**
 * Prueba anti-bots de Cloudflare Turnstile. El token lo emite Turnstile en el navegador
 * y la API lo verifica contra Cloudflare; aquí solo se exige que venga.
 */
const tokenTurnstileSchema = z
  .string({ required_error: 'Falta la verificación anti-bots' })
  .min(1, 'Falta la verificación anti-bots')
  .max(MAX_TOKEN_TURNSTILE, 'Verificación anti-bots no válida');

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
// Solo lo que el cliente final puede ver. La ausencia de un campo es una
// decisión de seguridad, no un olvido: ni el UUID interno de la reserva, ni
// qué barbero está libre en cada hueco, ni el alias frente al nombre real.

export interface SedePublica {
  id: string;
  nombre: string;
  direccion: string | null;
  ciudad: string | null;
  telefono: string | null;
  mapsUrl: string | null;
}

export interface ServicioPublico {
  id: string;
  nombre: string;
  descripcion: string | null;
  incluye: string[];
  precio: number;
  duracionMinutos: number;
}

/**
 * Lo que el cliente reservó, congelado al reservar (`ReservaServicio`). Sin
 * descripción ni «incluye»: no se guardaron entonces y el catálogo de hoy ya
 * no es el de aquel día. Tampoco se une al catálogo vivo: mostraría el precio
 * de hoy en una cita pasada.
 */
export interface ServicioReservado {
  /**
   * El id del servicio del catálogo. No es un dato nuevo que ocultar: ya viaja en
   * `/publico/opciones` y el cliente lo mandó al reservar. Hace falta para
   * reprogramar: la agenda se calcula por ids, y emparejar por nombre se rompe
   * en cuanto se renombra un servicio.
   */
  servicioId: string;
  nombre: string;
  precio: number;
  duracionMinutos: number;
}

export interface BarberoPublico {
  id: string;
  /** Ya resuelto como `alias ?? nombre`: el nombre real no sale si hay alias. */
  nombre: string;
  bio: string | null;
  fotoUrl: string | null;
}

export interface HuecoPublico {
  /** Instante ISO del inicio del hueco. */
  inicioEn: string;
  /** "09:30", ya en la zona horaria del negocio. */
  hora: string;
  disponible: boolean;
  /**
   * Solo los motivos que el cliente puede conocer. Los internos (OCUPADO,
   * ALMUERZO, DESCANSO) no son representables a propósito: el tipo impide
   * la fuga, no solo la convención. La unión de huecos no dice de quién es cada uno.
   */
  motivo?: 'ANTELACION' | 'NO_CABE';
}

export interface DiaCalendarioPublico {
  fecha: string;
  hayHueco: boolean;
}

/** El cliente identifica su cita por `codigo` (CDS-7F3K2M); el UUID no sale del panel. */
export interface ReservaPublica {
  codigo: string;
  estado: EstadoReserva;
  inicioEn: string;
  finEn: string;
  sede: SedePublica;
  barbero: BarberoPublico;
  servicios: ServicioReservado[];
  total: number;
}

/** Cancelar y reprogramar dependen de dos límites distintos de la configuración. */
export type MiReservaPublica = ReservaPublica & {
  puedeCancelar: boolean;
  puedeReprogramar: boolean;
};

export interface ConfigPublica {
  permiteElegirBarbero: boolean;
  maxDiasAnticipacion: number;
  minAntelacionMinutos: number;
  zonaHoraria: string;
  moneda: string;
  nombreNegocio: string;
}

export type SedeConBarberos = SedePublica & { barberos: BarberoPublico[] };

/** Todo lo que el formulario necesita para arrancar, en una sola petición. */
export interface OpcionesPublicas {
  sedes: SedeConBarberos[];
  servicios: ServicioPublico[];
  config: ConfigPublica;
}
