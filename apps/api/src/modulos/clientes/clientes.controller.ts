import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  actualizarClienteSchema,
  buscarClientesSchema,
  crearClienteSchema,
  listarClientesSchema,
} from '@cds/shared';
import { RequierePermisos, UsuarioActual } from '../../comun/autenticacion/decoradores.js';
import type { UsuarioAutenticado } from '../../comun/autenticacion/tipos.js';
import { validar } from '../../comun/validacion/zod.pipe.js';
import { ClientesService } from './clientes.service.js';
import { FidelidadService } from '../fidelidad/fidelidad.service.js';

@Controller('clientes')
export class ClientesController {
  constructor(
    private readonly servicio: ClientesService,
    private readonly fidelidad: FidelidadService,
  ) {}

  @Get()
  @RequierePermisos('clientes:ver')
  listar(@Query(validar(listarClientesSchema)) filtros: z.infer<typeof listarClientesSchema>) {
    return this.servicio.listar(filtros);
  }

  /**
   * Busqueda del formulario de reservas: por nombre o telefono a la vez.
   * Tolera acentos y errores de tipeo gracias a los indices trigram.
   */
  @Get('buscar')
  @RequierePermisos('clientes:ver')
  buscar(@Query(validar(buscarClientesSchema)) filtros: z.infer<typeof buscarClientesSchema>) {
    return this.servicio.buscar(filtros.q, filtros.limite);
  }

  @Get(':id')
  @RequierePermisos('clientes:ver')
  obtener(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicio.obtener(id);
  }

  @Get(':id/historial')
  @RequierePermisos('clientes:ver')
  historial(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('pagina') pagina?: string,
    @Query('limite') limite?: string,
  ) {
    return this.servicio.historial(id, Number(pagina) || 1, Number(limite) || 10);
  }

  /** Sellos y canjes: la tarjeta de cortes del cliente. */
  @Get(':id/fidelidad')
  @RequierePermisos('fidelidad:ver')
  async fidelidadDelCliente(@Param('id', ParseUUIDPipe) id: string) {
    const [estado, historial] = await Promise.all([
      this.fidelidad.estado(id),
      this.fidelidad.historial(id),
    ]);
    return { estado, ...historial };
  }

  @Post()
  @RequierePermisos('clientes:crear')
  crear(
    @Body(validar(crearClienteSchema)) datos: z.infer<typeof crearClienteSchema>,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.crear(datos, usuario);
  }

  @Patch(':id')
  @RequierePermisos('clientes:editar')
  actualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(validar(actualizarClienteSchema)) datos: z.infer<typeof actualizarClienteSchema>,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.actualizar(id, datos, usuario);
  }

  @Delete(':id')
  @RequierePermisos('clientes:eliminar')
  eliminar(
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.eliminar(id, usuario);
  }
}
