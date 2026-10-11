import { Module } from '@nestjs/common';
import { VentasService } from './ventas.service.js';
import { ComisionesService } from './comisiones.service.js';

@Module({
  providers: [VentasService, ComisionesService],
  exports: [VentasService, ComisionesService],
})
export class VentasModule {}
