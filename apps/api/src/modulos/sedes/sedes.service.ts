import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ActualizarSedeDto, CrearSedeDto } from '@cds/shared';
import { PrismaService } from '../../comun/prisma/prisma.service.js';
import { AuditoriaService } from '../../comun/auditoria/auditoria.service.js';
import { ErrorNegocio } from '../../comun/excepciones/error-negocio.js';
import { aSlug } from '../../comun/utilidades/slug.js';
import type { UsuarioAutenticado } from '../../comun/autenticacion/tipos.js';

const INCLUDE_SEDE = {
  horarios: { orderBy: { diaSemana: 'asc' } },
  _count: { select: { usuarios: true } },
} satisfies Prisma.SedeInclude;

@Injectable()
export class SedesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Son tres o cuatro sedes: no hace falta paginar, se devuelven todas. */
  async listar(soloActivas = false) {
    return this.prisma.sede.findMany({
      where: { eliminadoEn: null, ...(soloActivas ? { activa: true } : {}) },
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
      include: INCLUDE_SEDE,
    });
  }

  async obtener(id: string) {
    const sede = await this.prisma.sede.findFirst({
      where: { id, eliminadoEn: null },
      include: INCLUDE_SEDE,
    });
    if (!sede) throw ErrorNegocio.noEncontrado('esa sede');
    return sede;
  }

  async crear(datos: CrearSedeDto, actor: UsuarioAutenticado) {
    const { horarios, mapsUrl, ...resto } = datos;

    const sede = await this.prisma.sede.create({
      data: {
        ...resto,
        mapsUrl: mapsUrl || null,
        slug: await this.slugUnico(datos.nombre),
        horarios: horarios.length > 0 ? { createMany: { data: horarios } } : undefined,
      },
      include: INCLUDE_SEDE,
    });

    await this.auditoria.registrar({
      accion: 'CREAR',
      entidad: 'Sede',
      entidadId: sede.id,
      despues: sede,
      resumen: `Creó la sede "${sede.nombre}" en ${sede.direccion}`,
      actor,
    });

    return sede;
  }

  async actualizar(id: string, datos: ActualizarSedeDto, actor: UsuarioAutenticado) {
    const antes = await this.obtener(id);
    const { horarios, mapsUrl, ...resto } = datos;

    const despues = await this.prisma.$transaction(async (tx) => {
      // El horario de atención se reemplaza entero: la pantalla edita los
      // siete días a la vez, así que un reemplazo es más simple de razonar
      // que un diff por día.
      if (horarios) {
        await tx.sedeHorario.deleteMany({ where: { sedeId: id } });
        if (horarios.length > 0) {
          await tx.sedeHorario.createMany({
            data: horarios.map((h) => ({ ...h, sedeId: id })),
          });
        }
      }

      return tx.sede.update({
        where: { id },
        data: {
          ...resto,
          ...(mapsUrl !== undefined ? { mapsUrl: mapsUrl || null } : {}),
          ...(datos.nombre && datos.nombre !== antes.nombre
            ? { slug: await this.slugUnico(datos.nombre, id) }
            : {}),
        },
        include: INCLUDE_SEDE,
      });
    });

    await this.auditoria.registrarCambio({
      accion: 'ACTUALIZAR',
      entidad: 'Sede',
      entidadId: id,
      antes: antes as unknown as Record<string, unknown>,
      despues: despues as unknown as Record<string, unknown>,
      resumen: `Editó la sede "${antes.nombre}"`,
      actor,
    });

    return despues;
  }

  /**
   * Desactivar una sede.
   *
   * No se permite si tiene citas pendientes: dejarían de ser visibles en la
   * disponibilidad y los clientes se presentarían en un local que el sistema
   * da por cerrado.
   */
  async cambiarEstado(id: string, activa: boolean, actor: UsuarioAutenticado) {
    const sede = await this.obtener(id);

    if (!activa) {
      const pendientes = await this.prisma.reserva.count({
        where: {
          sedeId: id,
          estado: { in: ['PENDIENTE', 'CONFIRMADA', 'EN_CURSO'] },
          inicioEn: { gte: new Date() },
        },
      });

      if (pendientes > 0) {
        throw ErrorNegocio.conflicto(
          'CONFLICTO',
          { reservasPendientes: pendientes },
          `Esta sede tiene ${pendientes} ${pendientes === 1 ? 'cita' : 'citas'} por atender. Muévelas a otra sede o cancélalas antes de desactivarla.`,
        );
      }
    }

    const despues = await this.prisma.sede.update({
      where: { id },
      data: { activa },
      include: INCLUDE_SEDE,
    });

    await this.auditoria.registrar({
      accion: 'ACTUALIZAR',
      entidad: 'Sede',
      entidadId: id,
      antes: { activa: sede.activa },
      despues: { activa },
      resumen: `${activa ? 'Activó' : 'Desactivó'} la sede "${sede.nombre}"`,
      actor,
    });

    return despues;
  }

  /** Barberos que atienden en una sede: alimenta el selector de reservas. */
  async barberosDeLaSede(sedeId: string) {
    return this.prisma.usuario.findMany({
      where: {
        rol: 'BARBERO',
        activo: true,
        eliminadoEn: null,
        OR: [{ sedeId }, { sedesPermitidas: { some: { sedeId } } }],
      },
      select: {
        id: true,
        nombre: true,
        apellido: true,
        alias: true,
        fotoUrl: true,
        slotMinutos: true,
        sedeId: true,
      },
      orderBy: { nombre: 'asc' },
    });
  }

  private async slugUnico(nombre: string, excluirId?: string): Promise<string> {
    const base = aSlug(nombre);
    let candidato = base;
    let sufijo = 2;

    while (true) {
      const existente = await this.prisma.sede.findUnique({
        where: { slug: candidato },
        select: { id: true },
      });
      if (!existente || existente.id === excluirId) return candidato;
      candidato = `${base}-${sufijo++}`;
    }
  }
}
