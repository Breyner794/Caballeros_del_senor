import { z } from 'zod';
import { emailSchema, passwordSchema, idSchema, telefonoSchema, textoRequerido, textoOpcional } from './comunes.js';
import { ROLES } from '../dominio/roles.js';

export const loginSchema = z.object({
  email: emailSchema,
  // Al iniciar sesión no se aplican las reglas de fortaleza: una contraseña
  // antigua y débil debe poder entrar (y luego se le obliga a cambiarla).
  password: z.string().min(1, 'La contraseña es obligatoria').max(128),
  recordarme: z.boolean().default(false),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const solicitarRecuperacionSchema = z.object({
  email: emailSchema,
});
export type SolicitarRecuperacionDto = z.infer<typeof solicitarRecuperacionSchema>;

export const verificarCodigoSchema = z.object({
  email: emailSchema,
  codigo: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'El código son 6 dígitos'),
});
export type VerificarCodigoDto = z.infer<typeof verificarCodigoSchema>;

export const restablecerPasswordSchema = z
  .object({
    email: emailSchema,
    codigo: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'El código son 6 dígitos'),
    password: passwordSchema,
    confirmacion: z.string(),
  })
  .refine((v) => v.password === v.confirmacion, {
    message: 'Las contraseñas no coinciden',
    path: ['confirmacion'],
  });
export type RestablecerPasswordDto = z.infer<typeof restablecerPasswordSchema>;

export const cambiarPasswordSchema = z
  .object({
    passwordActual: z.string().min(1, 'Escribe tu contraseña actual'),
    password: passwordSchema,
    confirmacion: z.string(),
  })
  .refine((v) => v.password === v.confirmacion, {
    message: 'Las contraseñas no coinciden',
    path: ['confirmacion'],
  })
  .refine((v) => v.password !== v.passwordActual, {
    message: 'La nueva contraseña tiene que ser distinta de la actual',
    path: ['password'],
  });
export type CambiarPasswordDto = z.infer<typeof cambiarPasswordSchema>;

/** Datos que el propio usuario puede cambiar de su perfil. */
export const actualizarPerfilSchema = z.object({
  nombre: textoRequerido('El nombre', 120),
  apellido: textoOpcional(120),
  telefono: telefonoSchema,
  alias: textoOpcional(60),
  bio: textoOpcional(1000),
  /** Cambio de sede del propio barbero/recepcionista. La API valida que no
   *  deje reservas huérfanas en la sede anterior. */
  sedeId: idSchema.optional(),
  slotMinutos: z.coerce.number().int().min(5).max(240).nullable().optional(),
});
export type ActualizarPerfilDto = z.infer<typeof actualizarPerfilSchema>;

export const rolSchema = z.enum(ROLES);

/** Lo que devuelve la API tras iniciar sesión correctamente. */
export interface UsuarioSesion {
  id: string;
  nombre: string;
  apellido: string | null;
  email: string;
  telefono: string;
  rol: (typeof ROLES)[number];
  sedeId: string | null;
  sedeNombre: string | null;
  sedesPermitidas: { id: string; nombre: string }[];
  alias: string | null;
  fotoUrl: string | null;
  debeCambiarPassword: boolean;
  permisos: string[];
}

export interface RespuestaLogin {
  accessToken: string;
  /** Segundos de vida del access token, para refrescar antes de que caduque. */
  expiraEn: number;
  usuario: UsuarioSesion;
}
