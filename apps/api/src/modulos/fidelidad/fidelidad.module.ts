import { Module } from '@nestjs/common';
import { FidelidadService } from './fidelidad.service.js';
import { FidelidadController } from './fidelidad.controller.js';

@Module({
  controllers: [FidelidadController],
  providers: [FidelidadService],
  exports: [FidelidadService],
})
export class FidelidadModule {}
