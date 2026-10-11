import { z } from 'zod';
import {
  diaSemanaSchema,
  fechaSchema,
  idSchema,
  minutosDelDiaSchema,
  textoOpcional,
  textoRequerido,
} from './comunes.js';
import { contiene, seSolapan } from '../dominio/horarios.js';

export const TIPOS_BLOQUE = ['ALMUERZO', 'DESCANSO', 'ADMINISTRATIVO'] as const;
export const TIPOS_EXCEPCION = ['CERRADO', 'HORARIO_ESPECIAL'] as const;
export const TIPOS_DIA_ESPECIAL = ['FESTIVO_CERRADO', 'FESTIVO_ABIERTO', 'HORARIO_ESPECIAL'] as const;

export const bloqueAgendaSchema = z
  .object({
    tipo: z.enum(TIPOS_BLOQUE).default('ALMUERZO'),
    horaInicio: minutosDelDiaSchema,
    horaFin: minutosDelDiaSchema,
    etiqueta: textoOpcional(80),
  })
  .refine((v) => v.horaFin > v.horaInicio, {
    message: 'El bloque debe terminar después de empezar',
    path: ['horaFin'],
  });

/**
 * Un día de la plantilla semanal del barbero.
 *
 * Se valida aquí, antes de llegar a la base de datos, que los bloques caigan
 * dentro de la jornada y no se pisen entre sí: así el usuario ve el error
 * junto al campo en lugar de un fallo genérico del servidor.
 */
export const diaAgendaSchema = z
  .object({
    diaSemana: diaSemanaSchema,
    trabaja: z.boolean().default(true),
    horaInicio: minutosDelDiaSchema,
    horaFin: minutosDelDiaSchema,
    /** Null = hereda el slot del usuario y, si tampoco tiene, el global. */
    slotMinutos: z.coerce.number().int().min(5).max(240).nullable().optional(),
    bloques: z.array(bloqueAgendaSchema).max(6).default([]),
  })
  .superRefine((valor, ctx) => {
    if (!valor.trabaja) return;

    if (valor.horaFin <= valor.horaInicio) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'La jornada debe terminar después de empezar',
        path: ['horaFin'],
      });
      return;
    }

    const jornada = { horaInicio: valor.horaInicio, horaFin: valor.horaFin };

    valor.bloques.forEach((bloque, i) => {
      if (!contiene(jornada, bloque)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'El bloque queda fuera de la jornada de ese día',
          path: ['bloques', i],
        });
      }
      valor.bloques.slice(i + 1).forEach((otro) => {
        if (seSolapan(bloque, otro)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Este bloque se cruza con otro del mismo día',
            path: ['bloques', i],
          });
        }
      });
    });
  });

/** Se guarda la semana entera de golpe: es como se edita en la pantalla. */
export const guardarAgendaSemanalSchema = z.object({
  usuarioId: idSchema,
  sedeId: idSchema,
  dias: z.array(diaAgendaSchema).min(1).max(7),
});
export type GuardarAgendaSemanalDto = z.infer<typeof guardarAgendaSemanalSchema>;

/**
 * Excepción para una fecha concreta.
 *
 * Al cerrar un día que ya tiene reservas, la API responde con el error
 * DIA_CON_RESERVAS y la lista de citas afectadas: el panel abre un diálogo con
 * los clientes y sus teléfonos para que el barbero los llame. Solo si marca
 * `forzar` (tras reprogramar o cancelar esas citas) se aplica el cierre.
 */
export const crearExcepcionSchema = z
  .object({
    usuarioId: idSchema,
    /** Null = aplica en todas las sedes del barbero. */
    sedeId: idSchema.nullable().optional(),
    fecha: fechaSchema,
    tipo: z.enum(TIPOS_EXCEPCION),
    horaInicio: minutosDelDiaSchema.optional(),
    horaFin: minutosDelDiaSchema.optional(),
    motivo: textoOpcional(200),
    forzar: z.boolean().default(false),
  })
  .superRefine((valor, ctx) => {
    if (valor.tipo !== 'HORARIO_ESPECIAL') return;
    if (valor.horaInicio === undefined || valor.horaFin === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Un horario especial necesita hora de inicio y de fin',
        path: ['horaInicio'],
      });
    } else if (valor.horaFin <= valor.horaInicio) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'La hora de fin debe ser posterior a la de inicio',
        path: ['horaFin'],
      });
    }
  });
