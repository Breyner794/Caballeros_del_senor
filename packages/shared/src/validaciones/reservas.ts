import { z } from 'zod';
import {
  dineroSchema,
  fechaSchema,
  fechaHoraSchema,
  idSchema,
  paginacionSchema,
  telefonoSchema,
  textoOpcional,
  textoRequerido,
} from './comunes.js';

export const ESTADOS_RESERVA = [
  'PENDIENTE',
  'CONFIRMADA',
  'EN_CURSO',
  'COMPLETADA',
  'CANCELADA',
  'NO_ASISTIO',
] as const;
export type EstadoReserva = (typeof ESTADOS_RESERVA)[number];

export const CANALES_RESERVA = ['PANEL', 'WEB', 'WALK_IN'] as const;

export const METODOS_PAGO = [
  'EFECTIVO',
  'TARJETA',
  'TRANSFERENCIA',
  'NEQUI',
  'DAVIPLATA',
  'OTRO',
  'CORTESIA',
] as const;

/** Estados que ocupan la silla y por tanto bloquean el horario. */
export const ESTADOS_QUE_OCUPAN: readonly EstadoReserva[] = [
  'PENDIENTE',
  'CONFIRMADA',
  'EN_CURSO',
];

/** Transiciones permitidas. Cualquier otro salto se rechaza. */
export const TRANSICIONES_RESERVA: Record<EstadoReserva, readonly EstadoReserva[]> = {
  PENDIENTE: ['CONFIRMADA', 'CANCELADA', 'NO_ASISTIO'],
  CONFIRMADA: ['EN_CURSO', 'COMPLETADA', 'CANCELADA', 'NO_ASISTIO'],
  EN_CURSO: ['COMPLETADA', 'CANCELADA'],
  COMPLETADA: [],
  CANCELADA: [],
  NO_ASISTIO: [],
};

export function puedeTransicionar(desde: EstadoReserva, hasta: EstadoReserva): boolean {
  return TRANSICIONES_RESERVA[desde].includes(hasta);
}

export const ETIQUETAS_ESTADO: Record<EstadoReserva, string> = {
  PENDIENTE: 'Pendiente',
  CONFIRMADA: 'Confirmada',
  EN_CURSO: 'En curso',
  COMPLETADA: 'Completada',
  CANCELADA: 'Cancelada',
  NO_ASISTIO: 'No asistió',
};

// ========================== CREAR RESERVA ===================================

/**
 * El cliente de una reserva puede llegar de tres maneras, y el formulario del
 * panel refleja exactamente eso:
 *
 *  1. `clienteId` — se buscó y se encontró una ficha existente.
 *  2. `clienteNuevo` — no existía: se crea al vuelo sin salir del formulario.
 *  3. ninguno de los dos — walk-in que no quiso dar sus datos: la reserva se
 *     guarda contra el cliente genérico "Consumidor final". La decisión es del
 *     barbero, y por eso queda registrada en la auditoría: si luego el cliente
 *     reclama sus cortes acumulados, se puede ver quién no lo registró.
 */
export const clienteNuevoEnReservaSchema = z.object({
  nombreCompleto: textoRequerido('El nombre del cliente', 160),
  telefono: telefonoSchema,
  notas: textoOpcional(2000),
});

const baseReservaSchema = z.object({
  sedeId: idSchema,
  barberoId: idSchema,
  clienteId: idSchema.optional(),
  clienteNuevo: clienteNuevoEnReservaSchema.optional(),
  /** Al menos un servicio: define el precio y, sobre todo, la duración. */
  servicioIds: z
    .array(idSchema)
    .min(1, 'Elige al menos un servicio')
    .max(6, 'Demasiados servicios en una sola cita'),
  notaCliente: textoOpcional(2000),
  notaInterna: textoOpcional(2000),
  descuento: dineroSchema.default(0),
  /** Aplicar el premio de fidelidad del cliente en esta cita. */
  aplicarPremioFidelidad: z.boolean().default(false),
});

export const crearReservaSchema = baseReservaSchema
  .extend({
    inicioEn: fechaHoraSchema,
    confirmar: z.boolean().default(true),
  })
  .refine((v) => !(v.clienteId && v.clienteNuevo), {
    message: 'Elige un cliente existente o crea uno nuevo, no las dos cosas',
    path: ['clienteNuevo'],
  });
export type CrearReservaDto = z.infer<typeof crearReservaSchema>;

/**
 * Walk-in: el cliente ya está en la silla, así que no se pide hora. La API
 * coloca la cita en el siguiente hueco libre del barbero y le asigna número de
 * turno del día. `inicioEn` solo se envía si la recepción quiere forzar una
 * hora concreta.
 */
export const crearWalkInSchema = baseReservaSchema
  .extend({
    inicioEn: fechaHoraSchema.optional(),
    /** Completar y cobrar en el mismo paso (lo habitual en un walk-in). */
    completarYCobrar: z.boolean().default(false),
    metodoPago: z.enum(METODOS_PAGO).default('EFECTIVO'),
  })
  .refine((v) => !(v.clienteId && v.clienteNuevo), {
    message: 'Elige un cliente existente o crea uno nuevo, no las dos cosas',
    path: ['clienteNuevo'],
  });
