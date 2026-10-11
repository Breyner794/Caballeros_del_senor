import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { consultarCalendarioSchema, consultarDisponibilidadSchema } from '@cds/shared';
import { RequierePermisos, UsuarioActual } from '../../comun/autenticacion/decoradores.js';
import type { UsuarioAutenticado } from '../../comun/autenticacion/tipos.js';
import { validar } from '../../comun/validacion/zod.pipe.js';
import { DisponibilidadService } from './disponibilidad.service.js';

/**
 * Disponibilidad.
 *
 * Un barbero sin permiso ampliado solo puede consultar su propia agenda: el
 * filtro se fuerza aqui, no en el frontend, porque el barberoId viaja en la
 * query y se podria cambiar a mano.
 */
@Controller('disponibilidad')
export class DisponibilidadController {
  constructor(private readonly servicio: DisponibilidadService) {}

  @Get('dia')
  @RequierePermisos('disponibilidad:ver')
  delDia(
    @Query(validar(consultarDisponibilidadSchema))
    filtros: z.infer<typeof consultarDisponibilidadSchema>,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    const barberoId = usuario.permisos.includes('disponibilidad:ver_todas')
      ? filtros.barberoId
      : usuario.id;

    return this.servicio.delDia({ ...filtros, barberoId });
  }

  /** Ocupacion por dia para pintar el calendario con colores. */
  @Get('calendario')
  @RequierePermisos('disponibilidad:ver')
  calendario(
    @Query(validar(consultarCalendarioSchema))
    filtros: z.infer<typeof consultarCalendarioSchema>,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    const barberoId = usuario.permisos.includes('disponibilidad:ver_todas')
      ? filtros.barberoId
      : usuario.id;

    return this.servicio.calendario({ ...filtros, barberoId });
  }
}
