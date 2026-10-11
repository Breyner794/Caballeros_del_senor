import { HttpException, HttpStatus } from '@nestjs/common';
import { CODIGOS_ERROR, MENSAJES_ERROR, type CodigoError } from '@cds/shared';

/**
 * Error de negocio.
 *
 * Todo lo que el usuario puede provocar legítimamente (un horario que acaba de
 * ocuparse, sellos insuficientes, un día con reservas que no se puede cerrar)
 * se lanza con esta clase. Lleva un código estable, un mensaje ya redactado en
 * español y, cuando aporta, un `detalle` que el frontend usa para actuar: por
 * ejemplo la lista de citas afectadas al intentar cerrar un día, o huecos
 * alternativos cuando el elegido se ocupó.
 *
 * Lo que NO se lanza con esta clase son los fallos inesperados: esos suben
 * como excepciones normales, el filtro global los registra en `RegistroError`
 * y al usuario solo le llega "ocurrió un error inesperado".
 */
export class ErrorNegocio extends HttpException {
  constructor(
    readonly codigo: CodigoError,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    readonly detalle?: unknown,
    mensajePersonalizado?: string,
    readonly campos?: Record<string, string[]>,
  ) {
    super(mensajePersonalizado ?? MENSAJES_ERROR[codigo], status);
  }

  /** El mensaje final, ya sea el del catálogo o uno más específico. */
  get mensaje(): string {
    return this.message;
  }

  // --- Atajos para los casos más frecuentes -------------------------------

  static noEncontrado(queCosa: string, detalle?: unknown): ErrorNegocio {
    return new ErrorNegocio(
      CODIGOS_ERROR.RECURSO_NO_ENCONTRADO,
      HttpStatus.NOT_FOUND,
      detalle,
      `No encontramos ${queCosa}.`,
    );
  }

  static sinPermiso(accion?: string): ErrorNegocio {
    return new ErrorNegocio(
      CODIGOS_ERROR.SIN_PERMISO,
      HttpStatus.FORBIDDEN,
      undefined,
      accion ? `Tu rol no tiene permiso para ${accion}.` : undefined,
    );
  }

  static duplicado(queCosa: string, campos?: Record<string, string[]>): ErrorNegocio {
    return new ErrorNegocio(
      CODIGOS_ERROR.DUPLICADO,
      HttpStatus.CONFLICT,
      undefined,
      `Ya existe ${queCosa}.`,
      campos,
    );
  }

  static conflicto(codigo: CodigoError, detalle?: unknown, mensaje?: string): ErrorNegocio {
    return new ErrorNegocio(codigo, HttpStatus.CONFLICT, detalle, mensaje);
  }

  static validacion(
    campos: Record<string, string[]>,
    mensaje = MENSAJES_ERROR.VALIDACION,
  ): ErrorNegocio {
    return new ErrorNegocio(
      CODIGOS_ERROR.VALIDACION,
      HttpStatus.UNPROCESSABLE_ENTITY,
      undefined,
      mensaje,
      campos,
    );
  }

  static noAutenticado(codigo: CodigoError = CODIGOS_ERROR.SESION_EXPIRADA): ErrorNegocio {
    return new ErrorNegocio(codigo, HttpStatus.UNAUTHORIZED);
  }

  static demasiadosIntentos(segundosEspera?: number): ErrorNegocio {
    return new ErrorNegocio(
      CODIGOS_ERROR.DEMASIADOS_INTENTOS,
      HttpStatus.TOO_MANY_REQUESTS,
      segundosEspera ? { segundosEspera } : undefined,
    );
  }
}
