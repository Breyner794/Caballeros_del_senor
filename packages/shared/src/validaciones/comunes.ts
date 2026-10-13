import { z } from 'zod';
import { LIMITE_DEFECTO, LIMITE_MAXIMO } from '../dominio/paginacion.js';
import { normalizarTelefono } from '../dominio/telefono.js';
import { MINUTOS_POR_DIA } from '../dominio/horarios.js';

/**
 * Piezas de validación reutilizables.
 *
 * El mismo esquema valida en el navegador (antes de enviar, para dar feedback
 * inmediato) y en la API (porque el cliente nunca es de fiar). Un solo sitio
 * donde cambiar la regla.
 */

export const idSchema = z.string().uuid('Identificador no válido');

export const textoRequerido = (campo: string, max = 160) =>
  z
    .string({ required_error: `${campo} es obligatorio` })
    .trim()
    .min(1, `${campo} es obligatorio`)
    .max(max, `${campo} no puede pasar de ${max} caracteres`);

export const textoOpcional = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, `No puede pasar de ${max} caracteres`)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

/** Acepta cualquier formato que escriba la recepción y lo guarda en E.164. */
export const telefonoSchema = z
  .string({ required_error: 'El celular es obligatorio' })
  .trim()
  .transform((valor, ctx) => {
    const resultado = normalizarTelefono(valor);
    if (!resultado.valido || !resultado.e164) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: resultado.motivo ?? 'Celular no válido',
      });
      return z.NEVER;
    }
    return resultado.e164;
  });

export const telefonoOpcionalSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((valor, ctx) => {
    if (valor === null || valor === undefined || valor.trim() === '') return undefined;
    const resultado = normalizarTelefono(valor);
    if (!resultado.valido || !resultado.e164) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: resultado.motivo ?? 'Celular no válido',
      });
      return z.NEVER;
    }
    return resultado.e164;
  });

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Correo electrónico no válido')
  .max(180);

/** Email opcional: el formulario de clientes lo deja oculto por ahora. */
export const emailOpcionalSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (v === null || v === undefined || v.trim() === '' ? undefined : v.trim().toLowerCase()))
  .pipe(z.string().email('Correo electrónico no válido').max(180).optional());

/**
 * Contraseña: 10 caracteres mínimo con variedad.
 *
 * Se prefiere longitud a reglas enrevesadas, pero se exige mezcla porque el
 * panel maneja datos de clientes y dinero, y las cuentas las crea el
 * administrador (no hay registro público que empuje a contraseñas memorables).
 */
export const passwordSchema = z
  .string({ required_error: 'La contraseña es obligatoria' })
  .min(10, 'Mínimo 10 caracteres')
  .max(128, 'Máximo 128 caracteres')
  .refine((v) => /[a-záéíóúñ]/.test(v), 'Debe incluir al menos una minúscula')
  .refine((v) => /[A-ZÁÉÍÓÚÑ]/.test(v), 'Debe incluir al menos una mayúscula')
  .refine((v) => /\d/.test(v), 'Debe incluir al menos un número');

/** Dinero: se recibe como número y se trabaja con 2 decimales. */
export const dineroSchema = z
  .coerce
  .number({ invalid_type_error: 'Tiene que ser un número' })
  .min(0, 'No puede ser negativo')
  .max(99_999_999.99, 'Importe demasiado alto')
  .transform((v) => Math.round(v * 100) / 100);

export const porcentajeSchema = z.coerce
  .number({ invalid_type_error: 'Tiene que ser un número' })
  .min(0, 'El porcentaje no puede ser negativo')
  .max(100, 'El porcentaje no puede pasar de 100')
  .transform((v) => Math.round(v * 100) / 100);

export const minutosDelDiaSchema = z.coerce
  .number()
  .int('Tiene que ser un número entero de minutos')
  .min(0, 'Fuera de rango')
  .max(MINUTOS_POR_DIA, 'Fuera de rango');

export const diaSemanaSchema = z.coerce
  .number()
  .int()
  .min(0, 'Día de la semana no válido')
  .max(6, 'Día de la semana no válido');

/** Fecha en formato YYYY-MM-DD, sin hora: la agenda razona en días locales. */
export const fechaSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe venir como AAAA-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Fecha no válida');

export const fechaHoraSchema = z
  .string()
  .datetime({ offset: true, message: 'La fecha y hora deben venir en formato ISO 8601' });

export const paginacionSchema = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(LIMITE_MAXIMO).default(LIMITE_DEFECTO),
  orden: z.enum(['asc', 'desc']).default('desc'),
  ordenarPor: z.string().trim().max(40).optional(),
  buscar: z.string().trim().max(120).optional(),
});

export type ParametrosPaginacion = z.infer<typeof paginacionSchema>;

export const rangoFechasSchema = z
  .object({
    desde: fechaSchema,
    hasta: fechaSchema,
  })
  .refine((v) => v.desde <= v.hasta, {
    message: 'La fecha inicial no puede ser posterior a la final',
    path: ['desde'],
  });

/**
 * Arreglo que llega por query string.
 *
 * `?ids=a&ids=b` llega como arreglo, pero `?ids=a` llega como texto suelto, y
 * `?ids=a,b` como una sola cadena. Los tres casos son peticiones legítimas que
 * el frontend genera sin pensarlo, así que se normalizan aquí en lugar de
 * obligar a cada pantalla a recordar la diferencia.
 */
export const arrayDeQuery = <T extends z.ZodTypeAny>(elemento: T) =>
  z.preprocess((valor) => {
    if (valor === undefined || valor === null || valor === '') return [];
    if (Array.isArray(valor)) return valor;
    if (typeof valor === 'string') {
      return valor.includes(',') ? valor.split(',').map((v) => v.trim()).filter(Boolean) : [valor];
    }
    return [valor];
  }, z.array(elemento));

/**
 * Booleano que llega por query string.
 *
 * `z.coerce.boolean()` no sirve aquí: aplica `Boolean(valor)` y en una URL todo
 * llega como texto, así que `?activo=false` se convierte en `true` y el filtro
 * devuelve justo lo contrario de lo que se pidió, sin error que lo delate.
 *
 * Solo se aceptan las formas que de verdad genera un frontend; cualquier otra
 * cosa es un error de validación y no un `true` silencioso.
 */
export const booleanoDeQuery = z.preprocess((valor) => {
  if (typeof valor === 'boolean' || valor === undefined) return valor;
  if (valor === null || valor === '') return undefined;
  if (typeof valor === 'string') {
    const texto = valor.trim().toLowerCase();
    if (['true', '1', 'si', 'sí'].includes(texto)) return true;
    if (['false', '0', 'no'].includes(texto)) return false;
  }
  return valor;
}, z.boolean());
