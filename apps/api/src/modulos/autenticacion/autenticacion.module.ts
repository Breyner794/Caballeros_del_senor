import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AutenticacionController } from './autenticacion.controller.js';
import { AutenticacionService } from './autenticacion.service.js';
import { TokensService } from './tokens.service.js';
import { NotificacionesModule } from '../notificaciones/notificaciones.module.js';

@Module({
  imports: [
    // Sin secreto global: cada token se firma con el suyo (acceso vs refresco),
    // que se pasa explícitamente en cada llamada.
    JwtModule.register({}),
    NotificacionesModule,
  ],
  controllers: [AutenticacionController],
  providers: [AutenticacionService, TokensService],
  exports: [AutenticacionService, TokensService],
})
export class AutenticacionModule {}
