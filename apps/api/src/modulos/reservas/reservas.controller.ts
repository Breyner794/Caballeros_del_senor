import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  cancelarReservaSchema,
  completarReservaSchema,
  crearReservaSchema,
  crearWalkInSchema,
  fechaSchema,
  listarReservasSchema,
  reprogramarReservaSchema,
} from '@cds/shared';
import { RequierePermisos, UsuarioActual } from '../../comun/autenticacion/decoradores.js';
import type { UsuarioAutenticado } from '../../comun/autenticacion/tipos.js';
import { validar } from '../../comun/validacion/zod.pipe.js';
import { ReservasService } from './reservas.service.js';

const agendaDelDiaSchema = z.object({
  fecha: fechaSchema.optional(),
  sedeId: z.string().uuid().optional(),
  barberoId: z.string().uuid().optional(),
});

@Controller('reservas')
export class ReservasController {
  constructor(private readonly servicio: ReservasService) {}

  @Get()
  @RequierePermisos('reservas:ver')
  listar(
    @Query(validar(listarReservasSchema)) filtros: z.infer<typeof listarReservasSchema>,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.listar(filtros, usuario);
  }

  /** La vista por defecto del panel: lo que hay hoy. */
  @Get('agenda-del-dia')
  @RequierePermisos('reservas:ver')
  agendaDelDia(
    @Query(validar(agendaDelDiaSchema)) filtros: z.infer<typeof agendaDelDiaSchema>,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.agendaDelDia(filtros, usuario);
  }

  @Get('codigo/:codigo')
  @RequierePermisos('reservas:ver')
  porCodigo(@Param('codigo') codigo: string) {
    return this.servicio.porCodigo(codigo);
  }

  @Get(':id')
  @RequierePermisos('reservas:ver')
  obtener(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicio.obtener(id);
  }

  @Post()
  @RequierePermisos('reservas:crear')
  crear(
    @Body(validar(crearReservaSchema)) datos: z.infer<typeof crearReservaSchema>,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.crear(datos, usuario);
  }

  /** Cliente que llega sin cita: se le busca hueco y se le da turno. */
  @Post('walk-in')
  @RequierePermisos('reservas:crear')
  walkIn(
    @Body(validar(crearWalkInSchema)) datos: z.infer<typeof crearWalkInSchema>,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.crearWalkIn(datos, usuario);
  }

  @Patch(':id/reprogramar')
  @RequierePermisos('reservas:editar')
  reprogramar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(validar(reprogramarReservaSchema)) datos: z.infer<typeof reprogramarReservaSchema>,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.reprogramar(id, datos, usuario);
  }

  @Patch(':id/cancelar')
  @RequierePermisos('reservas:cancelar')
  cancelar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(validar(cancelarReservaSchema)) datos: z.infer<typeof cancelarReservaSchema>,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.cancelar(id, datos, usuario, 'PANEL');
  }

  @Patch(':id/iniciar')
  @RequierePermisos('reservas:editar')
  iniciar(
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.iniciar(id, usuario);
  }

  @Patch(':id/no-asistio')
  @RequierePermisos('reservas:editar')
  noAsistio(
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.marcarNoAsistio(id, usuario);
  }

  /** Cobrar: genera la venta, el sello y, si aplica, el canje del premio. */
  @Patch(':id/completar')
  @RequierePermisos('reservas:completar')
  completar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(validar(completarReservaSchema)) datos: z.infer<typeof completarReservaSchema>,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.completar(id, datos, usuario);
  }
}
