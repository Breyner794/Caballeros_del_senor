import { Module } from '@nestjs/common';
import { DisponibilidadModule } from '../disponibilidad/disponibilidad.module.js';
import { PublicoController } from './publico.controller.js';
import { PublicoService } from './publico.service.js';

/** Canal público: Prisma y la configuración vienen del `ComunModule` global. */
@Module({
  imports: [DisponibilidadModule],
  controllers: [PublicoController],
  providers: [PublicoService],
})
export class PublicoModule {}
