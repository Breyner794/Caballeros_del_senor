import { CODIGOS_ERROR, MENSAJES_ERROR, type CodigoError } from '@cds/shared';
import { ErrorApi } from '@/lib/api';

/**
 * Texto para el cliente a partir de cualquier error.
 *
 * Se ramifica por `codigo`, nunca por `status`, y el texto sale de
 * `MENSAJES_ERROR`: ya está escrito para el cliente final. Lo que no es un
 * `ErrorApi` (un bug nuestro, una excepción del navegador) nunca se muestra
 * tal cual: el cliente no puede hacer nada con «undefined is not a function».
 */
export function mensajeDeError(error: unknown): string {
  if (!(error instanceof ErrorApi)) return MENSAJES_ERROR.ERROR_INTERNO;
  return MENSAJES_ERROR[error.codigo as CodigoError] ?? error.mensaje;
}

/** ¿Es la caída de conexión que produce el cliente HTTP? */
export const esErrorDeRed = (error: unknown) =>
  error instanceof ErrorApi && error.codigo === CODIGOS_ERROR.ERROR_RED;
