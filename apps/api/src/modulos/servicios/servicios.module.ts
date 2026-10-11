import { Module } from '@nestjs/common';
import { ServiciosController } from './servicios.controller.js';
import { ServiciosService } from './servicios.service.js';

@Module({
  controllers: [ServiciosController],
  providers: [ServiciosService],
  exports: [ServiciosService],
})
export class ServiciosModule {}
