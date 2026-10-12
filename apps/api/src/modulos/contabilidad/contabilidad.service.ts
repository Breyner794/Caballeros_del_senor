import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../comun/prisma/prisma.service.js';
import { ConfiguracionNegocioService } from '../../comun/configuracion/configuracion-negocio.service.js';
import { ComisionesService } from '../ventas/comisiones.service.js';
import { limitesDelRango } from '../../comun/tiempo/tiempo.js';

export interface FiltrosCierre {
  desde: string;
  hasta: string;
  sedeId?: string;
}

export interface ResumenCierre {
  periodo: { desde: string; hasta: string };
  /** Dinero que de verdad entró a caja. */
  ingresos: number;
  /** Lo que cubrieron los premios de fidelidad: no entró, pero se trabajó. */
  cortesias: number;
  descuentos: number;
  ingresosServicios: number;
  ingresosProductos: number;
  /** Costo de los productos vendidos: lo que hay que restar para el margen. */
  costoProductos: number;
  margenProductos: number;
  comisiones: number;
  /** Lo que queda para el negocio tras pagar a los barberos. */
  paraElNegocio: number;
  totalVentas: number;
  totalCitas: number;
  ticketPromedio: number;
}

@Injectable()
export class ContabilidadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configuracion: ConfiguracionNegocioService,
    private readonly comisiones: ComisionesService,
  ) {}

  private async rango(filtros: FiltrosCierre) {
    const zona = await this.configuracion.zonaHoraria();
    return limitesDelRango(filtros.desde, filtros.hasta, zona);
  }

  private condicion(filtros: FiltrosCierre, inicio: Date, fin: Date): Prisma.VentaWhereInput {
    return {
      fecha: { gte: inicio, lt: fin },
      // Una venta anulada no es un ingreso: se excluye de todo el módulo.
      anuladaEn: null,
      ...(filtros.sedeId ? { sedeId: filtros.sedeId } : {}),
    };
  }

  /**
   * Resumen del periodo.
   *
   * Separa tres cosas que es fácil mezclar y que cuentan distinto:
   *
   *  · **Ingresos**: el dinero que entró a caja.
   *  · **Cortesías**: lo que cubrió un premio de fidelidad. No entró dinero,
   *    pero sí hubo trabajo y sí hubo una silla ocupada. Mezclarlo con los
   *    ingresos infla las cifras; ignorarlo esconde el costo del programa.
   *  · **Comisiones**: lo que se le debe a los barberos, calculado con el
   *    porcentaje que estaba vigente el día de cada venta, no con el de hoy.
   */
  async resumen(filtros: FiltrosCierre): Promise<ResumenCierre> {
    const { inicio, fin } = await this.rango(filtros);
    const where = this.condicion(filtros, inicio, fin);

    const [agregado, items, citas] = await Promise.all([
      this.prisma.venta.aggregate({
        where,
        _sum: {
          total: true,
          totalCortesia: true,
          descuento: true,
          comisionBarbero: true,
        },
        _count: { _all: true },
      }),
      this.prisma.ventaItem.findMany({
        where: { venta: where },
        select: {
          tipo: true,
          subtotal: true,
          cantidad: true,
          costoUnitario: true,
          esCortesia: true,
        },
      }),
      this.prisma.reserva.count({
        where: {
          estado: 'COMPLETADA',
          completadaEn: { gte: inicio, lt: fin },
          ...(filtros.sedeId ? { sedeId: filtros.sedeId } : {}),
        },
      }),
    ]);

    let ingresosServicios = 0;
    let ingresosProductos = 0;
    let costoProductos = 0;

    for (const item of items) {
      const subtotal = Number(item.subtotal);
      if (item.esCortesia) continue; // no entró dinero por esta línea

      if (item.tipo === 'SERVICIO') {
        ingresosServicios += subtotal;
      } else {
        ingresosProductos += subtotal;
        costoProductos += Number(item.costoUnitario ?? 0) * item.cantidad;
      }
    }

    const ingresos = Number(agregado._sum.total ?? 0);
    const cortesias = Number(agregado._sum.totalCortesia ?? 0);
    const comisiones = Number(agregado._sum.comisionBarbero ?? 0);

    return {
      periodo: { desde: filtros.desde, hasta: filtros.hasta },
      ingresos,
      cortesias,
      descuentos: Number(agregado._sum.descuento ?? 0),
      ingresosServicios: Math.round(ingresosServicios),
      ingresosProductos: Math.round(ingresosProductos),
      costoProductos: Math.round(costoProductos),
      margenProductos: Math.round(ingresosProductos - costoProductos),
      comisiones,
      paraElNegocio: Math.round(ingresos - comisiones - costoProductos),
      totalVentas: agregado._count._all,
      totalCitas: citas,
      ticketPromedio:
        agregado._count._all > 0 ? Math.round(ingresos / agregado._count._all) : 0,
    };
  }

  /** Desglose por barbero: la tabla que el contador usa para repartir. */
  async porBarbero(filtros: FiltrosCierre) {
    const { inicio, fin } = await this.rango(filtros);
    const where = this.condicion(filtros, inicio, fin);

    const agrupado = await this.prisma.venta.groupBy({
      by: ['barberoId'],
      where,
      _sum: { total: true, comisionBarbero: true, totalCortesia: true },
      _count: { _all: true },
    });

    const ids = agrupado.map((a) => a.barberoId).filter((id): id is string => id !== null);
    const barberos = await this.prisma.usuario.findMany({
      where: { id: { in: ids } },
      select: { id: true, nombre: true, apellido: true, alias: true, sede: { select: { nombre: true } } },
    });

    const filas = agrupado.map((fila) => {
      const barbero = barberos.find((b) => b.id === fila.barberoId);
      const ingresos = Number(fila._sum.total ?? 0);
      const comision = Number(fila._sum.comisionBarbero ?? 0);

      return {
        barberoId: fila.barberoId,
        nombre: barbero
          ? (barbero.alias ?? `${barbero.nombre} ${barbero.apellido ?? ''}`.trim())
          : 'Sin barbero asignado',
        sede: barbero?.sede?.nombre ?? '—',
        ventas: fila._count._all,
        ingresos,
        cortesias: Number(fila._sum.totalCortesia ?? 0),
        comision,
        paraElNegocio: ingresos - comision,
        /** El porcentaje real resultante, que puede diferir si hubo cortesías. */
        porcentajeEfectivo: ingresos > 0 ? Math.round((comision / ingresos) * 1000) / 10 : 0,
      };
    });

    return filas.sort((a, b) => b.ingresos - a.ingresos);
  }

  async porSede(filtros: Omit<FiltrosCierre, 'sedeId'>) {
    const { inicio, fin } = await this.rango({ ...filtros });

    const agrupado = await this.prisma.venta.groupBy({
      by: ['sedeId'],
      where: { fecha: { gte: inicio, lt: fin }, anuladaEn: null },
      _sum: { total: true, comisionBarbero: true },
      _count: { _all: true },
    });

    const sedes = await this.prisma.sede.findMany({
      where: { id: { in: agrupado.map((a) => a.sedeId) } },
      select: { id: true, nombre: true },
    });

    return agrupado
      .map((fila) => {
        const ingresos = Number(fila._sum.total ?? 0);
        const comision = Number(fila._sum.comisionBarbero ?? 0);
        return {
          sedeId: fila.sedeId,
          nombre: sedes.find((s) => s.id === fila.sedeId)?.nombre ?? '—',
          ventas: fila._count._all,
          ingresos,
          comisiones: comision,
          paraElNegocio: ingresos - comision,
        };
      })
      .sort((a, b) => b.ingresos - a.ingresos);
  }

  /**
   * Evolución diaria del periodo, para el gráfico.
   *
   * Va por SQL directo porque agrupar por día exige convertir el instante a la
   * fecha local del negocio, y eso Prisma no lo expresa: con `groupBy` sobre
   * la columna se agruparía por UTC y las ventas de la noche caerían en el día
   * siguiente.
   */
  async evolucionDiaria(filtros: FiltrosCierre) {
    const { inicio, fin } = await this.rango(filtros);
    const zona = await this.configuracion.zonaHoraria();

    const filas = await this.prisma.$queryRaw<
      { dia: string; ingresos: number; comisiones: number; ventas: bigint }[]
    >`
      SELECT to_char((v.fecha AT TIME ZONE 'UTC' AT TIME ZONE ${zona})::date, 'YYYY-MM-DD') AS dia,
             COALESCE(sum(v.total), 0)::float8 AS ingresos,
             COALESCE(sum(v."comisionBarbero"), 0)::float8 AS comisiones,
             count(*) AS ventas
      FROM ventas v
      WHERE v.fecha >= ${inicio} AND v.fecha < ${fin}
        AND v."anuladaEn" IS NULL
        ${filtros.sedeId ? Prisma.sql`AND v."sedeId" = ${filtros.sedeId}::uuid` : Prisma.empty}
      GROUP BY 1
      ORDER BY 1
    `;

    return filas.map((f) => ({
      dia: f.dia,
      ingresos: Math.round(f.ingresos),
      comisiones: Math.round(f.comisiones),
      ventas: Number(f.ventas),
    }));
  }

  /** Qué servicios dan el dinero: para decidir precios y promociones. */
  async porServicio(filtros: FiltrosCierre) {
    const { inicio, fin } = await this.rango(filtros);

    const items = await this.prisma.ventaItem.findMany({
      where: {
        tipo: 'SERVICIO',
        venta: this.condicion(filtros, inicio, fin),
      },
      select: { nombre: true, subtotal: true, esCortesia: true },
    });

    const mapa = new Map<string, { veces: number; ingresos: number; cortesias: number }>();

    for (const item of items) {
      const actual = mapa.get(item.nombre) ?? { veces: 0, ingresos: 0, cortesias: 0 };
      actual.veces += 1;
      if (item.esCortesia) actual.cortesias += 1;
      else actual.ingresos += Number(item.subtotal);
      mapa.set(item.nombre, actual);
    }

    return [...mapa.entries()]
      .map(([nombre, datos]) => ({ nombre, ...datos, ingresos: Math.round(datos.ingresos) }))
      .sort((a, b) => b.ingresos - a.ingresos);
  }

  /**
   * Simulador de reparto: la «calculadora» que pidió el cliente.
   *
   * Recalcula el periodo con porcentajes hipotéticos **sin guardar nada**, para
   * poder responder a «¿y si a Andrés le subo al 55%?» antes de decidir. Los
   * datos reales no se tocan: cambiar el reparto de verdad se hace en el
   * módulo de comisiones y rige desde la fecha que se indique en adelante.
   */
  async simularReparto(
    filtros: FiltrosCierre,
    porcentajes: { barberoId: string; porcentaje: number }[],
  ) {
    const actual = await this.porBarbero(filtros);
    const mapa = new Map(porcentajes.map((p) => [p.barberoId, p.porcentaje]));

    const filas = actual.map((fila) => {
      const nuevoPorcentaje = fila.barberoId ? mapa.get(fila.barberoId) : undefined;
      if (nuevoPorcentaje === undefined) {
        return { ...fila, porcentajeSimulado: fila.porcentajeEfectivo, comisionSimulada: fila.comision, diferencia: 0 };
      }

      // La base es lo que entró a caja: las cortesías no se comisionan.
      const comisionSimulada = Math.round((fila.ingresos * nuevoPorcentaje) / 100);
      return {
        ...fila,
        porcentajeSimulado: nuevoPorcentaje,
        comisionSimulada,
        diferencia: comisionSimulada - fila.comision,
      };
    });

    const totalActual = filas.reduce((s, f) => s + f.comision, 0);
    const totalSimulado = filas.reduce((s, f) => s + f.comisionSimulada, 0);
    const ingresos = filas.reduce((s, f) => s + f.ingresos, 0);

    return {
      filas,
      totales: {
        ingresos,
        comisionActual: totalActual,
        comisionSimulada: totalSimulado,
        diferencia: totalSimulado - totalActual,
        paraElNegocioActual: ingresos - totalActual,
        paraElNegocioSimulado: ingresos - totalSimulado,
      },
    };
  }

  /** Porcentajes vigentes, para precargar la calculadora. */
  comisionesVigentes() {
    return this.comisiones.listarVigentes();
  }

  /**
   * Detalle de ventas para exportar.
   *
   * Paginado con límite alto: el contador se lleva el mes entero, pero aun así
   * no se trae la tabla completa de una vez.
   */
  async detalleVentas(filtros: FiltrosCierre & { pagina: number; limite: number }) {
    const { inicio, fin } = await this.rango(filtros);
    const where = this.condicion(filtros, inicio, fin);
    const take = Math.min(filtros.limite, 1000);
    const skip = (Math.max(1, filtros.pagina) - 1) * take;

    const [datos, total] = await this.prisma.$transaction([
      this.prisma.venta.findMany({
        where,
        skip,
        take,
        orderBy: { fecha: 'desc' },
        select: {
          id: true,
          numero: true,
          fecha: true,
          total: true,
          descuento: true,
          totalCortesia: true,
          metodoPago: true,
          comisionBarbero: true,
          porcentajeComision: true,
          sede: { select: { nombre: true } },
          barbero: { select: { nombre: true, alias: true } },
          cliente: { select: { nombreCompleto: true } },
          items: { select: { tipo: true, nombre: true, cantidad: true, subtotal: true, esCortesia: true } },
        },
      }),
      this.prisma.venta.count({ where }),
    ]);

    return { datos, total, pagina: filtros.pagina, limite: take };
  }
}
