import { Module } from '@nestjs/common';
import { DisponibilidadModule } from '../disponibilidad/disponibilidad.module.js';
import { NotificacionesModule } from '../notificaciones/notificaciones.module.js';
import { ReservasModule } from '../reservas/reservas.module.js';
import { GuardTurnstile } from './guard-turnstile.js';
import { PublicoController } from './publico.controller.js';
import { PublicoReservasService } from './publico-reservas.service.js';
import { PublicoService } from './publico.service.js';

/**
 * Canal público: Prisma y la configuración vienen del `ComunModule` global.
 * `ReservasModule` aporta el dominio de la cita: la web no reimplementa sus reglas.
 *
 * `GuardTurnstile` figura como proveedor aunque las rutas lo declaren con
 * `@UseGuards`: así Nest lo instancia al iniciar el módulo y su `onModuleInit`
 * puede avisar, una sola vez, si el canal levanta sin captcha.
 */
@Module({
  imports: [DisponibilidadModule, ReservasModule, NotificacionesModule],
  controllers: [PublicoController],
  providers: [PublicoService, PublicoReservasService, GuardTurnstile],
})
export class PublicoModule {}
