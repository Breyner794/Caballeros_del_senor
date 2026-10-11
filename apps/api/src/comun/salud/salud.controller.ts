import { Controller, Get } from '@nestjs/common';
import { Publico } from '../autenticacion/decoradores.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Comprobación de salud para Dokploy y el balanceador.
 *
 * `/salud` responde siempre que el proceso esté vivo (comprobación de
 * liveness) y `/salud/listo` verifica además que la base de datos responde
 * (readiness): si Postgres no está, el contenedor no debe recibir tráfico.
 */
@Controller('salud')
export class SaludController {
  constructor(private readonly prisma: PrismaService) {}

  @Publico()
  @Get()
  vivo() {
    return { estado: 'ok', marcaTiempo: new Date().toISOString() };
  }

  @Publico()
  @Get('listo')
  async listo() {
    const inicio = Date.now();
    await this.prisma.$queryRaw`SELECT 1`;
    return {
      estado: 'ok',
      baseDatos: { conectada: true, latenciaMs: Date.now() - inicio },
      marcaTiempo: new Date().toISOString(),
    };
  }
}
