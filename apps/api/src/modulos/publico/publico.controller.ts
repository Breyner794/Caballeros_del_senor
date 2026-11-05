import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  consultarCalendarioPublicoSchema,
  consultarDisponibilidadPublicaSchema,
  crearReservaPublicaSchema,
  type ConsultarCalendarioPublicoDto,
  type ConsultarDisponibilidadPublicaDto,
  type CrearReservaPublicaDto,
} from '@cds/shared';
import { Publico } from '../../comun/autenticacion/decoradores.js';
import { validar } from '../../comun/validacion/zod.pipe.js';
import { GuardTurnstile } from './guard-turnstile.js';
import { PublicoReservasService } from './publico-reservas.service.js';
import { PublicoService } from './publico.service.js';

/**
 * Canal público de reservas. Sin lógica: delega en `PublicoService`.
 * Lecturas en `PublicoService`, escritura en `PublicoReservasService`.
 * Toda ruta lleva `@Publico()`: el guard de autenticación es global y las
 * rutas son privadas por defecto.
 */
@Controller('publico')
export class PublicoController {
  constructor(
    private readonly servicio: PublicoService,
    private readonly reservas: PublicoReservasService,
  ) {}

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

  /**
   * Crea una reserva desde la web. Es la primera ruta pública que escribe, y se
   * defiende en dos capas: Turnstile frena a los bots y el límite de 5 por hora
   * y por IP al humano insistente. Devuelve el `tokenGestion` una sola vez: es
   * la única llave de la cita.
   */
  @Post('reservas')
  @Publico()
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  @UseGuards(GuardTurnstile)
  crearReserva(@Body(validar(crearReservaPublicaSchema)) datos: CrearReservaPublicaDto) {
    return this.reservas.crearReserva(datos);
  }
}
