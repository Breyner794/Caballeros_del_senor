import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../comun/prisma/prisma.service.js';
import { AuditoriaService } from '../../comun/auditoria/auditoria.service.js';
import { ErrorNegocio } from '../../comun/excepciones/error-negocio.js';
import type { UsuarioAutenticado } from '../../comun/autenticacion/tipos.js';

export interface ComisionCalculada {
  porcentaje: Prisma.Decimal;
  porcentajeProducto: Prisma.Decimal;
  importe: Prisma.Decimal;
  importeServicios: Prisma.Decimal;
  importeProductos: Prisma.Decimal;
  /** De dónde salió el porcentaje: útil para explicarlo en el panel. */
  origen: 'USUARIO' | 'SEDE' | 'GLOBAL' | 'NINGUNO';
}

/**
 * Comisiones de los barberos.
 *
 * El porcentaje se resuelve en cascada, de lo más específico a lo más general:
 *
 *   barbero concreto → sede → global → 0%
 *
 * Y siempre acotado a una **vigencia**. Esto es lo que hace que el módulo del
 * contador sea un libro y no una calculadora: cambiar el reparto de un barbero
 * no reescribe el pasado, porque se cierra el periodo anterior y se abre uno
 * nuevo. El cierre de febrero sigue dando lo mismo en diciembre.
 *
 * La base de datos refuerza la regla con una restricción de exclusión: un
 * mismo barbero no puede tener dos porcentajes vigentes a la vez, porque
 * entonces el cálculo dependería del orden en que se leyeran las filas.
 */
