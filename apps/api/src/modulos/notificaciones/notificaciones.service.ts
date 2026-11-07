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

/** Lo justo para encontrar la fila fallida en la base y en el log: ningún dato del cliente. */
interface FilaFallida {
  id: string;
  clave: string;
  canal: CanalNotificacion;
  reservaId: string;
}

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
      await this.marcarFallida(
        { id: fila.id, clave: datos.clave, canal: datos.canal, reservaId: datos.reservaId },
        `No hay plantilla activa «${datos.clave}» para el canal ${datos.canal}`,
      );
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
      await this.marcarFallida(
        { id: fila.id, clave: datos.clave, canal: datos.canal, reservaId: datos.reservaId },
        fallo instanceof Error ? fallo.message : String(fallo),
      );
    }
  }

  /**
   * Marcar la fila `FALLIDA` no basta: nadie recoge todavía las filas
   * `PENDIENTE` ni `FALLIDA`, así que una plantilla sin sembrar o un proveedor
   * que rechaza el envío dejan al cliente sin su enlace de gestión —la única
   * llave de su cita— y el sistema no se queja. El log a nivel `error` es hoy
   * la única alarma, y por eso lleva los identificadores con los que se puede
   * encontrar la fila (`notificacion.id` y `reservaId`).
   *
   * No se registra ni el destino ni el payload: llevan el correo del cliente y
   * el enlace con el token.
   */
  private async marcarFallida(datos: FilaFallida, error: string): Promise<void> {
    await this.prisma.notificacion.update({
      where: { id: datos.id },
      data: { estado: 'FALLIDA', error, intentos: 1 },
    });
    this.logger.error(
      `Notificación FALLIDA «${datos.clave}» (${datos.canal}) de la reserva ${datos.reservaId}: ${error}. Fila ${datos.id}; nadie reintenta las filas FALLIDA, así que el cliente no recibió este aviso.`,
    );
  }
}
