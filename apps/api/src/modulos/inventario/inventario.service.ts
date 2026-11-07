import { Injectable } from '@nestjs/common';
import { Prisma, type TipoMovimientoInventario } from '@prisma/client';
import { CODIGOS_ERROR, calcularSalto, construirMeta } from '@cds/shared';
import { PrismaService } from '../../comun/prisma/prisma.service.js';
import { AuditoriaService } from '../../comun/auditoria/auditoria.service.js';
import { ErrorNegocio } from '../../comun/excepciones/error-negocio.js';
import { aSlug } from '../../comun/utilidades/slug.js';
import { limitesDelRango } from '../../comun/tiempo/tiempo.js';
import { ConfiguracionNegocioService } from '../../comun/configuracion/configuracion-negocio.service.js';
import type { UsuarioAutenticado } from '../../comun/autenticacion/tipos.js';

export interface DatosProducto {
  nombre: string;
  descripcion?: string;
  marca?: string;
  sku?: string;
  codigoBarras?: string;
  categoriaId?: string;
  costoUnitario: number;
  precioVenta: number;
  unidadMedida?: string;
  esVendible: boolean;
  stockMinimo: number;
  activo?: boolean;
  proveedorId?: string;
}

export interface DatosMovimiento {
  productoId: string;
  sedeId: string;
  tipo: TipoMovimientoInventario;
  cantidad: number;
  costoUnitario?: number;
  precioUnitario?: number;
  proveedorId?: string;
  documento?: string;
  motivo?: string;
}

/**
 * Inventario.
 *
 * Dos ideas gobiernan este módulo:
 *
 *  1. El **stock es por sede**. Un frasco de cera en el Centro no sirve para
 *     vender en el Norte, y el contador necesita saber dónde está la mercancía.
 *  2. Los movimientos son un **libro de solo inserción**. Un movimiento pasado
 *     no se edita nunca: si el conteo físico no cuadra, se registra un AJUSTE
 *     con su motivo. Es lo que hace el inventario auditable — con ediciones,
 *     la diferencia entre «se vendió» y «alguien corrigió el número» se pierde.
 *
 * El stock vive en `ProductoStock` como valor acumulado, y cada movimiento
 * guarda además el `stockResultante`. Esa redundancia es deliberada: permite
 * reconstruir y verificar el histórico sin recalcular desde el principio.
 */
