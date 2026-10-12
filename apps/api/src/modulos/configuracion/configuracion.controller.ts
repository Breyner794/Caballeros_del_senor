import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { actualizarConfiguracionSchema, crearDiaEspecialSchema, fechaSchema } from '@cds/shared';
import { RequierePermisos, UsuarioActual } from '../../comun/autenticacion/decoradores.js';
import type { UsuarioAutenticado } from '../../comun/autenticacion/tipos.js';
import { validar } from '../../comun/validacion/zod.pipe.js';
import { ConfiguracionService } from './configuracion.service.js';

const rangoOpcional = z.object({
  desde: fechaSchema.optional(),
  hasta: fechaSchema.optional(),
});

@Controller('configuracion')
export class ConfiguracionController {
  constructor(private readonly servicio: ConfiguracionService) {}

  @Get()
  @RequierePermisos('configuracion:ver')
  obtener() {
    return this.servicio.obtener();
  }

  /** A quien afectaria cambiar el tamano de turno general. */
  @Get('impacto-slot')
  @RequierePermisos('configuracion:ver')
  impactoSlot() {
    return this.servicio.impactoDelSlot();
  }

  @Patch()
  @RequierePermisos('configuracion:gestionar')
  actualizar(
    @Body(validar(actualizarConfiguracionSchema))
    datos: z.infer<typeof actualizarConfiguracionSchema>,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.actualizar(datos, usuario);
  }

  @Get('dias-especiales')
  @RequierePermisos('configuracion:ver')
  diasEspeciales(@Query(validar(rangoOpcional)) filtros: z.infer<typeof rangoOpcional>) {
    return this.servicio.diasEspeciales(filtros.desde, filtros.hasta);
  }

  @Post('dias-especiales')
  @RequierePermisos('configuracion:gestionar')
  crearDiaEspecial(
    @Body(validar(crearDiaEspecialSchema)) datos: z.infer<typeof crearDiaEspecialSchema>,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.crearDiaEspecial(datos, usuario);
  }

  @Delete('dias-especiales/:id')
  @RequierePermisos('configuracion:gestionar')
  async eliminarDiaEspecial(
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    await this.servicio.eliminarDiaEspecial(id, usuario);
    return { mensaje: 'Dia especial eliminado.' };
  }
}