@Injectable()
export class ComisionesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Porcentaje aplicable a un barbero en una fecha, resolviendo la cascada. */
  async vigente(
    db: Prisma.TransactionClient | PrismaService,
    opciones: { barberoId: string; sedeId: string; fecha: Date; servicioId?: string },
  ): Promise<{ porcentaje: Prisma.Decimal; porcentajeProducto: Prisma.Decimal; origen: ComisionCalculada['origen'] }> {
    const fecha = new Date(opciones.fecha.toISOString().slice(0, 10) + 'T00:00:00.000Z');

    const vigencia = {
      vigenteDesde: { lte: fecha },
      OR: [{ vigenteHasta: null }, { vigenteHasta: { gte: fecha } }],
    };

    // 1. Porcentaje del barbero (y, si existe, el específico de un servicio).
    if (opciones.servicioId) {
      const porServicio = await db.configComision.findFirst({
        where: {
          alcance: 'USUARIO',
          usuarioId: opciones.barberoId,
          servicioId: opciones.servicioId,
          ...vigencia,
        },
        orderBy: { vigenteDesde: 'desc' },
      });
      if (porServicio) {
        return {
          porcentaje: porServicio.porcentaje,
          porcentajeProducto: porServicio.porcentajeProducto ?? new Prisma.Decimal(0),
          origen: 'USUARIO',
        };
      }
    }

    const delUsuario = await db.configComision.findFirst({
      where: { alcance: 'USUARIO', usuarioId: opciones.barberoId, servicioId: null, ...vigencia },
      orderBy: { vigenteDesde: 'desc' },
    });
    if (delUsuario) {
      return {
        porcentaje: delUsuario.porcentaje,
        porcentajeProducto: delUsuario.porcentajeProducto ?? new Prisma.Decimal(0),
        origen: 'USUARIO',
      };
    }

    // 2. Porcentaje por defecto de la sede.
    const deLaSede = await db.configComision.findFirst({
      where: { alcance: 'SEDE', sedeId: opciones.sedeId, ...vigencia },
      orderBy: { vigenteDesde: 'desc' },
    });
    if (deLaSede) {
      return {
        porcentaje: deLaSede.porcentaje,
        porcentajeProducto: deLaSede.porcentajeProducto ?? new Prisma.Decimal(0),
        origen: 'SEDE',
      };
    }

    // 3. Porcentaje global del negocio.
    const global = await db.configComision.findFirst({
      where: { alcance: 'GLOBAL', ...vigencia },
      orderBy: { vigenteDesde: 'desc' },
    });
    if (global) {
      return {
        porcentaje: global.porcentaje,
        porcentajeProducto: global.porcentajeProducto ?? new Prisma.Decimal(0),
        origen: 'GLOBAL',
      };
    }

    // 4. Sin configuración: 0%. Es mejor que suponer un número.
    return {
      porcentaje: new Prisma.Decimal(0),
      porcentajeProducto: new Prisma.Decimal(0),
      origen: 'NINGUNO',
    };
  }

  /**
   * Importe de comisión de una venta.
   *
   * Las cortesías del programa de fidelidad quedan fuera de la base: el corte
   * gratis no entró a caja, así que no se comisiona sobre dinero que nadie
   * pagó. Quien llama se encarga de excluirlas al pasar `baseServicios`.
   */
  async calcular(
    db: Prisma.TransactionClient | PrismaService,
    opciones: {
      barberoId: string;
      sedeId: string;
      fecha: Date;
      baseServicios: Prisma.Decimal;
      baseProductos: Prisma.Decimal;
    },
  ): Promise<ComisionCalculada> {
    const { porcentaje, porcentajeProducto, origen } = await this.vigente(db, opciones);

    const importeServicios = opciones.baseServicios
      .times(porcentaje)
      .dividedBy(100)
      .toDecimalPlaces(2);
    const importeProductos = opciones.baseProductos
      .times(porcentajeProducto)
      .dividedBy(100)
      .toDecimalPlaces(2);

    return {
      porcentaje,
      porcentajeProducto,
      importeServicios,
      importeProductos,
      importe: importeServicios.plus(importeProductos),
      origen,
    };
  }

  /** Porcentajes vigentes de todos los barberos: la tabla del contador. */
  async listarVigentes(fecha = new Date()) {
    const dia = new Date(fecha.toISOString().slice(0, 10) + 'T00:00:00.000Z');

    const barberos = await this.prisma.usuario.findMany({
      where: { rol: 'BARBERO', activo: true, eliminadoEn: null },
      select: {
        id: true,
        nombre: true,
        apellido: true,
        alias: true,
        sedeId: true,
        sede: { select: { id: true, nombre: true } },
      },
      orderBy: { nombre: 'asc' },
    });

    return Promise.all(
      barberos.map(async (barbero) => {
        const comision = await this.vigente(this.prisma, {
          barberoId: barbero.id,
          sedeId: barbero.sedeId ?? '',
          fecha: dia,
        });
        return {
          barberoId: barbero.id,
          nombre: `${barbero.nombre}${barbero.apellido ? ` ${barbero.apellido}` : ''}`,
          alias: barbero.alias,
          sede: barbero.sede,
          porcentaje: Number(comision.porcentaje),
          porcentajeProducto: Number(comision.porcentajeProducto),
          origen: comision.origen,
        };
      }),
    );
  }

  /**
   * Fija un porcentaje nuevo para un barbero.
   *
   * No edita el registro anterior: lo cierra el día antes de que empiece el
   * nuevo y crea uno. Así el histórico queda intacto y los cierres ya emitidos
   * no se mueven.
   */
  async fijarParaBarbero(
    datos: {
      barberoId: string;
      porcentaje: number;
      porcentajeProducto?: number;
      vigenteDesde: string;
      notas?: string;
    },
    actor: UsuarioAutenticado,
  ) {
    const barbero = await this.prisma.usuario.findFirst({
      where: { id: datos.barberoId, rol: 'BARBERO', eliminadoEn: null },
      select: { id: true, nombre: true, alias: true },
    });
    if (!barbero) throw ErrorNegocio.noEncontrado('ese barbero');

    const desde = new Date(`${datos.vigenteDesde}T00:00:00.000Z`);
    const diaAnterior = new Date(desde.getTime() - 86_400_000);

    const resultado = await this.prisma.$transaction(async (tx) => {
      const anterior = await tx.configComision.findFirst({
        where: {
          alcance: 'USUARIO',
          usuarioId: datos.barberoId,
          servicioId: null,
          vigenteHasta: null,
        },
        orderBy: { vigenteDesde: 'desc' },
      });

      if (anterior) {
        if (anterior.vigenteDesde >= desde) {
          throw ErrorNegocio.conflicto(
            'COMISION_SOLAPADA',
            { vigenteDesde: anterior.vigenteDesde },
            `Ya hay un porcentaje para este barbero desde el ${anterior.vigenteDesde.toISOString().slice(0, 10)}. La nueva vigencia tiene que empezar después.`,
          );
        }
        await tx.configComision.update({
          where: { id: anterior.id },
          data: { vigenteHasta: diaAnterior },
        });
      }

      return tx.configComision.create({
        data: {
          alcance: 'USUARIO',
          usuarioId: datos.barberoId,
          porcentaje: new Prisma.Decimal(datos.porcentaje),
          porcentajeProducto:
            datos.porcentajeProducto !== undefined
              ? new Prisma.Decimal(datos.porcentajeProducto)
              : (anterior?.porcentajeProducto ?? null),
          vigenteDesde: desde,
          notas: datos.notas,
          creadoPorId: actor.id,
        },
      });
    });

    await this.auditoria.registrar({
      accion: 'ACTUALIZAR',
      entidad: 'ConfigComision',
      entidadId: resultado.id,
      despues: { porcentaje: datos.porcentaje, vigenteDesde: datos.vigenteDesde },
      resumen: `Fijó la comisión de ${barbero.alias ?? barbero.nombre} en ${datos.porcentaje}% desde el ${datos.vigenteDesde}`,
      actor,
    });

    return resultado;
  }

  /** Histórico de porcentajes de un barbero. */
  async historial(barberoId: string) {
    return this.prisma.configComision.findMany({
      where: { alcance: 'USUARIO', usuarioId: barberoId },
      orderBy: { vigenteDesde: 'desc' },
      include: { creadoPor: { select: { nombre: true } }, servicio: { select: { nombre: true } } },
    });
  }
}
