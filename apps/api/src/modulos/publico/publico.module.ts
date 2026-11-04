import { Module } from '@nestjs/common';
import { PublicoController } from './publico.controller.js';
import { PublicoService } from './publico.service.js';

/** Canal público: Prisma y la configuración vienen del `ComunModule` global. */
@Module({
  controllers: [PublicoController],
  providers: [PublicoService],
})
export class PublicoModule {}
