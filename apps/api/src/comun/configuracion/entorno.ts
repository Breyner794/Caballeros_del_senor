import { z } from 'zod';

/**
 * Validación del entorno al arrancar.
 *
 * Si falta un secreto o un secreto es el de ejemplo, la API no arranca. Es
 * deliberado: un despliegue en el VPS con `JWT_ACCESS_SECRET=cambiame` es una
 * puerta abierta, y es mucho mejor que el contenedor no levante que descubrirlo
 * tres semanas después.
 */

const secretoSchema = (nombre: string) =>
  z
    .string({ required_error: `Falta la variable ${nombre}` })
    .min(32, `${nombre} debe tener al menos 32 caracteres`)
    .refine(
      (v) => !/^cambiame/i.test(v),
      `${nombre} sigue con el valor de ejemplo. Genéralo con: openssl rand -base64 48`,
    );

export const entornoSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    API_PREFIX: z.string().default('api/v1'),

    DATABASE_URL: z.string().url('DATABASE_URL no es una URL válida'),
    REDIS_URL: z.string().url('REDIS_URL no es una URL válida'),

    PANEL_ORIGIN: z.string().url().default('http://localhost:5173'),
    BOOKING_ORIGIN: z.string().url().default('http://localhost:5174'),

    JWT_ACCESS_SECRET: z.string().min(1),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_SECRET: z.string().min(1),
    JWT_REFRESH_TTL: z.string().default('7d'),
    /** Clave de 32 bytes en base64 para cifrar credenciales de terceros. */
    ENCRYPTION_KEY: z.string().optional(),

    BUSINESS_TIMEZONE: z.string().default('America/Bogota'),

    BREVO_API_KEY: z.string().optional(),
    BREVO_SENDER_EMAIL: z.string().email().optional(),
    BREVO_SENDER_NAME: z.string().optional(),

    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    WHATSAPP_VERIFY_TOKEN: z.string().optional(),
    WHATSAPP_APP_SECRET: z.string().optional(),
  })
  .superRefine((valor, ctx) => {
    // En desarrollo se tolera un secreto corto para no estorbar; en producción
    // se exige de verdad, y que los dos secretos sean distintos.
    if (valor.NODE_ENV !== 'production') return;

    for (const nombre of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      const resultado = secretoSchema(nombre).safeParse(valor[nombre]);
      if (!resultado.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [nombre],
          message: resultado.error.issues[0]?.message ?? `${nombre} no es válido`,
        });
      }
    }

    if (valor.JWT_ACCESS_SECRET === valor.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message:
          'El secreto de refresh debe ser distinto al de acceso: si no, un access token robado sirve para refrescar',
      });
    }

    if (!valor.ENCRYPTION_KEY || Buffer.from(valor.ENCRYPTION_KEY, 'base64').length !== 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ENCRYPTION_KEY'],
        message: 'ENCRYPTION_KEY debe ser 32 bytes en base64. Genérala con: openssl rand -base64 32',
      });
    }
  });

export type Entorno = z.infer<typeof entornoSchema>;

export function validarEntorno(crudo: Record<string, unknown>): Entorno {
  const resultado = entornoSchema.safeParse(crudo);

  if (!resultado.success) {
    const detalle = resultado.error.issues
      .map((i) => `  · ${i.path.join('.') || '(raíz)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuración de entorno no válida:\n${detalle}\n`);
  }

  return resultado.data;
}
