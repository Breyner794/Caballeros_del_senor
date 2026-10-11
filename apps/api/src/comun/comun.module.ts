import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service.js';
import { RegistroErroresService } from './errores/registro-errores.service.js';
import { AuditoriaService } from './auditoria/auditoria.service.js';
import { ConfiguracionNegocioService } from './configuracion/configuracion-negocio.service.js';

/**
 * Módulo global con lo que necesita casi todo el sistema: acceso a datos,
 * auditoría, registro de errores y la configuración del negocio.
 *
 * Es `@Global` para no repetir el mismo bloque de imports en los doce módulos
 * de dominio.
 */
@Global()
@Module({
  providers: [
    PrismaService,
    RegistroErroresService,
    AuditoriaService,
    ConfiguracionNegocioService,
  ],
  exports: [PrismaService, RegistroErroresService, AuditoriaService, ConfiguracionNegocioService],
})
export class ComunModule {}
