import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConfiguracionGlobal, ProgramaFidelidad } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Configuración del negocio, con caché en memoria.
 *
 * Estos valores (slot por defecto, buffer entre clientes, plazos de
 * cancelación, sellos para el premio) se leen en casi todas las operaciones de
 * agenda y reservas, y cambian una vez cada varios meses. Leerlos de la base
 * de datos en cada cálculo de disponibilidad sería desperdiciar consultas; por
 * eso se cachean y la caché se invalida al guardar.
 *
 * La caché es por proceso. Con varias instancias detrás del balanceador, un
 * cambio tarda como mucho el TTL en propagarse a todas: para estos valores es
 * perfectamente aceptable.
 */
@Injectable()
export class ConfiguracionNegocioService {
  private readonly logger = new Logger(ConfiguracionNegocioService.name);
  private static readonly TTL_MS = 60_000;

  private cacheConfig: { valor: ConfiguracionGlobal; expira: number } | null = null;
  private cacheFidelidad: { valor: ProgramaFidelidad; expira: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async obtener(): Promise<ConfiguracionGlobal> {
    if (this.cacheConfig && this.cacheConfig.expira > Date.now()) {
      return this.cacheConfig.valor;
    }

    // `upsert` en lugar de `findUnique`: si la fila no existe (base recién
    // creada, o un despliegue sin seed) se crea con los valores por defecto en
    // vez de dejar la API inservible.
    const valor = await this.prisma.configuracionGlobal.upsert({
      where: { id: 1 },
      update: {},
      create: {
        id: 1,
        zonaHoraria: this.config.get<string>('BUSINESS_TIMEZONE') ?? 'America/Bogota',
      },
    });

    this.cacheConfig = { valor, expira: Date.now() + ConfiguracionNegocioService.TTL_MS };
    return valor;
  }

  async obtenerFidelidad(): Promise<ProgramaFidelidad> {
    if (this.cacheFidelidad && this.cacheFidelidad.expira > Date.now()) {
      return this.cacheFidelidad.valor;
    }

    const valor = await this.prisma.programaFidelidad.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });

    this.cacheFidelidad = { valor, expira: Date.now() + ConfiguracionNegocioService.TTL_MS };
    return valor;
  }

  /** La llaman los servicios de configuración justo después de guardar. */
  invalidar(): void {
    this.cacheConfig = null;
    this.cacheFidelidad = null;
    this.logger.debug('Caché de configuración invalidada');
  }

  /** Zona horaria del negocio: todo lo que se muestra se convierte a esta. */
  async zonaHoraria(): Promise<string> {
    return (await this.obtener()).zonaHoraria;
  }

  /**
   * Slot efectivo de un barbero, resolviendo la cadena de herencia:
   * día concreto de su agenda → preferencia del usuario → valor global.
   *
   * Esto es lo que permite que el administrador cambie el slot global sin
   * pisar la configuración de quien ya puso la suya, tal como se pidió.
   */
  async slotEfectivo(opciones: {
    slotDelDia?: number | null;
    slotDelUsuario?: number | null;
  }): Promise<number> {
    if (opciones.slotDelDia) return opciones.slotDelDia;
    if (opciones.slotDelUsuario) return opciones.slotDelUsuario;
    return (await this.obtener()).slotMinutosDefault;
  }

  /** Buffer efectivo: el del servicio si lo define, si no el global. */
  async bufferEfectivo(bufferDelServicio?: number | null): Promise<number> {
    if (bufferDelServicio !== null && bufferDelServicio !== undefined) return bufferDelServicio;
    return (await this.obtener()).bufferMinutosDefault;
  }
}
