import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CODIGOS_ERROR } from '@cds/shared';
import { PrismaService } from '../../comun/prisma/prisma.service.js';
import { ConfiguracionNegocioService } from '../../comun/configuracion/configuracion-negocio.service.js';
import { AuditoriaService } from '../../comun/auditoria/auditoria.service.js';
import { ErrorNegocio } from '../../comun/excepciones/error-negocio.js';
import type { UsuarioAutenticado } from '../../comun/autenticacion/tipos.js';

export interface EstadoFidelidad {
  activo: boolean;
  sellosDisponibles: number;
  sellosRequeridos: number;
  faltanParaPremio: number;
  tienePremio: boolean;
  mensaje: string | null;
  /** Sellos que caducan en los próximos 30 días. */
  sellosPorCaducar: number;
  premiosCanjeados: number;
}

/**
 * Programa de fidelidad: la tarjeta de cortes.
 *
 * El modelo es de sellos, no de contador. Cada reserva completada que incluya
 * al menos un servicio marcado como `cuentaFidelidad` genera exactamente un
 * sello (restricción de unicidad por reserva en la base de datos, así que no
 * hay forma de duplicarlo ni reintentando).
 *
 * La razón de no usar un simple contador es la que planteó el cliente: si un
 * cliente dice que vino ocho veces y el sistema tiene seis, con un contador no
 * hay nada que mirar. Con sellos, cada uno apunta a su reserva, con su fecha,
 * su sede y su barbero — y lo que falta también se ve: la visita que nadie
 * registró simplemente no existe, y la auditoría muestra quién atendió ese día
 * sin crear la ficha.
 *
 * Al canjear, los sellos no se borran: se marcan con el id del canje. El
 * histórico queda intacto y se puede reconstruir cualquier premio pasado.
 */
@Injectable()
export class FidelidadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configuracion: ConfiguracionNegocioService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async estado(clienteId: string): Promise<EstadoFidelidad> {
    const programa = await this.configuracion.obtenerFidelidad();
    const ahora = new Date();
    const en30Dias = new Date(ahora.getTime() + 30 * 86_400_000);

    const [disponibles, porCaducar, canjeados] = await Promise.all([
      this.prisma.selloFidelidad.count({
        where: {
          clienteId,
          canjeId: null,
          OR: [{ caducaEn: null }, { caducaEn: { gt: ahora } }],
        },
      }),
      this.prisma.selloFidelidad.count({
        where: { clienteId, canjeId: null, caducaEn: { gt: ahora, lte: en30Dias } },
      }),
      this.prisma.canjeFidelidad.count({ where: { clienteId } }),
    ]);

    const tienePremio = programa.activo && disponibles >= programa.sellosRequeridos;

