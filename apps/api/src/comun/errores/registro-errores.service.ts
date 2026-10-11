import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface DatosRegistroError {
  codigo: string;
  mensaje: string;
  nivel?: 'WARN' | 'ERROR' | 'FATAL';
  stack?: string;
  huella?: string;
  origen?: string;
  ruta?: string;
  metodo?: string;
  statusHttp?: number;
  contexto?: unknown;
  usuarioId?: string;
  requestId?: string;
  ip?: string;
}

/**
 * Módulo de errores globales.
 *
 * Guarda los fallos de toda la aplicación —API, workers y también los que
 * reporten los dos frontends— agrupados por huella: un mismo fallo repetido no
 * crea filas nuevas, incrementa su contador y actualiza la última vez que
 * ocurrió.
 *
 * Regla de oro: registrar un error nunca puede romper la petición. Si la
 * escritura falla (por ejemplo porque la base de datos es justo lo que está
 * caído), se deja constancia en el log del proceso y se sigue adelante.
 */
@Injectable()
export class RegistroErroresService {
  private readonly logger = new Logger(RegistroErroresService.name);

  constructor(private readonly prisma: PrismaService) {}

  async registrar(datos: DatosRegistroError): Promise<void> {
    try {
      const contexto = this.recortar(datos.contexto);

      if (datos.huella) {
        // Se intenta primero agrupar. `updateMany` no falla si no hay nada que
        // actualizar, así se evita una consulta previa de existencia.
        const actualizados = await this.prisma.registroError.updateMany({
          where: { huella: datos.huella, resueltoEn: null },
          data: {
            ocurrencias: { increment: 1 },
            ultimaVezEn: new Date(),
            mensaje: datos.mensaje.slice(0, 4000),
          },
        });
        if (actualizados.count > 0) return;
      }

      await this.prisma.registroError.create({
        data: {
          nivel: datos.nivel ?? (datos.statusHttp && datos.statusHttp >= 500 ? 'ERROR' : 'WARN'),
          codigo: datos.codigo.slice(0, 80),
          mensaje: datos.mensaje.slice(0, 4000),
          stack: datos.stack?.slice(0, 8000),
          huella: datos.huella,
          origen: datos.origen?.slice(0, 20),
          ruta: datos.ruta?.slice(0, 300),
          metodo: datos.metodo?.slice(0, 10),
          statusHttp: datos.statusHttp,
          contexto: (contexto ?? undefined) as Prisma.InputJsonValue | undefined,
          usuarioId: datos.usuarioId,
          requestId: datos.requestId?.slice(0, 40),
          ip: datos.ip?.slice(0, 64),
        },
      });
    } catch (fallo) {
      this.logger.error(
        `No se pudo guardar el error "${datos.codigo}" en la base de datos: ${
          fallo instanceof Error ? fallo.message : String(fallo)
        }`,
      );
    }
  }

  /** Evita que un cuerpo enorme (o con ciclos) infle la tabla. */
  private recortar(valor: unknown): unknown {
    if (valor === undefined || valor === null) return null;
    try {
      const texto = JSON.stringify(valor);
      if (texto.length <= 4000) return valor;
      return { recortado: true, vistaPrevia: texto.slice(0, 4000) };
    } catch {
      return { noSerializable: true };
    }
  }
}
