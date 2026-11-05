import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  cancelarReservaPublicaSchema,
  consultarCalendarioPublicoSchema,
  consultarDisponibilidadPublicaSchema,
  crearReservaPublicaSchema,
  reprogramarReservaPublicaSchema,
  type CancelarReservaPublicaDto,
  type ConsultarCalendarioPublicoDto,
  type ConsultarDisponibilidadPublicaDto,
  type CrearReservaPublicaDto,
  type ReprogramarReservaPublicaDto,
} from '@cds/shared';
import { Publico } from '../../comun/autenticacion/decoradores.js';
import { validar } from '../../comun/validacion/zod.pipe.js';
import { GuardTokenGestion, ReservaPorToken, type ReservaResuelta } from './guard-token-gestion.js';
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

  /**
   * La cita del cliente, con `puedeCancelar` y `puedeReprogramar`. Se
   * autentica con el token de gestión (cabecera `X-Token-Gestion`), que el
   * frontend lee del fragmento del enlace.
   */
  @Get('mi-reserva')
  @Publico()
  @UseGuards(GuardTokenGestion)
  miReserva(@ReservaPorToken() reserva: ReservaResuelta) {
    return this.reservas.miReserva(reserva);
  }

  /**
   * Los POST de gestión llevan además Turnstile: son escrituras sin sesión que
   * se pueden enumerar. Turnstile va primero para frenar al bot antes de que
   * cada intento llegue a consultar un token.
   */
  @Post('mi-reserva/cancelar')
  @Publico()
  @UseGuards(GuardTurnstile, GuardTokenGestion)
  cancelarMiReserva(
    @ReservaPorToken() reserva: ReservaResuelta,
    @Body(validar(cancelarReservaPublicaSchema)) datos: CancelarReservaPublicaDto,
  ) {
    return this.reservas.cancelarPropia(reserva, datos);
  }

  /** Devuelve el `tokenGestion` nuevo: el enlace anterior deja de servir. */
  @Post('mi-reserva/reprogramar')
  @Publico()
  @UseGuards(GuardTurnstile, GuardTokenGestion)
  reprogramarMiReserva(
    @ReservaPorToken() reserva: ReservaResuelta,
    @Body(validar(reprogramarReservaPublicaSchema)) datos: ReprogramarReservaPublicaDto,
  ) {
    return this.reservas.reprogramarPropia(reserva, datos);
  }
}
