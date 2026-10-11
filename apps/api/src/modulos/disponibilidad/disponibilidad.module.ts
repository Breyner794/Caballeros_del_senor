import { Module } from '@nestjs/common';
import { DisponibilidadController } from './disponibilidad.controller.js';
import { DisponibilidadService } from './disponibilidad.service.js';

@Module({
  controllers: [DisponibilidadController],
  providers: [DisponibilidadService],
  exports: [DisponibilidadService],
})
export class DisponibilidadModule {}
