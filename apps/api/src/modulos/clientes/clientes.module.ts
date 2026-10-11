import { Module } from '@nestjs/common';
import { ClientesController } from './clientes.controller.js';
import { ClientesService } from './clientes.service.js';
import { FidelidadModule } from '../fidelidad/fidelidad.module.js';

@Module({
  imports: [FidelidadModule],
  controllers: [ClientesController],
  providers: [ClientesService],
  exports: [ClientesService],
})
export class ClientesModule {}
