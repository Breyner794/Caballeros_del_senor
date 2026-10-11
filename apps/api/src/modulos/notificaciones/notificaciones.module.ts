import { Module } from '@nestjs/common';
import { CorreoService } from './correo.service.js';

/**
 * Canales de salida hacia clientes y usuarios.
 *
 * Hoy solo correo (Brevo). Cuando entre WhatsApp Cloud API se suma aqui su
 * servicio y el resto del sistema no se entera: los modulos de dominio piden
 * "notifica esto" y este modulo decide por que canal.
 */
@Module({
  providers: [CorreoService],
  exports: [CorreoService],
})
export class NotificacionesModule {}