@Injectable()
export class InventarioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly configuracion: ConfiguracionNegocioService,
  ) {}

  // ============================== PRODUCTOS ================================

  async listarProductos(filtros: {
    pagina: number;
    limite: number;
    buscar?: string;
    categoriaId?: string;
    sedeId?: string;
    soloBajoMinimo?: boolean;
    activo?: boolean;
  }) {
    const { skip, take, pagina, limite } = calcularSalto(filtros.pagina, filtros.limite);

    const where: Prisma.ProductoWhereInput = {
      eliminadoEn: null,
      ...(filtros.activo !== undefined ? { activo: filtros.activo } : {}),
      ...(filtros.categoriaId ? { categoriaId: filtros.categoriaId } : {}),
      ...(filtros.buscar
        ? {
            OR: [
              { nombre: { contains: filtros.buscar, mode: 'insensitive' } },
              { marca: { contains: filtros.buscar, mode: 'insensitive' } },
              { sku: { contains: filtros.buscar, mode: 'insensitive' } },
              { codigoBarras: { contains: filtros.buscar } },
            ],
          }
        : {}),
    };

    const [productos, total] = await this.prisma.$transaction([
      this.prisma.producto.findMany({
        where,
        skip,
        take,
        orderBy: { nombre: 'asc' },
        include: {
          categoria: { select: { id: true, nombre: true } },
          proveedor: { select: { id: true, nombre: true } },
          stocks: {
            ...(filtros.sedeId ? { where: { sedeId: filtros.sedeId } } : {}),
            include: { sede: { select: { id: true, nombre: true } } },
          },
        },
      }),
      this.prisma.producto.count({ where }),
    ]);

    const conTotales = productos.map((producto) => {
      const stockTotal = producto.stocks.reduce((suma, s) => suma + s.cantidad, 0);
      return {
        ...producto,
        stockTotal,
        bajoMinimo: stockTotal <= producto.stockMinimo,
        /** Lo que vale la mercancía parada: interesa al contador. */
        valorInventario: Number(producto.costoUnitario) * stockTotal,
      };
    });

    return {
      datos: filtros.soloBajoMinimo ? conTotales.filter((p) => p.bajoMinimo) : conTotales,
      meta: construirMeta(total, pagina, limite),
    };
  }

  async obtenerProducto(id: string) {
    const producto = await this.prisma.producto.findFirst({
      where: { id, eliminadoEn: null },
      include: {
        categoria: true,
        proveedor: true,
        stocks: { include: { sede: { select: { id: true, nombre: true } } } },
      },
    });
    if (!producto) throw ErrorNegocio.noEncontrado('ese producto');
    return producto;
  }

  async crearProducto(datos: DatosProducto, actor: UsuarioAutenticado) {
    const producto = await this.prisma.producto.create({
      data: {
        ...datos,
        sku: datos.sku || null,
        codigoBarras: datos.codigoBarras || null,
      },
    });

    await this.auditoria.registrar({
      accion: 'CREAR',
      entidad: 'Producto',
      entidadId: producto.id,
      despues: producto,
      resumen: `Registró el producto "${producto.nombre}"`,
      actor,
    });

    return producto;
  }

  async actualizarProducto(id: string, datos: Partial<DatosProducto>, actor: UsuarioAutenticado) {
    const antes = await this.obtenerProducto(id);

    const despues = await this.prisma.producto.update({
      where: { id },
      data: {
        ...datos,
        ...(datos.sku !== undefined ? { sku: datos.sku || null } : {}),
        ...(datos.codigoBarras !== undefined ? { codigoBarras: datos.codigoBarras || null } : {}),
      },
    });

    await this.auditoria.registrarCambio({
      accion: 'ACTUALIZAR',
      entidad: 'Producto',
      entidadId: id,
      antes: antes as unknown as Record<string, unknown>,
      despues: despues as unknown as Record<string, unknown>,
      resumen: `Editó el producto "${antes.nombre}"`,
      actor,
    });

    return despues;
  }

  async eliminarProducto(id: string, actor: UsuarioAutenticado) {
    const producto = await this.obtenerProducto(id);
    const stockTotal = producto.stocks.reduce((s, x) => s + x.cantidad, 0);

    if (stockTotal > 0) {
      throw ErrorNegocio.conflicto(
        'CONFLICTO',
        { stockTotal },
        `Todavía quedan ${stockTotal} unidades de "${producto.nombre}" en stock. Regístralas como salida antes de eliminar el producto, o desactívalo si solo quieres que deje de venderse.`,
      );
    }

    await this.prisma.producto.update({
      where: { id },
      data: { eliminadoEn: new Date(), activo: false },
    });

    await this.auditoria.registrar({
      accion: 'ELIMINAR',
      entidad: 'Producto',
      entidadId: id,
      antes: producto,
      resumen: `Eliminó el producto "${producto.nombre}"`,
      actor,
    });
  }

  // ============================= MOVIMIENTOS ===============================

  /**
   * Registra una entrada, salida o ajuste.
   *
   * Las ventas no pasan por aquí: las genera el módulo de ventas al cobrar,
   * dentro de la misma transacción del cobro. Aquí entran las compras a
   * proveedor, el consumo interno, las mermas y las correcciones de conteo.
   */
  async registrarMovimiento(datos: DatosMovimiento, actor: UsuarioAutenticado) {
    if (datos.tipo === 'VENTA') {
      throw ErrorNegocio.conflicto(
        'CONFLICTO',
        undefined,
        'Las ventas se registran al cobrar una cita o desde el mostrador, no como movimiento manual.',
      );
    }

    if (datos.tipo === 'AJUSTE') {
      throw ErrorNegocio.conflicto(
        'CONFLICTO',
        undefined,
        'Un ajuste se registra con la cantidad contada en el estante, no con una diferencia. Usa la acción de conteo físico.',
      );
    }

    const producto = await this.obtenerProducto(datos.productoId);

    return this.prisma.$transaction(async (tx) => {
      await tx.productoStock.upsert({
        where: { productoId_sedeId: { productoId: datos.productoId, sedeId: datos.sedeId } },
        update: {},
        create: { productoId: datos.productoId, sedeId: datos.sedeId, cantidad: 0 },
      });

      const suma = this.signoDe(datos.tipo) * datos.cantidad;

      if (suma < 0) {
        // La condición va dentro del UPDATE: comprobar antes y restar después
        // deja una ventana para que dos salidas simultáneas dejen el stock en
        // negativo.
        const actualizados = await tx.productoStock.updateMany({
          where: {
            productoId: datos.productoId,
            sedeId: datos.sedeId,
            cantidad: { gte: datos.cantidad },
          },
          data: { cantidad: { decrement: datos.cantidad } },
        });

        if (actualizados.count === 0) {
          const stock = await tx.productoStock.findUnique({
            where: { productoId_sedeId: { productoId: datos.productoId, sedeId: datos.sedeId } },
            select: { cantidad: true },
          });
          throw new ErrorNegocio(CODIGOS_ERROR.STOCK_INSUFICIENTE, 409, {
            producto: producto.nombre,
            disponible: stock?.cantidad ?? 0,
            solicitado: datos.cantidad,
          });
        }
      } else {
        await tx.productoStock.update({
          where: { productoId_sedeId: { productoId: datos.productoId, sedeId: datos.sedeId } },
          data: { cantidad: { increment: datos.cantidad } },
        });
      }

      const stockFinal = await tx.productoStock.findUniqueOrThrow({
        where: { productoId_sedeId: { productoId: datos.productoId, sedeId: datos.sedeId } },
        select: { cantidad: true },
      });

      const movimiento = await tx.movimientoInventario.create({
        data: {
          productoId: datos.productoId,
          sedeId: datos.sedeId,
          tipo: datos.tipo,
          cantidad: datos.cantidad,
          stockResultante: stockFinal.cantidad,
          costoUnitario: datos.costoUnitario,
          precioUnitario: datos.precioUnitario,
          total:
            datos.costoUnitario !== undefined
              ? new Prisma.Decimal(datos.costoUnitario).times(datos.cantidad)
              : undefined,
          proveedorId: datos.proveedorId,
          documento: datos.documento,
          motivo: datos.motivo,
          registradoPorId: actor.id,
        },
      });

      // Una compra nueva actualiza el costo de referencia del producto: es el
      // que se usará para calcular el margen de las ventas siguientes.
      if (datos.tipo === 'ENTRADA' && datos.costoUnitario !== undefined) {
        await tx.producto.update({
          where: { id: datos.productoId },
          data: { costoUnitario: datos.costoUnitario },
        });
      }

      return movimiento;
    });
  }

  /**
   * Conteo físico: «en el estante hay 7».
   *
   * El usuario no calcula diferencias — mira el estante y escribe lo que ve.
   * El sistema deduce el desfase y lo registra como AJUSTE, dejando constancia
   * de cuánto había según el sistema y cuánto había de verdad. Esa diferencia
   * es justo lo que el contador quiere revisar: mide la merma o el error de
   * registro, y se pierde si se guarda solo el número final.
   */
  async conteoFisico(
    datos: { productoId: string; sedeId: string; cantidadContada: number; motivo?: string },
    actor: UsuarioAutenticado,
  ) {
    const producto = await this.obtenerProducto(datos.productoId);

    return this.prisma.$transaction(async (tx) => {
      const stock = await tx.productoStock.upsert({
        where: { productoId_sedeId: { productoId: datos.productoId, sedeId: datos.sedeId } },
        update: {},
        create: { productoId: datos.productoId, sedeId: datos.sedeId, cantidad: 0 },
      });

      const diferencia = datos.cantidadContada - stock.cantidad;

      if (diferencia === 0) {
        throw ErrorNegocio.conflicto(
          'CONFLICTO',
          { stockActual: stock.cantidad },
          `El sistema ya tiene ${stock.cantidad} unidades de "${producto.nombre}" en esa sede: no hay nada que ajustar.`,
        );
      }

      await tx.productoStock.update({
        where: { productoId_sedeId: { productoId: datos.productoId, sedeId: datos.sedeId } },
        data: { cantidad: datos.cantidadContada },
      });

      const movimiento = await tx.movimientoInventario.create({
        data: {
          productoId: datos.productoId,
          sedeId: datos.sedeId,
          tipo: 'AJUSTE',
          cantidad: Math.abs(diferencia),
          stockResultante: datos.cantidadContada,
          costoUnitario: producto.costoUnitario,
          motivo:
            `Conteo físico: el sistema tenía ${stock.cantidad} y se contaron ${datos.cantidadContada} ` +
            `(${diferencia > 0 ? 'sobran' : 'faltan'} ${Math.abs(diferencia)})` +
            (datos.motivo ? `. ${datos.motivo}` : ''),
          registradoPorId: actor.id,
        },
      });

      await this.auditoria.registrar({
        accion: 'AJUSTAR_INVENTARIO',
        entidad: 'Producto',
        entidadId: datos.productoId,
        antes: { stock: stock.cantidad },
        despues: { stock: datos.cantidadContada },
        resumen: `Conteo físico de "${producto.nombre}": ${stock.cantidad} → ${datos.cantidadContada} (${diferencia > 0 ? '+' : ''}${diferencia})`,
        actor,
      });

      return { movimiento, diferencia, stockAnterior: stock.cantidad };
    });
  }

  async listarMovimientos(filtros: {
    pagina: number;
    limite: number;
    productoId?: string;
    sedeId?: string;
    tipo?: TipoMovimientoInventario;
    desde?: string;
    hasta?: string;
  }) {
    const { skip, take, pagina, limite } = calcularSalto(filtros.pagina, filtros.limite);
    const zona = await this.configuracion.zonaHoraria();

    const where: Prisma.MovimientoInventarioWhereInput = {
      ...(filtros.productoId ? { productoId: filtros.productoId } : {}),
      ...(filtros.sedeId ? { sedeId: filtros.sedeId } : {}),
      ...(filtros.tipo ? { tipo: filtros.tipo } : {}),
    };

    if (filtros.desde || filtros.hasta) {
      const { inicio, fin } = limitesDelRango(
        filtros.desde ?? filtros.hasta!,
        filtros.hasta ?? filtros.desde!,
        zona,
      );
      where.fecha = { gte: inicio, lt: fin };
    }

    const [datos, total] = await this.prisma.$transaction([
      this.prisma.movimientoInventario.findMany({
        where,
        skip,
        take,
        orderBy: { fecha: 'desc' },
        include: {
          producto: { select: { id: true, nombre: true, unidadMedida: true } },
          sede: { select: { id: true, nombre: true } },
          proveedor: { select: { id: true, nombre: true } },
          registradoPor: { select: { id: true, nombre: true } },
        },
      }),
      this.prisma.movimientoInventario.count({ where }),
    ]);

    return { datos, meta: construirMeta(total, pagina, limite) };
  }

  /** Resumen de la cabecera: lo que el dueño quiere ver de un vistazo. */
  async resumen(sedeId?: string) {
    const productos = await this.prisma.producto.findMany({
      where: { eliminadoEn: null, activo: true },
      select: {
        id: true,
        nombre: true,
        stockMinimo: true,
        costoUnitario: true,
        stocks: {
          ...(sedeId ? { where: { sedeId } } : {}),
          select: { cantidad: true },
        },
      },
    });

    let valorTotal = 0;
    const bajoMinimo: { id: string; nombre: string; stock: number; minimo: number }[] = [];

    for (const producto of productos) {
      const stock = producto.stocks.reduce((s, x) => s + x.cantidad, 0);
      valorTotal += Number(producto.costoUnitario) * stock;
      if (stock <= producto.stockMinimo) {
        bajoMinimo.push({
          id: producto.id,
          nombre: producto.nombre,
          stock,
          minimo: producto.stockMinimo,
        });
      }
    }

    return {
      totalProductos: productos.length,
      valorInventario: Math.round(valorTotal),
      bajoMinimo,
    };
  }

  // ============================== CATÁLOGOS ================================

  listarCategorias() {
    return this.prisma.categoriaProducto.findMany({
      where: { activa: true },
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    });
  }

  async crearCategoria(nombre: string) {
    return this.prisma.categoriaProducto.create({
      data: { nombre, slug: aSlug(nombre) },
    });
  }

  listarProveedores() {
    return this.prisma.proveedor.findMany({
      where: { activo: true },
      orderBy: { nombre: 'asc' },
    });
  }

  async crearProveedor(datos: { nombre: string; nit?: string; telefono?: string; email?: string }) {
    return this.prisma.proveedor.create({ data: datos });
  }

  /**
   * Qué dirección tiene cada movimiento.
   *
   * AJUSTE no aparece porque no se mueve por aquí: fija el stock al valor
   * contado, y eso tiene su propia operación.
   */
  private signoDe(tipo: TipoMovimientoInventario): number {
    return tipo === 'SALIDA' || tipo === 'VENTA' ? -1 : 1;
  }
}
