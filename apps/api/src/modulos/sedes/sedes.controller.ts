import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { actualizarSedeSchema, crearSedeSchema } from '@cds/shared';
import { RequierePermisos, UsuarioActual } from '../../comun/autenticacion/decoradores.js';
import type { UsuarioAutenticado } from '../../comun/autenticacion/tipos.js';
import { validar } from '../../comun/validacion/zod.pipe.js';
import { SedesService } from './sedes.service.js';

@Controller('sedes')
export class SedesController {
  constructor(private readonly servicio: SedesService) {}

  @Get()
  @RequierePermisos('sedes:ver')
  listar(@Query('soloActivas') soloActivas?: string) {
    return this.servicio.listar(soloActivas === 'true');
  }

  @Get(':id')
  @RequierePermisos('sedes:ver')
  obtener(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicio.obtener(id);
  }

  /** Barberos habilitados en la sede: el selector del formulario de reservas. */
  @Get(':id/barberos')
  @RequierePermisos('sedes:ver')
  barberos(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicio.barberosDeLaSede(id);
  }

  @Post()
  @RequierePermisos('sedes:gestionar')
  crear(
    @Body(validar(crearSedeSchema)) datos: z.infer<typeof crearSedeSchema>,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.crear(datos, usuario);
  }

  @Patch(':id')
  @RequierePermisos('sedes:gestionar')
  actualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(validar(actualizarSedeSchema)) datos: z.infer<typeof actualizarSedeSchema>,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.actualizar(id, datos, usuario);
  }

  @Patch(':id/estado')
  @RequierePermisos('sedes:gestionar')
  cambiarEstado(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(validar(z.object({ activa: z.boolean() }))) datos: { activa: boolean },
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.cambiarEstado(id, datos.activa, usuario);
  }
}
