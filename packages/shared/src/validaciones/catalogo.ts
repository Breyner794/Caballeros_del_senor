import { z } from 'zod';
import {
  diaSemanaSchema,
  dineroSchema,
  emailSchema,
  emailOpcionalSchema,
  fechaSchema,
  idSchema,
  minutosDelDiaSchema,
  paginacionSchema,
  passwordSchema,
  telefonoSchema,
  textoOpcional,
  textoRequerido,
} from './comunes.js';
import { ROLES } from '../dominio/roles.js';

// ============================== SEDES =======================================

export const horarioSedeSchema = z
  .object({
    diaSemana: diaSemanaSchema,
    horaInicio: minutosDelDiaSchema,
    horaFin: minutosDelDiaSchema,
    cerrado: z.boolean().default(false),
  })
  .refine((v) => v.cerrado || v.horaFin > v.horaInicio, {
    message: 'La hora de cierre debe ser posterior a la de apertura',
    path: ['horaFin'],
  });

export const crearSedeSchema = z.object({
  nombre: textoRequerido('El nombre de la sede', 120),
  direccion: textoRequerido('La dirección', 255),
  ciudad: textoOpcional(120),
  telefono: textoOpcional(30),
  mapsUrl: z.string().trim().url('El enlace de Maps no es válido').max(500).optional().or(z.literal('')),
  notas: textoOpcional(1000),
  activa: z.boolean().default(true),
  orden: z.coerce.number().int().min(0).default(0),
  /** Los 7 días. Si no se envían, la sede queda sin horario de atención. */
  horarios: z.array(horarioSedeSchema).max(7).default([]),
});
export type CrearSedeDto = z.infer<typeof crearSedeSchema>;
export const actualizarSedeSchema = crearSedeSchema.partial();
export type ActualizarSedeDto = z.infer<typeof actualizarSedeSchema>;

// ============================ SERVICIOS =====================================

export const crearServicioSchema = z.object({
  nombre: textoRequerido('El nombre del servicio', 140),
  descripcion: textoOpcional(1000),
  /** Qué incluye. Opcional: el barbero decide si lo detalla o no. */
  incluye: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  precio: dineroSchema,
  duracionMinutos: z.coerce
    .number()
    .int('La duración son minutos enteros')
    .min(5, 'Mínimo 5 minutos')
    .max(600, 'Máximo 10 horas'),
  /** Null = hereda el buffer de la configuración global. */
  bufferMinutos: z.coerce.number().int().min(0).max(120).nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'El color debe ser un hexadecimal como #1f2937')
    .optional(),
  activo: z.boolean().default(true),
  visibleWeb: z.boolean().default(true),
  orden: z.coerce.number().int().min(0).default(0),
  cuentaFidelidad: z.boolean().default(true),
  canjeableFidelidad: z.boolean().default(true),
});
export type CrearServicioDto = z.infer<typeof crearServicioSchema>;
export const actualizarServicioSchema = crearServicioSchema.partial();
export type ActualizarServicioDto = z.infer<typeof actualizarServicioSchema>;

export const listarServiciosSchema = paginacionSchema.extend({
  activo: z.coerce.boolean().optional(),
  visibleWeb: z.coerce.boolean().optional(),
});

// ============================= USUARIOS =====================================

export const crearUsuarioSchema = z
  .object({
    nombre: textoRequerido('El nombre', 120),
    apellido: textoOpcional(120),
    email: emailSchema,
    telefono: telefonoSchema,
    password: passwordSchema,
    rol: z.enum(ROLES),
    activo: z.boolean().default(true),
    /** Sede principal. Obligatoria para barbero y recepcionista. */
    sedeId: idSchema.optional(),
    /** Sedes adicionales donde puede cubrir turnos. */
    sedesPermitidas: z.array(idSchema).max(20).default([]),
    alias: textoOpcional(60),
    bio: textoOpcional(1000),
    visibleWeb: z.boolean().default(true),
    slotMinutos: z.coerce.number().int().min(5).max(240).nullable().optional(),
    /** Obliga a cambiar la contraseña en el primer inicio de sesión. */
    debeCambiarPassword: z.boolean().default(true),
  })
  .refine((v) => !(v.rol === 'BARBERO' || v.rol === 'RECEPCIONISTA') || !!v.sedeId, {
    message: 'Un barbero o recepcionista necesita una sede asignada',
    path: ['sedeId'],
  });
export type CrearUsuarioDto = z.infer<typeof crearUsuarioSchema>;

/** Al editar, la contraseña no se toca desde aquí: tiene su propia acción. */
export const actualizarUsuarioSchema = z.object({
  nombre: textoRequerido('El nombre', 120).optional(),
  apellido: textoOpcional(120),
  email: emailSchema.optional(),
  telefono: telefonoSchema.optional(),
  rol: z.enum(ROLES).optional(),
  activo: z.boolean().optional(),
  sedeId: idSchema.nullable().optional(),
  sedesPermitidas: z.array(idSchema).max(20).optional(),
  alias: textoOpcional(60),
  bio: textoOpcional(1000),
  visibleWeb: z.boolean().optional(),
  slotMinutos: z.coerce.number().int().min(5).max(240).nullable().optional(),
  debeCambiarPassword: z.boolean().optional(),
});
export type ActualizarUsuarioDto = z.infer<typeof actualizarUsuarioSchema>;

export const listarUsuariosSchema = paginacionSchema.extend({
  rol: z.enum(ROLES).optional(),
  sedeId: idSchema.optional(),
  activo: z.coerce.boolean().optional(),
});

/** Reseteo de contraseña hecho por un administrador. */
export const resetearPasswordUsuarioSchema = z.object({
  password: passwordSchema,
  /** Si se notifica al usuario por correo que su contraseña cambió. */
  notificar: z.boolean().default(true),
});

// ============================= CLIENTES =====================================

/**
 * Formulario de cliente. Hoy solo se pide nombre y celular; correo, documento
 * y fecha de nacimiento ya están modelados y validados, pero el panel los
 * mantiene ocultos en una sección plegable "Datos adicionales". Cuando el
 * cliente quiera usarlos, solo hay que mostrar los campos.
 */
export const crearClienteSchema = z.object({
  nombreCompleto: textoRequerido('El nombre completo', 160),
  telefono: telefonoSchema,
  email: emailOpcionalSchema.optional(),
  documento: textoOpcional(30),
  fechaNacimiento: fechaSchema.optional(),
  notas: textoOpcional(2000),
  aceptaWhatsapp: z.boolean().default(true),
  aceptaEmail: z.boolean().default(false),
  activo: z.boolean().default(true),
});
export type CrearClienteDto = z.infer<typeof crearClienteSchema>;
export const actualizarClienteSchema = crearClienteSchema.partial();
export type ActualizarClienteDto = z.infer<typeof actualizarClienteSchema>;

export const listarClientesSchema = paginacionSchema.extend({
  activo: z.coerce.boolean().optional(),
  /** Solo los que ya tienen el premio de fidelidad disponible. */
  conPremioDisponible: z.coerce.boolean().optional(),
  /** Clientes cuya fecha estimada de regreso ya pasó: candidatos a recordar. */
  pendientesDeRegreso: z.coerce.boolean().optional(),
  sedeId: idSchema.optional(),
  barberoId: idSchema.optional(),
});

/** Búsqueda rápida del formulario de reservas: por nombre o por teléfono. */
export const buscarClientesSchema = z.object({
  q: z.string().trim().min(2, 'Escribe al menos 2 caracteres').max(80),
  limite: z.coerce.number().int().min(1).max(20).default(8),
});
