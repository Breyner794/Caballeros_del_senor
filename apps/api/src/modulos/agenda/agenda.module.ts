import { Module } from '@nestjs/common';
import { AgendaController } from './agenda.controller.js';
import { AgendaService } from './agenda.service.js';

@Module({
  controllers: [AgendaController],
  providers: [AgendaService],
  exports: [AgendaService],
})
export class AgendaModule {}