    return {
      activo: programa.activo,
      sellosDisponibles: disponibles,
      sellosRequeridos: programa.sellosRequeridos,
      faltanParaPremio: Math.max(0, programa.sellosRequeridos - disponibles),
      tienePremio,
      mensaje: tienePremio ? programa.mensajePremio : null,
      sellosPorCaducar: porCaducar,
      premiosCanjeados: canjeados,
    };
  }

  /**
   * Genera el sello de una reserva completada.
   *
   * Se llama dentro de la transacción que completa la reserva, para que no
   * pueda quedar una visita cobrada sin su sello (ni al revés).
   */
  async generarSello(
    tx: Prisma.TransactionClient,
    datos: { clienteId: string; reservaId: string; sedeId: string; cuentaFidelidad: boolean },
  ): Promise<boolean> {
    const programa = await this.configuracion.obtenerFidelidad();
    if (!programa.activo || !datos.cuentaFidelidad) return false;

    // El cliente genérico no acumula: es lo que hace que no registrar al
    // cliente tenga consecuencias visibles.
    const cliente = await tx.cliente.findUnique({
      where: { id: datos.clienteId },
      select: { esGenerico: true },
    });
    if (!cliente || cliente.esGenerico) return false;

    const yaExiste = await tx.selloFidelidad.findUnique({
      where: { reservaId: datos.reservaId },
      select: { id: true },
    });
    if (yaExiste) return false;

    await tx.selloFidelidad.create({
      data: {
        clienteId: datos.clienteId,
        reservaId: datos.reservaId,
        sedeId: datos.sedeId,
        caducaEn: programa.diasValidezSello
          ? new Date(Date.now() + programa.diasValidezSello * 86_400_000)
          : null,
      },
    });

    return true;
  }

  /**
   * Canjea el premio y marca los sellos consumidos.
   *
   * Consume los sellos **más antiguos primero**: así los que están a punto de
   * caducar se aprovechan antes de perderse, que es lo que el cliente espera.
   */
  async canjear(
    tx: Prisma.TransactionClient,
    datos: {
      clienteId: string;
      reservaId: string;
      valorCubierto: Prisma.Decimal | number;
      autorizadoPorId?: string;
      notas?: string;
    },
  ): Promise<{ canjeId: string; sellosConsumidos: number }> {
    const programa = await this.configuracion.obtenerFidelidad();

    if (!programa.activo) {
      throw new ErrorNegocio(CODIGOS_ERROR.PROGRAMA_FIDELIDAD_INACTIVO, 409);
    }

    const yaCanjeado = await tx.canjeFidelidad.findUnique({
      where: { reservaId: datos.reservaId },
      select: { id: true },
    });
    if (yaCanjeado) throw new ErrorNegocio(CODIGOS_ERROR.CANJE_YA_APLICADO, 409);

    const sellos = await tx.selloFidelidad.findMany({
      where: {
        clienteId: datos.clienteId,
        canjeId: null,
        OR: [{ caducaEn: null }, { caducaEn: { gt: new Date() } }],
      },
      orderBy: { creadoEn: 'asc' },
      take: programa.sellosRequeridos,
      select: { id: true },
    });

    if (sellos.length < programa.sellosRequeridos) {
      throw new ErrorNegocio(CODIGOS_ERROR.SELLOS_INSUFICIENTES, 409, {
        disponibles: sellos.length,
        requeridos: programa.sellosRequeridos,
        faltan: programa.sellosRequeridos - sellos.length,
      });
    }

    const canje = await tx.canjeFidelidad.create({
      data: {
        clienteId: datos.clienteId,
        reservaId: datos.reservaId,
        autorizadoPorId: datos.autorizadoPorId ?? null,
        sellosConsumidos: sellos.length,
        valorCubierto: datos.valorCubierto,
        notas: datos.notas,
      },
    });

    await tx.selloFidelidad.updateMany({
      where: { id: { in: sellos.map((s) => s.id) } },
      data: { canjeId: canje.id },
    });

    return { canjeId: canje.id, sellosConsumidos: sellos.length };
  }

  /** Si el cliente tiene premio disponible: lo consulta el panel al reservar. */
  async tienePremio(clienteId: string): Promise<boolean> {
    return (await this.estado(clienteId)).tienePremio;
  }

  /** Historial de sellos y canjes de un cliente: la pestaña de su ficha. */
  async historial(clienteId: string) {
    const [sellos, canjes] = await Promise.all([
      this.prisma.selloFidelidad.findMany({
        where: { clienteId },
        orderBy: { creadoEn: 'desc' },
        take: 60,
        select: {
          id: true,
          creadoEn: true,
          caducaEn: true,
          canjeId: true,
          reserva: {
            select: {
              codigo: true,
              inicioEn: true,
              barbero: { select: { nombre: true, alias: true } },
              sede: { select: { nombre: true } },
              servicios: { select: { nombreSnapshot: true } },
            },
          },
        },
      }),
      this.prisma.canjeFidelidad.findMany({
        where: { clienteId },
        orderBy: { creadoEn: 'desc' },
        take: 20,
        select: {
          id: true,
          creadoEn: true,
          sellosConsumidos: true,
          valorCubierto: true,
          notas: true,
          autorizadoPor: { select: { nombre: true, alias: true } },
          reserva: { select: { codigo: true, inicioEn: true } },
        },
      }),
    ]);

    return { sellos, canjes };
  }

  /** Clientes con premio disponible: la lista para avisarles. */
  async conPremioDisponible(sedeId?: string) {
    const programa = await this.configuracion.obtenerFidelidad();
    if (!programa.activo) return [];

    return this.prisma.$queryRaw<
      {
        id: string;
        nombreCompleto: string;
        telefono: string;
        sellos: bigint;
        ultimaVisitaEn: Date | null;
      }[]
    >`
      SELECT c.id, c."nombreCompleto", c.telefono, c."ultimaVisitaEn", count(s.id) AS sellos
      FROM clientes c
      JOIN sellos_fidelidad s ON s."clienteId" = c.id
        AND s."canjeId" IS NULL
        AND (s."caducaEn" IS NULL OR s."caducaEn" > now())
        ${sedeId ? Prisma.sql`AND (${programa.acumulaPorSede} = false OR s."sedeId" = ${sedeId}::uuid)` : Prisma.empty}
      WHERE c."eliminadoEn" IS NULL AND c.activo = true AND c."esGenerico" = false
      GROUP BY c.id
      HAVING count(s.id) >= ${programa.sellosRequeridos}
      ORDER BY count(s.id) DESC, c."ultimaVisitaEn" DESC NULLS LAST
      LIMIT 200
    `;
  }

  /** Cambios en la configuración del programa. */
  async actualizarPrograma(
    datos: Prisma.ProgramaFidelidadUpdateInput,
    actor: UsuarioAutenticado,
  ) {
    const antes = await this.configuracion.obtenerFidelidad();
    const despues = await this.prisma.programaFidelidad.update({ where: { id: 1 }, data: datos });
    this.configuracion.invalidar();

    await this.auditoria.registrarCambio({
      accion: 'ACTUALIZAR',
      entidad: 'ProgramaFidelidad',
      entidadId: '1',
      antes: antes as unknown as Record<string, unknown>,
      despues: despues as unknown as Record<string, unknown>,
      resumen:
        antes.sellosRequeridos !== despues.sellosRequeridos
          ? `Cambió el programa de fidelidad: ahora hacen falta ${despues.sellosRequeridos} sellos (antes ${antes.sellosRequeridos})`
          : 'Editó la configuración del programa de fidelidad',
      actor,
    });

    return despues;
  }
}
