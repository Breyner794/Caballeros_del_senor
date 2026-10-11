import { Injectable, Logger } from '@nestjs/common';
import { AccionAuditoria, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UsuarioAutenticado } from '../autenticacion/tipos.js';

export interface DatosAuditoria {
  accion: AccionAuditoria;
  entidad: string;
  entidadId?: string | null;
  antes?: unknown;
  despues?: unknown;
  /** Frase legible. Es lo que se lee en la pantalla de auditoría. */
  resumen?: string;
  actor?: UsuarioAutenticado | null;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

/** Campos que nunca se copian a la auditoría. */
const CAMPOS_SENSIBLES = new Set([
  'passwordHash',
  'password',
  'tokenHash',
  'codigoHash',
  'tokenGestion',
  'accessToken',
  'refreshToken',
]);

/**
 * Auditoría: quién hizo qué, cuándo y desde dónde.
 *
 * Se llama de forma explícita desde los servicios en vez de con un interceptor
 * automático, y es una decisión consciente: un interceptor solo sabe "PATCH
 * /reservas/:id devolvió 200". Lo que hace falta cuando hay un desacuerdo es
 * "Laura movió la cita de Juan Pérez del martes 10:00 al miércoles 11:30", y
 * ese resumen solo lo puede escribir el servicio que conoce el caso.
 *
 * Es especialmente importante en dos sitios que el cliente pidió:
 *  · Fidelidad: si un cliente dice que vino 8 veces y el sistema solo tiene 6,
 *    aquí se ve qué barbero registró qué y qué día.
 *  · Walk-ins sin registrar: queda constancia de quién atendió sin crear ficha.
 *
 * La tabla es solo de inserciones: no hay forma de editar ni borrar una
 * entrada desde la aplicación.
 */
@Injectable()
export class AuditoriaService {
  private readonly logger = new Logger(AuditoriaService.name);

  constructor(private readonly prisma: PrismaService) {}

  async registrar(datos: DatosAuditoria): Promise<void> {
    try {
      await this.prisma.auditoria.create({
        data: {
          accion: datos.accion,
          entidad: datos.entidad.slice(0, 60),
          entidadId: datos.entidadId?.slice(0, 64) ?? null,
          usuarioId: datos.actor?.id ?? null,
          usuarioNombre: datos.actor
            ? `${datos.actor.nombre}${datos.actor.apellido ? ` ${datos.actor.apellido}` : ''}`.slice(0, 160)
            : null,
          usuarioRol: datos.actor?.rol ?? null,
          antes: this.limpiar(datos.antes),
          despues: this.limpiar(datos.despues),
          resumen: datos.resumen?.slice(0, 500) ?? null,
          ip: datos.ip?.slice(0, 64) ?? null,
          userAgent: datos.userAgent?.slice(0, 300) ?? null,
          requestId: datos.requestId?.slice(0, 40) ?? null,
        },
      });
    } catch (fallo) {
      // Igual que con el registro de errores: auditar no puede tumbar la
      // operación que el usuario acaba de hacer.
      this.logger.error(
        `No se pudo auditar ${datos.accion} sobre ${datos.entidad}: ${
          fallo instanceof Error ? fallo.message : String(fallo)
        }`,
      );
    }
  }

  /**
   * Compara dos versiones y guarda solo lo que cambió.
   *
   * Guardar el objeto entero en cada edición hace la pantalla de auditoría
   * ilegible: con diez campos iguales y uno distinto, lo que interesa es el
   * distinto.
   */
  async registrarCambio(
    datos: Omit<DatosAuditoria, 'antes' | 'despues'> & {
      antes: Record<string, unknown>;
      despues: Record<string, unknown>;
    },
  ): Promise<void> {
    const antes: Record<string, unknown> = {};
    const despues: Record<string, unknown> = {};

    for (const clave of new Set([...Object.keys(datos.antes), ...Object.keys(datos.despues)])) {
      if (CAMPOS_SENSIBLES.has(clave)) continue;
      const valorAntes = datos.antes[clave];
      const valorDespues = datos.despues[clave];
      if (!this.sonIguales(valorAntes, valorDespues)) {
        antes[clave] = valorAntes;
        despues[clave] = valorDespues;
      }
    }

    if (Object.keys(despues).length === 0) return; // nada cambió: no se audita

    await this.registrar({ ...datos, antes, despues });
  }

  private sonIguales(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    if (a === null || b === null || a === undefined || b === undefined) return false;
    if (typeof a === 'object' || typeof b === 'object') {
      try {
        return JSON.stringify(a) === JSON.stringify(b);
      } catch {
        return false;
      }
    }
    // Los Decimal de Prisma y los números se comparan por su texto.
    return String(a) === String(b);
  }

  private limpiar(valor: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
    if (valor === undefined || valor === null) return Prisma.DbNull;
    if (typeof valor !== 'object') return valor as Prisma.InputJsonValue;

    const recorrer = (entrada: unknown): unknown => {
      if (entrada === null || typeof entrada !== 'object') return entrada;
      if (entrada instanceof Date) return entrada.toISOString();
      if (Array.isArray(entrada)) return entrada.map(recorrer);

      const salida: Record<string, unknown> = {};
      for (const [clave, v] of Object.entries(entrada as Record<string, unknown>)) {
        if (CAMPOS_SENSIBLES.has(clave)) continue;
        // Los Decimal de Prisma se serializan a texto para no perder precisión.
        salida[clave] =
          v !== null && typeof v === 'object' && 'toFixed' in (v as object)
            ? String(v)
            : recorrer(v);
      }
      return salida;
    };

    try {
      return JSON.parse(JSON.stringify(recorrer(valor))) as Prisma.InputJsonValue;
    } catch {
      return Prisma.DbNull;
    }
  }
}
