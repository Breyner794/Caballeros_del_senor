import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Put, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { crearExcepcionSchema, fechaSchema, guardarAgendaSemanalSchema } from '@cds/shared';
import { RequierePermisos, UsuarioActual } from '../../comun/autenticacion/decoradores.js';
import type { UsuarioAutenticado } from '../../comun/autenticacion/tipos.js';
import { validar } from '../../comun/validacion/zod.pipe.js';
import { AgendaService } from './agenda.service.js';

const guardarConForzar = guardarAgendaSemanalSchema.extend({
  forzar: z.boolean().default(false),
});

@Controller('agenda')
export class AgendaController {
  constructor(private readonly servicio: AgendaService) {}

  /** Plantilla semanal de un barbero en una sede. */
  @Get('semanal')
  @RequierePermisos('agenda:ver')
  semanal(
    @Query('usuarioId') usuarioId: string,
    @Query('sedeId', ParseUUIDPipe) sedeId: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    const objetivo = usuario.permisos.includes('agenda:gestionar_todas')
      ? usuarioId || usuario.id
      : usuario.id;
    return this.servicio.semanal(objetivo, sedeId);
  }

  @Put('semanal')
  @RequierePermisos('agenda:ver')
  guardarSemanal(
    @Body(validar(guardarConForzar)) datos: z.infer<typeof guardarConForzar>,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.guardarSemanal(datos, usuario);
  }

  /**
   * Consulta previa antes de cerrar un dia: devuelve las citas que lo
   * impiden, con telefonos, para poder llamar a los clientes.
   */
  @Get('puede-cerrar')
  @RequierePermisos('agenda:ver')
  puedeCerrar(
    @Query('usuarioId') usuarioId: string,
    @Query('fecha', validar(fechaSchema)) fecha: string,
    @Query('sedeId') sedeId: string | undefined,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    const objetivo = usuario.permisos.includes('agenda:gestionar_todas')
      ? usuarioId || usuario.id
      : usuario.id;
    return this.servicio.citasQueImpidenCerrar(objetivo, fecha, sedeId);
  }

  @Get('excepciones')
  @RequierePermisos('agenda:ver')
  excepciones(
    @Query('usuarioId') usuarioId: string,
    @Query('desde', validar(fechaSchema)) desde: string,
    @Query('hasta', validar(fechaSchema)) hasta: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    const objetivo = usuario.permisos.includes('agenda:gestionar_todas')
      ? usuarioId || usuario.id
      : usuario.id;
    return this.servicio.excepciones(objetivo, desde, hasta);
  }

  /** Dia libre, cita medica o horario especial para una fecha concreta. */
  @Post('excepciones')
  @RequierePermisos('agenda:ver')
  crearExcepcion(
    @Body(validar(crearExcepcionSchema)) datos: z.infer<typeof crearExcepcionSchema>,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.crearExcepcion(datos, usuario);
  }

  @Delete('excepciones/:id')
  @RequierePermisos('agenda:ver')
  eliminarExcepcion(
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.eliminarExcepcion(id, usuario);
  }
}
