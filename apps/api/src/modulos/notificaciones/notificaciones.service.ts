import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CanalNotificacion, PlantillaNotificacion, Prisma } from '@prisma/client';
import { PrismaService } from '../../comun/prisma/prisma.service.js';
import { ProveedorSinConfigurar } from './correo.service.js';

/** Cómo se entrega una notificación por un canal concreto. */
export interface AdaptadorNotificacion {
  /** Lanza si no se pudo entregar. */
  enviar(
    plantilla: Pick<PlantillaNotificacion, 'asunto' | 'cuerpo' | 'plantillaMeta' | 'plantillaBrevo'>,
    destino: string,
    variables: Record<string, string>,
  ): Promise<{ idExterno?: string }>;
}

/**
 * Adaptadores por canal. Un canal que no está en el mapa (hoy `WHATSAPP` y
 * `SMS`) no es un error: sus notificaciones quedan `PENDIENTE` hasta que alguien
 * registre su adaptador en `NotificacionesModule`.
 */
export type AdaptadoresNotificacion = Partial<Record<CanalNotificacion, AdaptadorNotificacion>>;
export const ADAPTADORES_NOTIFICACION = Symbol('ADAPTADORES_NOTIFICACION');

export interface DatosNotificacion {
  reservaId: string;
  clienteId: string;
  /** Identificador estable de la plantilla: `reserva.confirmada`. */
  clave: string;
  canal: CanalNotificacion;
  /** Correo o teléfono E.164, según el canal. */
  destino: string;
  variables: Record<string, string>;
  /** Variables que se envían pero no se guardan en la fila (secretos como el enlace con token). */
  omitirDelPayload?: string[];
}

/**
 * Registra y despacha notificaciones a clientes.
 *
 * Los módulos de dominio piden «notifica esto» con `encolar` y no saben por qué
 * canal sale. `encolar` nunca lanza: una notificación es una comodidad y no debe
 * deshacer ni estorbar la operación que la originó.
 */
@Injectable()
export class NotificacionesService {
  private readonly logger = new Logger(NotificacionesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ADAPTADORES_NOTIFICACION) private readonly adaptadores: AdaptadoresNotificacion,
  ) {}

  async encolar(datos: DatosNotificacion): Promise<void> {
    try {
      await this.registrarYDespachar(datos);
    } catch (fallo) {
      // Sin `datos` en el mensaje: llevan el enlace con el token de la cita.
      this.logger.error(
        `No se pudo encolar «${datos.clave}» (${datos.canal}) de la reserva ${datos.reservaId}: ${
          fallo instanceof Error ? fallo.message : String(fallo)
        }`,
      );
    }
  }

  private async registrarYDespachar(datos: DatosNotificacion): Promise<void> {
    const plantilla = await this.prisma.plantillaNotificacion.findFirst({
      where: { clave: datos.clave, canal: datos.canal, activa: true },
    });

    const omitidas = new Set(datos.omitirDelPayload ?? []);
    const payload = Object.fromEntries(
      Object.entries(datos.variables).filter(([nombre]) => !omitidas.has(nombre)),
    ) as Prisma.InputJsonObject;

    // Primero queda registrada: si el proceso muere a medio envío, la fila existe.
    const fila = await this.prisma.notificacion.create({
      data: {
        canal: datos.canal,
        plantillaId: plantilla?.id ?? null,
        destino: datos.destino,
        clienteId: datos.clienteId,
        reservaId: datos.reservaId,
        estado: 'PENDIENTE',
        payload,
      },
    });

    const adaptador = this.adaptadores[datos.canal];
    // Canal planificado sin adaptador: encolada, no perdida.
    if (!adaptador) return;

    if (!plantilla) {
      await this.marcarFallida(fila.id, `No hay plantilla activa «${datos.clave}» para el canal ${datos.canal}`);
      return;
    }

    try {
      const { idExterno } = await adaptador.enviar(plantilla, datos.destino, datos.variables);
      await this.prisma.notificacion.update({
        where: { id: fila.id },
        data: { estado: 'ENVIADA', idExterno: idExterno ?? null, intentos: 1, enviadaEn: new Date() },
      });
    } catch (fallo) {
      // Sin credenciales (desarrollo) no es un fallo: la fila sigue pendiente.
      if (fallo instanceof ProveedorSinConfigurar) return;
      await this.marcarFallida(fila.id, fallo instanceof Error ? fallo.message : String(fallo));
    }
  }

  private async marcarFallida(id: string, error: string): Promise<void> {
    await this.prisma.notificacion.update({
      where: { id },
      data: { estado: 'FALLIDA', error, intentos: 1 },
    });
  }
}
