import { Module } from '@nestjs/common';
import { DisponibilidadModule } from '../disponibilidad/disponibilidad.module.js';
import { ReservasModule } from '../reservas/reservas.module.js';
import { PublicoController } from './publico.controller.js';
import { PublicoReservasService } from './publico-reservas.service.js';
import { PublicoService } from './publico.service.js';

/**
 * Canal público: Prisma y la configuración vienen del `ComunModule` global.
 * `ReservasModule` aporta el dominio de la cita: la web no reimplementa sus reglas.
 */
@Module({
  imports: [DisponibilidadModule, ReservasModule],
  controllers: [PublicoController],
  providers: [PublicoService, PublicoReservasService],
})
export class PublicoModule {}
