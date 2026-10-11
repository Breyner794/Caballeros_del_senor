import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { CODIGOS_ERROR, MENSAJES_ERROR, type RespuestaError } from '@cds/shared';
import { ErrorNegocio } from './error-negocio.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegistroErroresService } from '../errores/registro-errores.service.js';

/**
 * Filtro global de errores: el único lugar donde se decide qué ve el usuario.
 *
 * Tres caminos:
 *  1. `ErrorNegocio` → se devuelve tal cual. Es un error esperado y su mensaje
 *     ya está redactado para el usuario. No se registra como incidencia.
 *  2. Errores conocidos de Prisma/Zod → se traducen a un código de negocio.
 *     Aquí se convierten las garantías de la base de datos (la restricción
 *     anti-solape, las claves únicas) en mensajes comprensibles.
 *  3. Cualquier otra cosa → 500 genérico para el usuario y registro completo
 *     en `RegistroError` con traza, ruta, usuario e id de correlación. El
 *     usuario recibe ese id y puede dictarlo al soporte.
 *
 * Nunca se filtra al cliente el mensaje de un error inesperado: puede contener
 * nombres de tablas, consultas o rutas del servidor.
 */
@Catch()
@Injectable()
export class FiltroGlobalExcepciones implements ExceptionFilter {
  private readonly logger = new Logger('Errores');

  constructor(private readonly registro: RegistroErroresService) {}

  async catch(excepcion: unknown, host: ArgumentsHost): Promise<void> {
    const ctx = host.switchToHttp();
    const respuesta = ctx.getResponse<Response>();
    const peticion = ctx.getRequest<Request>();
    const requestId = (peticion.headers['x-request-id'] as string | undefined) ?? undefined;

    const traducido = this.traducir(excepcion);

    const cuerpo: RespuestaError = {
      ok: false,
      codigo: traducido.codigo,
      mensaje: traducido.mensaje,
      statusHttp: traducido.status,
      marcaTiempo: new Date().toISOString(),
      ...(traducido.campos ? { campos: traducido.campos } : {}),
      ...(traducido.detalle !== undefined ? { detalle: traducido.detalle } : {}),
      ...(requestId ? { requestId } : {}),
    };

    // Solo se registran como incidencia los fallos no previstos y los 5xx.
    if (traducido.registrar) {
      const error = excepcion instanceof Error ? excepcion : new Error(String(excepcion));
      this.logger.error(
        `${peticion.method} ${peticion.originalUrl} → ${traducido.status} ${traducido.codigo}: ${error.message}`,
        error.stack,
      );

      await this.registro.registrar({
        codigo: traducido.codigo,
        mensaje: error.message,
        stack: error.stack,
        huella: this.calcularHuella(peticion.method, peticion.route?.path ?? peticion.path, error),
        origen: 'api',
        ruta: peticion.originalUrl?.slice(0, 300),
        metodo: peticion.method,
        statusHttp: traducido.status,
        requestId,
        ip: peticion.ip,
        usuarioId: (peticion as { usuario?: { id?: string } }).usuario?.id,
        contexto: {
          cuerpo: this.sanear(peticion.body),
          query: peticion.query,
          params: peticion.params,
        },
      });
    }

    respuesta.status(traducido.status).json(cuerpo);
  }

  private traducir(excepcion: unknown): {
    status: number;
    codigo: string;
    mensaje: string;
    campos?: Record<string, string[]>;
    detalle?: unknown;
    registrar: boolean;
  } {
    // 1. Error de negocio: ya viene listo.
    if (excepcion instanceof ErrorNegocio) {
      return {
        status: excepcion.getStatus(),
        codigo: excepcion.codigo,
        mensaje: excepcion.mensaje,
        campos: excepcion.campos,
        detalle: excepcion.detalle,
        registrar: excepcion.getStatus() >= 500,
      };
    }

    // 2. Validación de Zod: se agrupan los mensajes por campo.
    if (excepcion instanceof ZodError) {
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        codigo: CODIGOS_ERROR.VALIDACION,
        mensaje: MENSAJES_ERROR.VALIDACION,
        campos: this.agruparPorCampo(excepcion),
        registrar: false,
      };
    }

    // 3. Restricciones de la base de datos.
    if (excepcion instanceof Prisma.PrismaClientKnownRequestError) {
      const traducido = this.traducirPrisma(excepcion);
      if (traducido) return traducido;
    }

    // 4. Excepciones HTTP de Nest (404 de ruta, 401 del guard, throttler…).
    if (excepcion instanceof HttpException) {
      const status = excepcion.getStatus();
      const respuesta = excepcion.getResponse();
      const mensajeNest =
        typeof respuesta === 'string'
          ? respuesta
          : ((respuesta as { message?: string | string[] }).message ?? excepcion.message);

      return {
        status,
        codigo: this.codigoPorStatus(status),
        mensaje:
          status >= 500
            ? MENSAJES_ERROR.ERROR_INTERNO
            : Array.isArray(mensajeNest)
              ? mensajeNest.join('. ')
              : mensajeNest,
        registrar: status >= 500,
      };
    }

