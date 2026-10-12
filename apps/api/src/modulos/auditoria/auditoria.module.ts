import { Module } from '@nestjs/common';
import { AuditoriaController, ErroresController } from './auditoria.controller.js';
import { AuditoriaConsultaService } from './auditoria-consulta.service.js';

/**
 * Consulta de auditoria y de errores globales.
 *
 * El servicio que *escribe* la auditoria vive en ComunModule y es global,
 * porque lo usan todos los modulos. Este solo lee.
 */
@Module({
  controllers: [AuditoriaController, ErroresController],
  providers: [AuditoriaConsultaService],
  exports: [AuditoriaConsultaService],
})
export class AuditoriaConsultaModule {}
