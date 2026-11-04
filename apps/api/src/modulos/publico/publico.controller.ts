import { Controller, Get } from '@nestjs/common';
import { Publico } from '../../comun/autenticacion/decoradores.js';
import { PublicoService } from './publico.service.js';

/**
 * Canal público de reservas. Sin lógica: delega en `PublicoService`.
 * Toda ruta lleva `@Publico()`: el guard de autenticación es global y las
 * rutas son privadas por defecto.
 */
@Controller('publico')
export class PublicoController {
  constructor(private readonly servicio: PublicoService) {}

  /** Sedes con sus barberos, servicios y configuración del asistente. */
  @Get('opciones')
  @Publico()
  opciones() {
    return this.servicio.opciones();
  }
}
