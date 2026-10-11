import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  actualizarServicioSchema,
  crearServicioSchema,
  listarServiciosSchema,
} from '@cds/shared';
import { RequierePermisos, UsuarioActual } from '../../comun/autenticacion/decoradores.js';
import type { UsuarioAutenticado } from '../../comun/autenticacion/tipos.js';
import { validar } from '../../comun/validacion/zod.pipe.js';
import { ServiciosService } from './servicios.service.js';

const reordenarSchema = z.object({
  orden: z.array(z.object({ id: z.string().uuid(), orden: z.number().int().min(0) })).max(100),
});

@Controller('servicios')
export class ServiciosController {
  constructor(private readonly servicio: ServiciosService) {}

  @Get()
  @RequierePermisos('servicios:ver')
  listar(@Query(validar(listarServiciosSchema)) filtros: z.infer<typeof listarServiciosSchema>) {
    return this.servicio.listar(filtros);
  }

  /** Catalogo completo sin paginar, para los selectores del formulario. */
  @Get('selector')
  @RequierePermisos('servicios:ver')
  selector() {
    return this.servicio.paraSelector();
  }

  @Get(':id')
  @RequierePermisos('servicios:ver')
  obtener(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicio.obtener(id);
  }

  @Post()
  @RequierePermisos('servicios:gestionar')
  crear(
    @Body(validar(crearServicioSchema)) datos: z.infer<typeof crearServicioSchema>,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.crear(datos, usuario);
  }

  @Patch('reordenar')
  @RequierePermisos('servicios:gestionar')
  reordenar(
    @Body(validar(reordenarSchema)) datos: z.infer<typeof reordenarSchema>,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.reordenar(datos.orden, usuario);
  }

  @Patch(':id')
  @RequierePermisos('servicios:gestionar')
  actualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(validar(actualizarServicioSchema)) datos: z.infer<typeof actualizarServicioSchema>,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.actualizar(id, datos, usuario);
  }

  @Patch(':id/estado')
  @RequierePermisos('servicios:gestionar')
  cambiarEstado(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(validar(z.object({ activo: z.boolean() }))) datos: { activo: boolean },
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.cambiarEstado(id, datos.activo, usuario);
  }

  @Delete(':id')
  @RequierePermisos('servicios:gestionar')
  eliminar(
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.eliminar(id, usuario);
  }
}
