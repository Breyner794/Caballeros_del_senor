import { Module } from '@nestjs/common';
import { AdaptadorEmail } from './adaptador-email.js';
import { CorreoService } from './correo.service.js';
import { ADAPTADORES_NOTIFICACION, NotificacionesService } from './notificaciones.service.js';

/**
 * Canales de salida hacia clientes y usuarios.
 *
 * Hoy solo correo (Brevo). Para sumar WhatsApp Cloud API: un adaptador nuevo,
 * una entrada en el mapa `ADAPTADORES_NOTIFICACION` y una fila de plantilla en el
 * seed. Los módulos de dominio piden "notifica esto" y no se enteran.
 */
@Module({
  providers: [
    CorreoService,
    AdaptadorEmail,
    {
      provide: ADAPTADORES_NOTIFICACION,
      useFactory: (email: AdaptadorEmail) => ({ EMAIL: email }),
      inject: [AdaptadorEmail],
    },
    NotificacionesService,
  ],
  exports: [CorreoService, NotificacionesService],
})
export class NotificacionesModule {}
