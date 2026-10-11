import { Module } from '@nestjs/common';
import { ReservasController } from './reservas.controller.js';
import { ReservasService } from './reservas.service.js';
import { DisponibilidadModule } from '../disponibilidad/disponibilidad.module.js';
import { ClientesModule } from '../clientes/clientes.module.js';
import { FidelidadModule } from '../fidelidad/fidelidad.module.js';
import { VentasModule } from '../ventas/ventas.module.js';

@Module({
  imports: [DisponibilidadModule, ClientesModule, FidelidadModule, VentasModule],
  controllers: [ReservasController],
  providers: [ReservasService],
  exports: [ReservasService],
})
export class ReservasModule {}
