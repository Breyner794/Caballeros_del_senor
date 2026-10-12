import { Injectable } from '@nestjs/common';
import { Prisma, type ConfiguracionGlobal, type DiaEspecial } from '@prisma/client';
import { CODIGOS_ERROR, type ActualizarConfiguracionDto, type CrearDiaEspecialDto } from '@cds/shared';
import { PrismaService } from '../../comun/prisma/prisma.service.js';
import { AuditoriaService } from '../../comun/auditoria/auditoria.service.js';
import { ConfiguracionNegocioService } from '../../comun/configuracion/configuracion-negocio.service.js';
import { ErrorNegocio } from '../../comun/excepciones/error-negocio.js';
import { aFechaPura, fechaLegible, limitesDelDia } from '../../comun/tiempo/tiempo.js';
import type { UsuarioAutenticado } from '../../comun/autenticacion/tipos.js';

export interface ImpactoSlot {
  /** Barberos que heredan el valor global y, por tanto, se verían afectados. */
  barberosAfectados: { id: string; nombre: string; alias: string | null }[];
  /** Barberos con slot propio: el cambio global no les toca. */
  barberosConSlotPropio: { id: string; nombre: string; alias: string | null; slotMinutos: number }[];
}

@Injectable()
export class ConfiguracionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly cache: ConfiguracionNegocioService,
  ) {}

  obtener(): Promise<ConfiguracionGlobal> {
    return this.cache.obtener();
  }

  /**
   * A quién afecta cambiar el slot global.
   *
   * El cliente fue explícito: cambiar el valor general no debe pisar al
   * barbero que ya configuró el suyo. El sistema lo respeta por diseño (la
   * herencia es día → usuario → global), pero el administrador necesita verlo
   * antes de guardar, porque desde fuera «cambiar el valor global» suena a
   * cambiarlo para todos.
   */
  async impactoDelSlot(): Promise<ImpactoSlot> {
    const barberos = await this.prisma.usuario.findMany({
      where: { rol: 'BARBERO', activo: true, eliminadoEn: null },
      select: { id: true, nombre: true, alias: true, slotMinutos: true },
      orderBy: { nombre: 'asc' },
    });

    return {
      barberosAfectados: barberos
        .filter((b) => b.slotMinutos === null)
        .map(({ slotMinutos: _, ...resto }) => resto),
      barberosConSlotPropio: barberos
        .filter((b): b is typeof b & { slotMinutos: number } => b.slotMinutos !== null)
        .map((b) => ({ id: b.id, nombre: b.nombre, alias: b.alias, slotMinutos: b.slotMinutos })),
    };
  }

  async actualizar(
    datos: ActualizarConfiguracionDto,
    actor: UsuarioAutenticado,
  ): Promise<ConfiguracionGlobal> {
    const antes = await this.cache.obtener();

    const despues = await this.prisma.configuracionGlobal.update({
      where: { id: 1 },
      data: { ...datos, actualizadoPorId: actor.id },
    });

    // Sin esto, la API seguiría sirviendo los valores viejos hasta un minuto.
    this.cache.invalidar();

    await this.auditoria.registrarCambio({
      accion: 'ACTUALIZAR',
      entidad: 'ConfiguracionGlobal',
      entidadId: '1',
      antes: antes as unknown as Record<string, unknown>,
      despues: despues as unknown as Record<string, unknown>,
      resumen: this.resumenCambio(antes, despues),
      actor,
    });

    return despues;
  }

  // ========================= DÍAS ESPECIALES ===============================

  async diasEspeciales(desde?: string, hasta?: string): Promise<DiaEspecial[]> {
    const where: Prisma.DiaEspecialWhereInput = {};
    if (desde || hasta) {
      where.fecha = {
        ...(desde ? { gte: aFechaPura(desde) } : {}),
        ...(hasta ? { lte: aFechaPura(hasta) } : {}),
      };
    } else {
      // Por defecto, de hoy en adelante: el histórico de festivos no aporta.
      where.fecha = { gte: aFechaPura(new Date().toISOString().slice(0, 10)) };
    }

    return this.prisma.diaEspecial.findMany({
      where,
      orderBy: { fecha: 'asc' },
      include: { sede: { select: { id: true, nombre: true } } },
    });
  }

  /**
   * Festivo o fecha especial del negocio.
   *
   * Cerrar un día completo afecta a todos los barberos a la vez, así que la
   * comprobación de citas es la misma idea que en el cronograma, pero a escala
   * de barbería: si hay gente con hora ese día, no se cierra sin más.
   */
  async crearDiaEspecial(datos: CrearDiaEspecialDto, actor: UsuarioAutenticado) {
    const zona = await this.cache.zonaHoraria();

    if (datos.tipo === 'FESTIVO_CERRADO' && !datos.forzar) {
      const citas = await this.citasDelDia(datos.fecha, datos.sedeId ?? undefined);
      if (citas.length > 0) {
        throw new ErrorNegocio(
          CODIGOS_ERROR.DIA_CON_RESERVAS,
          409,
          {
            citas: citas.map((c) => ({
              ...c,
              inicioEn: c.inicioEn.toISOString(),
              fechaLegible: fechaLegible(c.inicioEn, zona),
            })),
            total: citas.length,
          },
          `No puedes cerrar el ${datos.fecha}: hay ${citas.length} ${citas.length === 1 ? 'cita reservada' : 'citas reservadas'} ese día. Avisa a esos clientes antes de cerrarlo.`,
        );
      }
    }

    const existente = await this.prisma.diaEspecial.findFirst({
      where: { fecha: aFechaPura(datos.fecha), sedeId: datos.sedeId ?? null },
    });

    const guardado = existente
      ? await this.prisma.diaEspecial.update({
          where: { id: existente.id },
          data: {
            nombre: datos.nombre,
            tipo: datos.tipo,
            horaInicio: datos.horaInicio ?? null,
            horaFin: datos.horaFin ?? null,
            visibleWeb: datos.visibleWeb,
            notas: datos.notas,
          },
        })
      : await this.prisma.diaEspecial.create({
          data: {
            fecha: aFechaPura(datos.fecha),
            sedeId: datos.sedeId ?? null,
            nombre: datos.nombre,
            tipo: datos.tipo,
            horaInicio: datos.horaInicio ?? null,
            horaFin: datos.horaFin ?? null,
            visibleWeb: datos.visibleWeb,
            notas: datos.notas,
          },
        });

    await this.auditoria.registrar({
      accion: existente ? 'ACTUALIZAR' : 'CREAR',
      entidad: 'DiaEspecial',
      entidadId: guardado.id,
      despues: guardado,
      resumen: `${existente ? 'Editó' : 'Registró'} el ${datos.fecha} como "${datos.nombre}" (${
        datos.tipo === 'FESTIVO_CERRADO' ? 'cerrado' : 'abierto con horario especial'
      })`,
      actor,
    });

    return guardado;
  }

  async eliminarDiaEspecial(id: string, actor: UsuarioAutenticado): Promise<void> {
    const dia = await this.prisma.diaEspecial.findUnique({ where: { id } });
    if (!dia) throw ErrorNegocio.noEncontrado('ese día especial');

    await this.prisma.diaEspecial.delete({ where: { id } });

    await this.auditoria.registrar({
      accion: 'ELIMINAR',
      entidad: 'DiaEspecial',
      entidadId: id,
      antes: dia,
      resumen: `Quitó "${dia.nombre}" del ${dia.fecha.toISOString().slice(0, 10)}: el día vuelve a su horario normal`,
      actor,
    });
  }

  // ---------------------------------------------------------- auxiliares

  private async citasDelDia(fecha: string, sedeId?: string) {
    const zona = await this.cache.zonaHoraria();
    const { inicio, fin } = limitesDelDia(fecha, zona);

    const reservas = await this.prisma.reserva.findMany({
      where: {
        ...(sedeId ? { sedeId } : {}),
        estado: { in: ['PENDIENTE', 'CONFIRMADA', 'EN_CURSO'] },
        inicioEn: { gte: inicio, lt: fin },
      },
      orderBy: { inicioEn: 'asc' },
      take: 100,
      select: {
        id: true,
        codigo: true,
        inicioEn: true,
        telefonoContacto: true,
        cliente: { select: { nombreCompleto: true, telefono: true } },
        barbero: { select: { nombre: true, alias: true } },
        sede: { select: { nombre: true } },
      },
    });

    return reservas.map((r) => ({
      id: r.id,
      codigo: r.codigo,
      inicioEn: r.inicioEn,
      cliente: r.cliente?.nombreCompleto ?? 'Cliente sin ficha',
      telefono: r.cliente?.telefono ?? r.telefonoContacto ?? '',
      barbero: r.barbero.alias ?? r.barbero.nombre,
      sede: r.sede.nombre,
    }));
  }

  private resumenCambio(antes: ConfiguracionGlobal, despues: ConfiguracionGlobal): string {
    const cambios: string[] = [];

    if (antes.slotMinutosDefault !== despues.slotMinutosDefault) {
      cambios.push(
        `turnos de ${antes.slotMinutosDefault} → ${despues.slotMinutosDefault} min (solo afecta a quien no tenga el suyo)`,
      );
    }
    if (antes.bufferMinutosDefault !== despues.bufferMinutosDefault) {
      cambios.push(
        `tiempo de limpieza entre clientes ${antes.bufferMinutosDefault} → ${despues.bufferMinutosDefault} min`,
      );
    }
    if (antes.horasLimiteCancelacion !== despues.horasLimiteCancelacion) {
      cambios.push(
        `plazo de cancelación ${antes.horasLimiteCancelacion} → ${despues.horasLimiteCancelacion} h`,
      );
    }
    if (antes.minAntelacionMinutos !== despues.minAntelacionMinutos) {
      cambios.push(
        `antelación mínima ${antes.minAntelacionMinutos} → ${despues.minAntelacionMinutos} min`,
      );
    }
    if (antes.requiereConfirmacion !== despues.requiereConfirmacion) {
      cambios.push(
        despues.requiereConfirmacion
          ? 'las reservas de la web pasan a requerir confirmación'
          : 'las reservas de la web ya no requieren confirmación',
      );
    }

    return `Cambió la configuración general${cambios.length ? `: ${cambios.join('; ')}` : ''}`;
  }
}