    // 5. Lo desconocido: mensaje genérico y registro completo.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      codigo: CODIGOS_ERROR.ERROR_INTERNO,
      mensaje: MENSAJES_ERROR.ERROR_INTERNO,
      registrar: true,
    };
  }

  private traducirPrisma(error: Prisma.PrismaClientKnownRequestError): {
    status: number;
    codigo: string;
    mensaje: string;
    campos?: Record<string, string[]>;
    registrar: boolean;
  } | null {
    // La restricción de exclusión anti-solape: la carrera que el código no
    // puede evitar por sí solo.
    if (PrismaService.esViolacionDe(error, 'reservas_sin_solape_barbero')) {
      return {
        status: HttpStatus.CONFLICT,
        codigo: CODIGOS_ERROR.RESERVA_SOLAPADA,
        mensaje: MENSAJES_ERROR.RESERVA_SOLAPADA,
        registrar: false,
      };
    }

    if (PrismaService.esViolacionDe(error, 'agenda_bloques_sin_solape')) {
      return {
        status: HttpStatus.CONFLICT,
        codigo: CODIGOS_ERROR.BLOQUES_SOLAPADOS,
        mensaje: MENSAJES_ERROR.BLOQUES_SOLAPADOS,
        registrar: false,
      };
    }

    if (PrismaService.esViolacionDe(error, 'config_comisiones_sin_solape_usuario')) {
      return {
        status: HttpStatus.CONFLICT,
        codigo: CODIGOS_ERROR.COMISION_SOLAPADA,
        mensaje: MENSAJES_ERROR.COMISION_SOLAPADA,
        registrar: false,
      };
    }

    if (PrismaService.esViolacionDe(error, 'producto_stock_no_negativo')) {
      return {
        status: HttpStatus.CONFLICT,
        codigo: CODIGOS_ERROR.STOCK_INSUFICIENTE,
        mensaje: MENSAJES_ERROR.STOCK_INSUFICIENTE,
        registrar: false,
      };
    }

    switch (error.code) {
      case 'P2002': {
        const campos = PrismaService.camposDuplicados(error);
        return {
          status: HttpStatus.CONFLICT,
          codigo: CODIGOS_ERROR.DUPLICADO,
          mensaje: this.mensajeDuplicado(campos),
          campos: Object.fromEntries(campos.map((c) => [c, ['Ya existe un registro con este valor']])),
          registrar: false,
        };
      }
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          codigo: CODIGOS_ERROR.RECURSO_NO_ENCONTRADO,
          mensaje: MENSAJES_ERROR.RECURSO_NO_ENCONTRADO,
          registrar: false,
        };
      case 'P2003':
      case 'P2014':
        return {
          status: HttpStatus.CONFLICT,
          codigo: CODIGOS_ERROR.CONFLICTO,
          mensaje: 'No se puede hacer esto porque hay información relacionada que depende de ello.',
          registrar: false,
        };
      default:
        // Restricciones CHECK y cualquier otro fallo del motor: es un bug
        // nuestro (dejamos pasar datos incoherentes), así que se registra.
        return null;
    }
  }

  private mensajeDuplicado(campos: string[]): string {
    const amigables: Record<string, string> = {
      telefono: 'Ya hay un cliente registrado con ese celular.',
      email: 'Ya hay una cuenta con ese correo.',
      codigo: 'Ese código de reserva ya existe.',
      slug: 'Ya existe un registro con ese nombre.',
      sku: 'Ya hay un producto con ese SKU.',
      codigoBarras: 'Ya hay un producto con ese código de barras.',
    };
    for (const campo of campos) {
      if (amigables[campo]) return amigables[campo];
    }
    return MENSAJES_ERROR.DUPLICADO;
  }

  private codigoPorStatus(status: number): string {
    const mapa: Record<number, string> = {
      [HttpStatus.UNAUTHORIZED]: CODIGOS_ERROR.SESION_EXPIRADA,
      [HttpStatus.FORBIDDEN]: CODIGOS_ERROR.SIN_PERMISO,
      [HttpStatus.NOT_FOUND]: CODIGOS_ERROR.RECURSO_NO_ENCONTRADO,
      [HttpStatus.CONFLICT]: CODIGOS_ERROR.CONFLICTO,
      [HttpStatus.TOO_MANY_REQUESTS]: CODIGOS_ERROR.DEMASIADOS_INTENTOS,
      [HttpStatus.UNPROCESSABLE_ENTITY]: CODIGOS_ERROR.VALIDACION,
    };
    return mapa[status] ?? (status >= 500 ? CODIGOS_ERROR.ERROR_INTERNO : CODIGOS_ERROR.VALIDACION);
  }

  private agruparPorCampo(error: ZodError): Record<string, string[]> {
    const campos: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const clave = issue.path.length > 0 ? issue.path.join('.') : '_general';
      (campos[clave] ??= []).push(issue.message);
    }
    return campos;
  }

  /**
   * Huella para agrupar errores idénticos. Sin ella, un fallo en una ruta muy
   * visitada escribe miles de filas iguales y el módulo de errores se vuelve
   * inútil. Con ella, se ve "este fallo, 1.248 veces, desde el martes".
   */
  private calcularHuella(metodo: string, ruta: string, error: Error): string {
    const primeraLinea = error.stack?.split('\n')[1]?.trim() ?? error.message;
    return createHash('sha256')
      .update(`${metodo}|${ruta}|${error.name}|${primeraLinea}`)
      .digest('hex')
      .slice(0, 32);
  }

  /** Nunca se guardan contraseñas ni tokens en el registro de errores. */
  private sanear(cuerpo: unknown): unknown {
    if (!cuerpo || typeof cuerpo !== 'object') return cuerpo;
    const prohibidos = [
      'password',
      'passwordActual',
      'confirmacion',
      'token',
      'accessToken',
      'refreshToken',
      'codigo',
      'passwordHash',
      'authorization',
    ];
    const copia: Record<string, unknown> = { ...(cuerpo as Record<string, unknown>) };
    for (const clave of Object.keys(copia)) {
      if (prohibidos.some((p) => clave.toLowerCase().includes(p.toLowerCase()))) {
        copia[clave] = '[oculto]';
      }
    }
    return copia;
  }
}
