import { Injectable } from '@nestjs/common';
import { Prisma, type MetodoPago } from '@prisma/client';
import { CODIGOS_ERROR } from '@cds/shared';
import { PrismaService } from '../../comun/prisma/prisma.service.js';
import { ErrorNegocio } from '../../comun/excepciones/error-negocio.js';
import { ComisionesService } from './comisiones.service.js';

interface ServicioVendido {
  servicioId: string;
  nombre: string;
  precio: Prisma.Decimal;
  esCortesia: boolean;
}

interface ProductoVendido {
  productoId: string;
  cantidad: number;
  precioUnitario?: number;
}

/**
 * Ventas: la única puerta por la que entra dinero al sistema.
 *
 * Tanto el cobro de una cita como la venta de un producto en el mostrador
 * terminan aquí, en la misma tabla. Es lo que permite que el contador tenga
 * una sola fuente en lugar de cruzar reservas con ventas de productos y rezar
 * para que cuadren.
 *
 * Dos cosas se congelan al cerrar la venta y no se recalculan nunca:
 *
 *  · El **porcentaje de comisión** y su importe. Si en marzo se le sube la
 *    comisión a un barbero, el cierre de febrero tiene que seguir dando el
 *    mismo número. Recalcular desde la configuración actual haría que los
 *    informes cambiaran solos.
 *  · El **costo del producto** en el momento de venderlo, para poder calcular
 *    el margen real y no uno inventado con el costo de la última compra.
 */
