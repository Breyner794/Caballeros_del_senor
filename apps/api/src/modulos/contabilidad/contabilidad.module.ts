import { Module } from '@nestjs/common';
import { ContabilidadController } from './contabilidad.controller.js';
import { ContabilidadService } from './contabilidad.service.js';
import { VentasModule } from '../ventas/ventas.module.js';

@Module({
  imports: [VentasModule],
  controllers: [ContabilidadController],
  providers: [ContabilidadService],
  exports: [ContabilidadService],
})
export class ContabilidadModule {}
