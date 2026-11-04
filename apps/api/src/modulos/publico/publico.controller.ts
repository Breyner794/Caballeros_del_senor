import { Controller, Get, Query } from '@nestjs/common';
import {
  consultarCalendarioPublicoSchema,
  consultarDisponibilidadPublicaSchema,
  type ConsultarCalendarioPublicoDto,
  type ConsultarDisponibilidadPublicaDto,
} from '@cds/shared';
import { Publico } from '../../comun/autenticacion/decoradores.js';
import { validar } from '../../comun/validacion/zod.pipe.js';
import { PublicoService } from './publico.service.js';

/**
 * Canal público de reservas. Sin lógica: delega en `PublicoService`.
 * Toda ruta lleva `@Publico()`: el guard de autenticación es global y las
 * rutas son privadas por defecto.
 */
@Controller('publico')
export class PublicoController {
  constructor(private readonly servicio: PublicoService) {}

  /** Sedes con sus barberos, servicios y configuración del asistente. */
  @Get('opciones')
  @Publico()
  opciones() {
    return this.servicio.opciones();
  }

  /** Huecos de un día; sin barbero elegido, la unión de los de la sede. */
  @Get('disponibilidad')
  @Publico()
  disponibilidad(
    @Query(validar(consultarDisponibilidadPublicaSchema)) filtros: ConsultarDisponibilidadPublicaDto,
  ) {
    return this.servicio.disponibilidad(filtros);
  }

  /** Qué días del rango tienen algún hueco. */
  @Get('calendario')
  @Publico()
  calendario(@Query(validar(consultarCalendarioPublicoSchema)) filtros: ConsultarCalendarioPublicoDto) {
    return this.servicio.calendario(filtros);
  }
}
