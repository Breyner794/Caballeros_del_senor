import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import {
  booleanoDeQuery,
  dineroSchema,
  fechaSchema,
  idSchema,
  paginacionSchema,
  textoOpcional,
  textoRequerido,
} from '@cds/shared';
import { RequierePermisos, UsuarioActual } from '../../comun/autenticacion/decoradores.js';
import type { UsuarioAutenticado } from '../../comun/autenticacion/tipos.js';
import { validar } from '../../comun/validacion/zod.pipe.js';
import { InventarioService } from './inventario.service.js';

const productoSchema = z.object({
  nombre: textoRequerido('El nombre del producto', 160),
  descripcion: textoOpcional(1000),
  marca: textoOpcional(120),
  sku: textoOpcional(60),
  codigoBarras: textoOpcional(60),
  categoriaId: idSchema.optional(),
  proveedorId: idSchema.optional(),
  costoUnitario: dineroSchema.default(0),
  precioVenta: dineroSchema.default(0),
  unidadMedida: z.string().trim().max(20).default('UNIDAD'),
  esVendible: z.boolean().default(true),
  stockMinimo: z.coerce.number().int().min(0).max(100000).default(0),
  activo: z.boolean().default(true),
});

/**
 * Los movimientos manuales son solo estos tres.
 *
 * VENTA la genera el cobro de una cita, y AJUSTE tiene su propia operación de
 * conteo: dejar que se registren a mano aquí abriría la puerta a cuadrar el
 * inventario inventando entradas, que es justo lo que el libro debe impedir.
 */
const movimientoSchema = z.object({
  productoId: idSchema,
  sedeId: idSchema,
  tipo: z.enum(['ENTRADA', 'SALIDA', 'DEVOLUCION']),
  cantidad: z.coerce.number().int().min(1).max(100000),
  costoUnitario: dineroSchema.optional(),
  precioUnitario: dineroSchema.optional(),
  proveedorId: idSchema.optional(),
  documento: textoOpcional(80),
  motivo: textoOpcional(1000),
});

const conteoSchema = z.object({
  productoId: idSchema,
  sedeId: idSchema,
  cantidadContada: z.coerce.number().int().min(0).max(1000000),
  motivo: textoOpcional(500),
});

const filtrosProductos = paginacionSchema.extend({
  categoriaId: idSchema.optional(),
  sedeId: idSchema.optional(),
  soloBajoMinimo: booleanoDeQuery.optional(),
  activo: booleanoDeQuery.optional(),
});

const filtrosMovimientos = paginacionSchema.extend({
  productoId: idSchema.optional(),
  sedeId: idSchema.optional(),
  tipo: z.enum(['ENTRADA', 'SALIDA', 'VENTA', 'AJUSTE', 'DEVOLUCION']).optional(),
  desde: fechaSchema.optional(),
  hasta: fechaSchema.optional(),
});

const categoriaSchema = z.object({ nombre: textoRequerido('El nombre', 120) });

const proveedorSchema = z.object({
  nombre: textoRequerido('El nombre', 160),
  nit: textoOpcional(40),
  telefono: textoOpcional(30),
  email: textoOpcional(180),
});

@Controller('inventario')
export class InventarioController {
  constructor(private readonly servicio: InventarioService) {}

  @Get('resumen')
  @RequierePermisos('inventario:ver')
  resumen(@Query('sedeId') sedeId?: string) {
    return this.servicio.resumen(sedeId);
  }

  @Get('categorias')
  @RequierePermisos('inventario:ver')
  categorias() {
    return this.servicio.listarCategorias();
  }

  @Post('categorias')
  @RequierePermisos('inventario:gestionar')
  crearCategoria(@Body(validar(categoriaSchema)) datos: z.infer<typeof categoriaSchema>) {
    return this.servicio.crearCategoria(datos.nombre);
  }

  @Get('proveedores')
  @RequierePermisos('inventario:ver')
  proveedores() {
    return this.servicio.listarProveedores();
  }

  @Post('proveedores')
  @RequierePermisos('inventario:gestionar')
  crearProveedor(@Body(validar(proveedorSchema)) datos: z.infer<typeof proveedorSchema>) {
    return this.servicio.crearProveedor(datos);
  }

  @Get('movimientos')
  @RequierePermisos('inventario:ver')
  movimientos(@Query(validar(filtrosMovimientos)) filtros: z.infer<typeof filtrosMovimientos>) {
    return this.servicio.listarMovimientos(filtros);
  }

  /** Entrada de compra, salida por consumo o merma, devolución a proveedor. */
  @Post('movimientos')
  @RequierePermisos('inventario:gestionar')
  registrarMovimiento(
    @Body(validar(movimientoSchema)) datos: z.infer<typeof movimientoSchema>,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.registrarMovimiento(datos, usuario);
  }

  /** Conteo físico: se escribe lo que hay en el estante, no la diferencia. */
  @Post('conteo')
  @RequierePermisos('inventario:gestionar')
  conteo(
    @Body(validar(conteoSchema)) datos: z.infer<typeof conteoSchema>,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.conteoFisico(datos, usuario);
  }

  @Get()
  @RequierePermisos('inventario:ver')
  listar(@Query(validar(filtrosProductos)) filtros: z.infer<typeof filtrosProductos>) {
    return this.servicio.listarProductos(filtros);
  }

  @Get(':id')
  @RequierePermisos('inventario:ver')
  obtener(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicio.obtenerProducto(id);
  }

  @Post()
  @RequierePermisos('inventario:gestionar')
  crear(
    @Body(validar(productoSchema)) datos: z.infer<typeof productoSchema>,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.crearProducto(datos, usuario);
  }

  @Patch(':id')
  @RequierePermisos('inventario:gestionar')
  actualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(validar(productoSchema.partial())) datos: Partial<z.infer<typeof productoSchema>>,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.actualizarProducto(id, datos, usuario);
  }

  @Delete(':id')
  @RequierePermisos('inventario:gestionar')
  async eliminar(
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    await this.servicio.eliminarProducto(id, usuario);
    return { mensaje: 'Producto eliminado.' };
  }
}
