import { CODIGOS_ERROR, MENSAJES_ERROR, type CodigoError } from '@cds/shared';
import { ErrorApi } from '@/lib/api';

/**
 * Excepciones del canal público al catálogo `MENSAJES_ERROR`.
 *
 * Son los códigos cuyo texto del catálogo está escrito para el personal del
 * panel, y que aquí lee el propio cliente hablando de sí mismo. No es una lista
 * paralela de mensajes: el catálogo sigue siendo la fuente y esta tabla solo
 * sobrescribe lo que de verdad no sirve de cara al cliente. Hoy tiene UNA
 * entrada; añadir otra exige el mismo motivo.
 */
const EXCEPCIONES_DEL_CANAL_PUBLICO: Partial<Record<CodigoError, string>> = {
  // Catálogo: «Este cliente ya alcanzó el máximo de reservas activas.»
  LIMITE_RESERVAS_ACTIVAS:
    'Ya tienes el máximo de reservas activas. Cuando pase alguna, podrás reservar otra.',
};

/**
 * Texto para el cliente a partir de cualquier error.
 *
 * Se ramifica por `codigo`, nunca por `status`, y el texto sale de
 * `MENSAJES_ERROR`: ya está escrito para el cliente final (salvo las excepciones de abajo). Lo que no es un
 * `ErrorApi` (un bug nuestro, una excepción del navegador) nunca se muestra
 * tal cual: el cliente no puede hacer nada con «undefined is not a function».
 */
export function mensajeDeError(error: unknown): string {
  if (!(error instanceof ErrorApi)) return MENSAJES_ERROR.ERROR_INTERNO;
  const codigo = error.codigo as CodigoError;
  // Un código que no conocemos trae un texto del servidor sin redactar para el
  // cliente: se cae al genérico, igual que con un error que no es de la API.
  return EXCEPCIONES_DEL_CANAL_PUBLICO[codigo] ?? MENSAJES_ERROR[codigo] ?? MENSAJES_ERROR.ERROR_INTERNO;
}

/** ¿Es la caída de conexión que produce el cliente HTTP? */
export const esErrorDeRed = (error: unknown) =>
  error instanceof ErrorApi && error.codigo === CODIGOS_ERROR.ERROR_RED;