@Injectable()
export class VentasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly comisiones: ComisionesService,
  ) {}

  /**
   * Registra la venta de una cita completada.
   *
   * Se ejecuta dentro de la transacción que completa la reserva: si algo falla
   * (por ejemplo, que no haya stock del producto que el cliente se lleva), no
   * queda ni la venta a medias ni la reserva cobrada.
   */
  async registrarDesdeReserva(
    tx: Prisma.TransactionClient,
    datos: {
      reservaId: string;
      sedeId: string;
      barberoId: string;
      clienteId: string | null;
      servicios: ServicioVendido[];
      productos: ProductoVendido[];
      descuento: Prisma.Decimal;
      totalCortesia: Prisma.Decimal;
      metodoPago: MetodoPago | string;
      registradoPorId: string;
    },
  ) {
    const items: Prisma.VentaItemCreateManyVentaInput[] = [];
    let subtotal = new Prisma.Decimal(0);

    // --- Servicios -------------------------------------------------------
    for (const servicio of datos.servicios) {
      items.push({
        tipo: 'SERVICIO',
        referenciaId: servicio.servicioId,
        nombre: servicio.nombre,
        cantidad: 1,
        precioUnitario: servicio.precio,
        subtotal: servicio.precio,
        esCortesia: servicio.esCortesia,
      });
      subtotal = subtotal.plus(servicio.precio);
    }

    // --- Productos -------------------------------------------------------
    const productosResueltos: {
      producto: { id: string; nombre: string; precioVenta: Prisma.Decimal; costoUnitario: Prisma.Decimal; esVendible: boolean };
      cantidad: number;
      precio: Prisma.Decimal;
    }[] = [];

    if (datos.productos.length > 0) {
      const ids = datos.productos.map((p) => p.productoId);
      const encontrados = await tx.producto.findMany({
        where: { id: { in: ids }, eliminadoEn: null },
        select: {
          id: true,
          nombre: true,
          precioVenta: true,
          costoUnitario: true,
          esVendible: true,
        },
      });

      for (const pedido of datos.productos) {
        const producto = encontrados.find((p) => p.id === pedido.productoId);
        if (!producto) throw ErrorNegocio.noEncontrado('alguno de los productos seleccionados');
        if (!producto.esVendible) {
          throw new ErrorNegocio(CODIGOS_ERROR.PRODUCTO_NO_VENDIBLE, 409, {
            producto: producto.nombre,
          });
        }

        const precio =
          pedido.precioUnitario !== undefined
            ? new Prisma.Decimal(pedido.precioUnitario)
            : producto.precioVenta;
        const importe = precio.times(pedido.cantidad);

        items.push({
          tipo: 'PRODUCTO',
          referenciaId: producto.id,
          nombre: producto.nombre,
          cantidad: pedido.cantidad,
          precioUnitario: precio,
          subtotal: importe,
          costoUnitario: producto.costoUnitario,
        });

        subtotal = subtotal.plus(importe);
        productosResueltos.push({ producto, cantidad: pedido.cantidad, precio });
      }
    }

    const total = Prisma.Decimal.max(
      new Prisma.Decimal(0),
      subtotal.minus(datos.descuento).minus(datos.totalCortesia),
    );

    // --- Comisión, congelada -------------------------------------------
    const comision = await this.comisiones.calcular(tx, {
      barberoId: datos.barberoId,
      sedeId: datos.sedeId,
      fecha: new Date(),
      baseServicios: datos.servicios
        .filter((s) => !s.esCortesia)
        .reduce((suma, s) => suma.plus(s.precio), new Prisma.Decimal(0)),
      baseProductos: productosResueltos.reduce(
        (suma, p) => suma.plus(p.precio.times(p.cantidad)),
        new Prisma.Decimal(0),
      ),
    });

    const venta = await tx.venta.create({
      data: {
        numero: await this.siguienteNumero(tx),
        sedeId: datos.sedeId,
        barberoId: datos.barberoId,
        clienteId: datos.clienteId,
        reservaId: datos.reservaId,
        subtotal,
        descuento: datos.descuento,
        total,
        totalCortesia: datos.totalCortesia,
        metodoPago: datos.metodoPago as MetodoPago,
        comisionBarbero: comision.importe,
        porcentajeComision: comision.porcentaje,
        registradoPorId: datos.registradoPorId,
        items: { createMany: { data: items } },
      },
      include: { items: true },
    });

    // --- Stock -----------------------------------------------------------
    // El descuento de stock va después de crear la venta porque cada
    // movimiento apunta al item que lo originó. Si el stock no alcanza, la
    // restricción `producto_stock_no_negativo` aborta toda la transacción.
    for (const vendido of productosResueltos) {
      const item = venta.items.find(
        (i) => i.tipo === 'PRODUCTO' && i.referenciaId === vendido.producto.id,
      );
      await this.descontarStock(tx, {
        productoId: vendido.producto.id,
        sedeId: datos.sedeId,
        cantidad: vendido.cantidad,
        precioUnitario: vendido.precio,
        costoUnitario: vendido.producto.costoUnitario,
        ventaItemId: item?.id,
        registradoPorId: datos.registradoPorId,
      });
    }

    return venta;
  }

  /**
   * Consecutivo legible: V-2026-000123.
   *
   * Se calcula dentro de la transacción a partir del último del año. Con el
   * volumen de una barbería (decenas de ventas al día) el riesgo de colisión
   * es irrelevante, y si llegara a ocurrir, el índice único del campo la
   * rechazaría en lugar de duplicar el número.
   */
  private async siguienteNumero(tx: Prisma.TransactionClient): Promise<string> {
    const anio = new Date().getFullYear();
    const prefijo = `V-${anio}-`;

    const ultima = await tx.venta.findFirst({
      where: { numero: { startsWith: prefijo } },
      orderBy: { numero: 'desc' },
      select: { numero: true },
    });

    const siguiente = ultima ? Number(ultima.numero.slice(prefijo.length)) + 1 : 1;
    return `${prefijo}${String(siguiente).padStart(6, '0')}`;
  }

  /** Movimiento de salida por venta, con el stock resultante para auditar. */
  private async descontarStock(
    tx: Prisma.TransactionClient,
    datos: {
      productoId: string;
      sedeId: string;
      cantidad: number;
      precioUnitario: Prisma.Decimal;
      costoUnitario: Prisma.Decimal;
      ventaItemId?: string;
      registradoPorId: string;
    },
  ): Promise<void> {
    // Se asegura la fila de stock de esa sede sin tocar la cantidad.
    await tx.productoStock.upsert({
      where: { productoId_sedeId: { productoId: datos.productoId, sedeId: datos.sedeId } },
      update: {},
      create: { productoId: datos.productoId, sedeId: datos.sedeId, cantidad: 0 },
    });

    // El descuento lleva la condición "hay suficiente" dentro del propio
    // UPDATE. Comprobar antes y restar después deja una ventana en la que dos
    // ventas simultáneas del último frasco pasan las dos la comprobación; así,
    // la segunda no actualiza ninguna fila y lo sabemos por el contador.
    const actualizados = await tx.productoStock.updateMany({
      where: {
        productoId: datos.productoId,
        sedeId: datos.sedeId,
        cantidad: { gte: datos.cantidad },
      },
      data: { cantidad: { decrement: datos.cantidad } },
    });

    if (actualizados.count === 0) {
      const [producto, stock] = await Promise.all([
        tx.producto.findUnique({
          where: { id: datos.productoId },
          select: { nombre: true },
        }),
        tx.productoStock.findUnique({
          where: { productoId_sedeId: { productoId: datos.productoId, sedeId: datos.sedeId } },
          select: { cantidad: true },
        }),
      ]);

      throw new ErrorNegocio(CODIGOS_ERROR.STOCK_INSUFICIENTE, 409, {
        producto: producto?.nombre,
        disponible: stock?.cantidad ?? 0,
        solicitado: datos.cantidad,
      });
    }

    const stockFinal = await tx.productoStock.findUniqueOrThrow({
      where: { productoId_sedeId: { productoId: datos.productoId, sedeId: datos.sedeId } },
      select: { cantidad: true },
    });
    const resultante = stockFinal.cantidad;

    await tx.movimientoInventario.create({
      data: {
        productoId: datos.productoId,
        sedeId: datos.sedeId,
        tipo: 'VENTA',
        cantidad: datos.cantidad,
        stockResultante: resultante,
        costoUnitario: datos.costoUnitario,
        precioUnitario: datos.precioUnitario,
        total: datos.precioUnitario.times(datos.cantidad),
        ventaItemId: datos.ventaItemId,
        registradoPorId: datos.registradoPorId,
      },
    });
  }
}
