import { Injectable } from '@nestjs/common';
import { Prisma, type AccionAuditoria, type NivelError } from '@prisma/client';
import { calcularSalto, construirMeta, type PaginaRespuesta } from '@cds/shared';
import { PrismaService } from '../../comun/prisma/prisma.service.js';
import { ErrorNegocio } from '../../comun/excepciones/error-negocio.js';
import { limitesDelRango } from '../../comun/tiempo/tiempo.js';
import { ConfiguracionNegocioService } from '../../comun/configuracion/configuracion-negocio.service.js';
import type { UsuarioAutenticado } from '../../comun/autenticacion/tipos.js';

/**
 * Consulta de la auditoría y del registro de errores.
 *
 * Es deliberadamente de solo lectura: no hay forma de editar ni borrar una
 * entrada desde la aplicación, porque un registro que se puede alterar no
 * sirve para lo que existe — resolver un «yo no fui» o un «el cliente dice que
 * vino ocho veces».
 *
 * Lo único que se puede escribir es marcar un error como resuelto, que no
 * toca el hecho registrado sino su seguimiento.
 */
@Injectable()
export class AuditoriaConsultaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configuracion: ConfiguracionNegocioService,
  ) {}

  async listar(filtros: {
    pagina: number;
    limite: number;
    usuarioId?: string;
    entidad?: string;
    entidadId?: string;
    accion?: AccionAuditoria;
    desde?: string;
    hasta?: string;
    buscar?: string;
  }): Promise<PaginaRespuesta<Prisma.AuditoriaGetPayload<object>>> {
    const { skip, take, pagina, limite } = calcularSalto(filtros.pagina, filtros.limite);
    const zona = await this.configuracion.zonaHoraria();

    const where: Prisma.AuditoriaWhereInput = {
      ...(filtros.usuarioId ? { usuarioId: filtros.usuarioId } : {}),
      ...(filtros.entidad ? { entidad: filtros.entidad } : {}),
      ...(filtros.entidadId ? { entidadId: filtros.entidadId } : {}),
      ...(filtros.accion ? { accion: filtros.accion } : {}),
      // El resumen está escrito en lenguaje natural justamente para poder
      // buscar aquí lo que uno recuerda: un nombre, un código de reserva.
      ...(filtros.buscar
        ? {
            OR: [
              { resumen: { contains: filtros.buscar, mode: 'insensitive' } },
              { usuarioNombre: { contains: filtros.buscar, mode: 'insensitive' } },
              { entidadId: { contains: filtros.buscar } },
            ],
          }
        : {}),
    };

    if (filtros.desde || filtros.hasta) {
      const { inicio, fin } = limitesDelRango(
        filtros.desde ?? filtros.hasta!,
        filtros.hasta ?? filtros.desde!,
        zona,
      );
      where.creadoEn = { gte: inicio, lt: fin };
    }

    const [datos, total] = await this.prisma.$transaction([
      this.prisma.auditoria.findMany({
        where,
        skip,
        take,
        orderBy: { creadoEn: 'desc' },
      }),
      this.prisma.auditoria.count({ where }),
    ]);

    return { datos, meta: construirMeta(total, pagina, limite) };
  }

  /**
   * Todo lo que pasó con un registro concreto.
   *
   * Es la vista que de verdad se usa: abrir una reserva o una ficha de cliente
   * y ver su historia completa, en orden, con quién hizo cada cosa.
   */
  async historialDe(entidad: string, entidadId: string) {
    return this.prisma.auditoria.findMany({
      where: { entidad, entidadId },
      orderBy: { creadoEn: 'asc' },
      take: 200,
    });
  }

  /** Acciones disponibles para el desplegable de filtros. */
  async accionesUsadas(): Promise<{ accion: AccionAuditoria; veces: number }[]> {
    const filas = await this.prisma.auditoria.groupBy({
      by: ['accion'],
      _count: { accion: true },
      orderBy: { _count: { accion: 'desc' } },
    });
    return filas.map((f) => ({ accion: f.accion, veces: f._count.accion }));
  }

  // ========================= REGISTRO DE ERRORES ===========================

  async errores(filtros: {
    pagina: number;
    limite: number;
    nivel?: NivelError;
    resueltos?: boolean;
    buscar?: string;
  }) {
    const { skip, take, pagina, limite } = calcularSalto(filtros.pagina, filtros.limite);

    const where: Prisma.RegistroErrorWhereInput = {
      ...(filtros.nivel ? { nivel: filtros.nivel } : {}),
      ...(filtros.resueltos === true ? { resueltoEn: { not: null } } : {}),
      ...(filtros.resueltos === false ? { resueltoEn: null } : {}),
      ...(filtros.buscar
        ? {
            OR: [
              { codigo: { contains: filtros.buscar, mode: 'insensitive' } },
              { mensaje: { contains: filtros.buscar, mode: 'insensitive' } },
              { ruta: { contains: filtros.buscar, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [datos, total] = await this.prisma.$transaction([
      this.prisma.registroError.findMany({
        where,
        skip,
        take,
        // Por ocurrencias y no solo por fecha: un fallo que ha pasado 1.200
        // veces importa más que uno que pasó una vez hace cinco minutos.
        orderBy: [{ resueltoEn: 'asc' }, { ultimaVezEn: 'desc' }],
        select: {
          id: true,
          nivel: true,
          codigo: true,
          mensaje: true,
          ocurrencias: true,
          origen: true,
          ruta: true,
          metodo: true,
          statusHttp: true,
          primeraVezEn: true,
          ultimaVezEn: true,
          resueltoEn: true,
          notas: true,
          usuario: { select: { id: true, nombre: true } },
        },
      }),
      this.prisma.registroError.count({ where }),
    ]);

    return { datos, meta: construirMeta(total, pagina, limite) };
  }

  async detalleError(id: string) {
    const error = await this.prisma.registroError.findUnique({
      where: { id },
      include: { usuario: { select: { id: true, nombre: true, email: true } } },
    });
    if (!error) throw ErrorNegocio.noEncontrado('ese error');
    return error;
  }

  /** Marcar como resuelto: no borra nada, solo deja de aparecer en pendientes. */
  async marcarResuelto(id: string, resuelto: boolean, notas: string | undefined, actor: UsuarioAutenticado) {
    const actualizado = await this.prisma.registroError.update({
      where: { id },
      data: {
        resueltoEn: resuelto ? new Date() : null,
        notas: notas ?? undefined,
      },
    });

    await this.prisma.auditoria.create({
      data: {
        accion: 'ACTUALIZAR',
        entidad: 'RegistroError',
        entidadId: id,
        usuarioId: actor.id,
        usuarioNombre: actor.nombre,
        usuarioRol: actor.rol,
        resumen: `${resuelto ? 'Marcó como resuelto' : 'Reabrió'} el error ${actualizado.codigo}`,
      },
    });

    return actualizado;
  }

  /** Resumen para la cabecera del módulo. */
  async resumenErrores() {
    const [sinResolver, ultimas24h, masFrecuente] = await Promise.all([
      this.prisma.registroError.count({ where: { resueltoEn: null } }),
      this.prisma.registroError.count({
        where: { ultimaVezEn: { gte: new Date(Date.now() - 86_400_000) } },
      }),
      this.prisma.registroError.findFirst({
        where: { resueltoEn: null },
        orderBy: { ocurrencias: 'desc' },
        select: { codigo: true, ocurrencias: true, ruta: true },
      }),
    ]);

    return { sinResolver, ultimas24h, masFrecuente };
  }
}