export type CrearExcepcionDto = z.infer<typeof crearExcepcionSchema>;

/** Días festivos y fechas especiales del negocio (configuración global). */
export const crearDiaEspecialSchema = z
  .object({
    sedeId: idSchema.nullable().optional(),
    fecha: fechaSchema,
    nombre: textoRequerido('El nombre del día', 140),
    tipo: z.enum(TIPOS_DIA_ESPECIAL),
    horaInicio: minutosDelDiaSchema.optional(),
    horaFin: minutosDelDiaSchema.optional(),
    visibleWeb: z.boolean().default(true),
    notas: textoOpcional(1000),
    forzar: z.boolean().default(false),
  })
  .superRefine((valor, ctx) => {
    if (valor.tipo === 'FESTIVO_CERRADO') return;
    if (valor.horaInicio === undefined || valor.horaFin === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Si ese día se trabaja, indica el horario',
        path: ['horaInicio'],
      });
    } else if (valor.horaFin <= valor.horaInicio) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'La hora de fin debe ser posterior a la de inicio',
        path: ['horaFin'],
      });
    }
  });
export type CrearDiaEspecialDto = z.infer<typeof crearDiaEspecialSchema>;

// ===================== CONFIGURACIÓN GLOBAL =================================

export const actualizarConfiguracionSchema = z.object({
  nombreNegocio: textoRequerido('El nombre del negocio', 140).optional(),
  zonaHoraria: z.string().trim().max(60).optional(),
  moneda: z.string().trim().length(3).toUpperCase().optional(),
  telefonoContacto: textoOpcional(30),
  emailContacto: textoOpcional(180),

  /**
   * Slot global. Al cambiarlo NO se tocan los barberos que configuraron el
   * suyo: solo afecta a quienes lo tienen heredado. La API devuelve cuántos
   * barberos quedan afectados para poder avisarlo en pantalla.
   */
  slotMinutosDefault: z.coerce.number().int().min(5).max(240).optional(),
  /**
   * Buffer interno entre clientes: el tiempo de limpieza de máquinas y silla.
   * El cliente nunca lo ve; solo desplaza los huecos ofrecidos.
   */
  bufferMinutosDefault: z.coerce.number().int().min(0).max(120).optional(),

  minAntelacionMinutos: z.coerce.number().int().min(0).max(10080).optional(),
  maxDiasAnticipacion: z.coerce.number().int().min(1).max(365).optional(),
  horasLimiteCancelacion: z.coerce.number().int().min(0).max(168).optional(),
  horasLimiteReprogramacion: z.coerce.number().int().min(0).max(168).optional(),
  permiteElegirBarbero: z.boolean().optional(),
  requiereConfirmacion: z.boolean().optional(),
  maxReservasActivasCliente: z.coerce.number().int().min(1).max(20).optional(),

  recordatorioWhatsappHoras: z.coerce.number().int().min(0).max(168).optional(),
  recordatorioEmailHoras: z.coerce.number().int().min(0).max(168).optional(),
  notificarNuevaReserva: z.boolean().optional(),
  notificarCancelacion: z.boolean().optional(),
});
export type ActualizarConfiguracionDto = z.infer<typeof actualizarConfiguracionSchema>;

export const actualizarProgramaFidelidadSchema = z.object({
  activo: z.boolean().optional(),
  nombre: textoRequerido('El nombre del programa', 140).optional(),
  /** 7 sellos → el 8º corte es gratis. Editable por el administrador. */
  sellosRequeridos: z.coerce.number().int().min(1).max(100).optional(),
  diasValidezSello: z.coerce.number().int().min(1).max(3650).nullable().optional(),
  diasValidezPremio: z.coerce.number().int().min(1).max(3650).nullable().optional(),
  canjeGeneraSello: z.boolean().optional(),
  acumulaPorSede: z.boolean().optional(),
  mensajePremio: textoOpcional(255),
});
export type ActualizarProgramaFidelidadDto = z.infer<typeof actualizarProgramaFidelidadSchema>;