export type CrearWalkInDto = z.infer<typeof crearWalkInSchema>;

export const actualizarReservaSchema = z.object({
  /** Permite mover la cita de sede: el caso del barbero que cambió de local. */
  sedeId: idSchema.optional(),
  barberoId: idSchema.optional(),
  inicioEn: fechaHoraSchema.optional(),
  servicioIds: z.array(idSchema).min(1).max(6).optional(),
  notaCliente: textoOpcional(2000),
  notaInterna: textoOpcional(2000),
  descuento: dineroSchema.optional(),
});
export type ActualizarReservaDto = z.infer<typeof actualizarReservaSchema>;

export const reprogramarReservaSchema = z.object({
  inicioEn: fechaHoraSchema,
  barberoId: idSchema.optional(),
  sedeId: idSchema.optional(),
  motivo: textoOpcional(500),
  /** Avisar al cliente por WhatsApp del cambio. */
  notificar: z.boolean().default(true),
});
export type ReprogramarReservaDto = z.infer<typeof reprogramarReservaSchema>;

export const cancelarReservaSchema = z.object({
  motivo: textoOpcional(500),
  notificar: z.boolean().default(true),
});

export const completarReservaSchema = z.object({
  metodoPago: z.enum(METODOS_PAGO).default('EFECTIVO'),
  descuento: dineroSchema.optional(),
  /** Productos vendidos junto al servicio (pomada, cera…). */
  productos: z
    .array(
      z.object({
        productoId: idSchema,
        cantidad: z.coerce.number().int().min(1).max(999),
        precioUnitario: dineroSchema.optional(),
      }),
    )
    .max(30)
    .default([]),
  aplicarPremioFidelidad: z.boolean().default(false),
  notas: textoOpcional(1000),
});
export type CompletarReservaDto = z.infer<typeof completarReservaSchema>;

export const listarReservasSchema = paginacionSchema.extend({
  sedeId: idSchema.optional(),
  barberoId: idSchema.optional(),
  clienteId: idSchema.optional(),
  estado: z.enum(ESTADOS_RESERVA).optional(),
  estados: z.array(z.enum(ESTADOS_RESERVA)).optional(),
  canal: z.enum(CANALES_RESERVA).optional(),
  desde: fechaSchema.optional(),
  hasta: fechaSchema.optional(),
  /** Solo las de hoy: es la vista por defecto del panel. */
  soloHoy: z.coerce.boolean().optional(),
});

// ======================= DISPONIBILIDAD =====================================

/** Huecos libres de un barbero para un día, ya descontando citas y bloques. */
export const consultarDisponibilidadSchema = z.object({
  sedeId: idSchema,
  /** Si se omite, devuelve la disponibilidad de todos los barberos de la sede. */
  barberoId: idSchema.optional(),
  fecha: fechaSchema,
  /** Para calcular si el servicio completo cabe en el hueco. */
  servicioIds: z.array(idSchema).max(6).default([]),
  /** Al reprogramar, ignora la propia reserva para no chocar consigo misma. */
  excluirReservaId: idSchema.optional(),
});
export type ConsultarDisponibilidadDto = z.infer<typeof consultarDisponibilidadSchema>;

/** Vista de calendario: ocupación por día de un mes. */
export const consultarCalendarioSchema = z
  .object({
    sedeId: idSchema.optional(),
    barberoId: idSchema.optional(),
    desde: fechaSchema,
    hasta: fechaSchema,
  })
  .refine((v) => v.desde <= v.hasta, {
    message: 'El rango de fechas está invertido',
    path: ['hasta'],
  });

export interface HuecoDisponible {
  /** Instante ISO del inicio del hueco. */
  inicioEn: string;
  /** "09:30", ya en la zona horaria del negocio. */
  hora: string;
  disponible: boolean;
  /** Por qué no está disponible, para pintarlo en el panel. */
  motivo?: 'OCUPADO' | 'ALMUERZO' | 'DESCANSO' | 'PASADO' | 'ANTELACION' | 'NO_CABE';
}

export interface DisponibilidadBarbero {
  barberoId: string;
  barberoNombre: string;
  alias: string | null;
  fotoUrl: string | null;
  trabaja: boolean;
  motivoNoTrabaja?: string;
  jornada: { horaInicio: number; horaFin: number } | null;
  slotMinutos: number;
  huecos: HuecoDisponible[];
  /** Cuántos huecos quedan libres: alimenta el semáforo del calendario. */
  librestotal: number;
  ocupadosTotal: number;
}

/** Resumen de un día para pintar el calendario con colores. */
export interface DiaCalendario {
  fecha: string;
  laborable: boolean;
  /** 'libre' | 'parcial' | 'lleno' | 'cerrado' */
  estado: 'libre' | 'parcial' | 'lleno' | 'cerrado';
  totalHuecos: number;
  huecosLibres: number;
  reservas: number;
  /** Nombre del festivo o motivo del cierre, si aplica. */
  etiqueta?: string;
}
