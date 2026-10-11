import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CODIGOS_ERROR,
  contiene,
  minutosAHora,
  nombreDia,
  telefonoVisible,
  type CrearExcepcionDto,
  type GuardarAgendaSemanalDto,
} from '@cds/shared';
import { PrismaService } from '../../comun/prisma/prisma.service.js';
import { AuditoriaService } from '../../comun/auditoria/auditoria.service.js';
import { ConfiguracionNegocioService } from '../../comun/configuracion/configuracion-negocio.service.js';
import { ErrorNegocio } from '../../comun/excepciones/error-negocio.js';
import {
  aFechaLocal,
  aFechaPura,
  aHoraLocal,
  diaSemanaLocal,
  fechaLegible,
  limitesDelDia,
} from '../../comun/tiempo/tiempo.js';
import type { UsuarioAutenticado } from '../../comun/autenticacion/tipos.js';

/** Cita afectada por un cierre: lo que el panel muestra para poder llamar. */
export interface CitaAfectada {
  id: string;
  codigo: string;
  inicioEn: Date;
  hora: string;
  cliente: string;
  telefono: string;
  telefonoVisible: string;
  servicios: string[];
  total: number;
}

@Injectable()
export class AgendaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly configuracion: ConfiguracionNegocioService,
  ) {}

  /** Plantilla semanal de un barbero en una sede. */
  async semanal(usuarioId: string, sedeId: string) {
    const config = await this.configuracion.obtener();

    const [usuario, dias] = await Promise.all([
      this.prisma.usuario.findFirst({
        where: { id: usuarioId, eliminadoEn: null },
        select: { id: true, nombre: true, apellido: true, alias: true, slotMinutos: true },
      }),
      this.prisma.agendaDia.findMany({
        where: { usuarioId, sedeId },
        include: { bloques: { orderBy: { horaInicio: 'asc' } } },
        orderBy: { diaSemana: 'asc' },
      }),
    ]);

    if (!usuario) throw ErrorNegocio.noEncontrado('ese barbero');

    // Siempre se devuelven los siete días, aunque no estén configurados: la
    // pantalla pinta la semana completa y los días sin configurar aparecen
    // como "no trabaja" en lugar de desaparecer.
    const completos = Array.from({ length: 7 }, (_, diaSemana) => {
      const existente = dias.find((d) => d.diaSemana === diaSemana);
      if (existente) {
        return {
          ...existente,
          nombreDia: nombreDia(diaSemana),
          slotEfectivo:
            existente.slotMinutos ?? usuario.slotMinutos ?? config.slotMinutosDefault,
          /** De dónde sale el slot: el panel lo explica al usuario. */
          origenSlot: existente.slotMinutos
            ? ('DIA' as const)
            : usuario.slotMinutos
              ? ('USUARIO' as const)
              : ('GLOBAL' as const),
        };
      }
      return {
        id: null,
        diaSemana,
        nombreDia: nombreDia(diaSemana),
        trabaja: false,
        horaInicio: 0,
        horaFin: 0,
        slotMinutos: null,
        bloques: [],
        slotEfectivo: usuario.slotMinutos ?? config.slotMinutosDefault,
        origenSlot: usuario.slotMinutos ? ('USUARIO' as const) : ('GLOBAL' as const),
      };
    });

    return {
      usuario,
      sedeId,
      slotGlobal: config.slotMinutosDefault,
      slotUsuario: usuario.slotMinutos,
      dias: completos,
    };
  }

  /**
   * Guarda la semana completa.
   *
   * Antes de escribir se comprueba que ningún día que pase a "no trabaja" ni
   * ninguna jornada recortada deje citas fuera de horario. Es la misma
   * protección que al cerrar un día concreto: el sistema no deja crear un
   * conflicto en silencio, porque el cliente ya tiene su hora apuntada y se
   * presentaría igual.
   */
  async guardarSemanal(
    datos: GuardarAgendaSemanalDto & { forzar?: boolean },
    actor: UsuarioAutenticado,
  ) {
    await this.verificarPuedeEditar(datos.usuarioId, actor);

    const zona = await this.configuracion.zonaHoraria();
    const conflictos = await this.conflictosPorCambioDePlantilla(datos);

    if (conflictos.length > 0 && !datos.forzar) {
      throw new ErrorNegocio(
        CODIGOS_ERROR.DIA_CON_RESERVAS,
        409,
        {
          citas: conflictos.map((c) => ({
            ...c,
            inicioEn: c.inicioEn.toISOString(),
            fechaLegible: fechaLegible(c.inicioEn, zona),
          })),
          total: conflictos.length,
        },
        `Hay ${conflictos.length} ${conflictos.length === 1 ? 'cita ya reservada' : 'citas ya reservadas'} que quedarían fuera del nuevo horario. Habla con esos clientes para reprogramarlas o cancelarlas antes de guardar.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      for (const dia of datos.dias) {
        const agenda = await tx.agendaDia.upsert({
          where: {
            usuarioId_sedeId_diaSemana: {
              usuarioId: datos.usuarioId,
              sedeId: datos.sedeId,
              diaSemana: dia.diaSemana,
            },
          },
          update: {
            trabaja: dia.trabaja,
            horaInicio: dia.horaInicio,
            horaFin: dia.horaFin,
            slotMinutos: dia.slotMinutos ?? null,
          },
          create: {
            usuarioId: datos.usuarioId,
            sedeId: datos.sedeId,
            diaSemana: dia.diaSemana,
            trabaja: dia.trabaja,
            horaInicio: dia.horaInicio,
            horaFin: dia.horaFin,
            slotMinutos: dia.slotMinutos ?? null,
          },
        });

        // Los bloques se reemplazan: la pantalla los edita como un conjunto.
        await tx.agendaBloque.deleteMany({ where: { agendaDiaId: agenda.id } });
        if (dia.bloques.length > 0) {
          await tx.agendaBloque.createMany({
            data: dia.bloques.map((b) => ({
              agendaDiaId: agenda.id,
              tipo: b.tipo,
              horaInicio: b.horaInicio,
              horaFin: b.horaFin,
              etiqueta: b.etiqueta,
            })),
          });
        }
      }
    });

    const resumen = datos.dias
      .filter((d) => d.trabaja)
      .map((d) => `${nombreDia(d.diaSemana)} ${minutosAHora(d.horaInicio)}–${minutosAHora(d.horaFin)}`)
      .join(', ');

    await this.auditoria.registrar({
      accion: 'ACTUALIZAR',
      entidad: 'AgendaDia',
      entidadId: datos.usuarioId,
      despues: { dias: datos.dias },
      resumen: `Configuró el cronograma semanal: ${resumen || 'sin días laborables'}`,
      actor,
    });

    return this.semanal(datos.usuarioId, datos.sedeId);
  }

  /**
   * Excepción para una fecha concreta: día libre, cita médica, horario
   * especial.
   *
   * Esta es la validación que pidió el cliente explícitamente. Si el barbero
   * intenta cerrar un día que ya tiene citas, no se le deja: la respuesta trae
   * la lista de clientes con sus teléfonos para que pueda llamarlos. Solo
   * cuando esas citas estén reprogramadas o canceladas (o si insiste marcando
   * `forzar`, que queda registrado en la auditoría) se aplica el cierre.
   *
   * El motivo es práctico: si el sistema cerrara el día sin avisar, el cliente
   * se presentaría a su hora y se encontraría la puerta cerrada. El enfado se
   * lo lleva la barbería, no el software.
   */
  async crearExcepcion(datos: CrearExcepcionDto, actor: UsuarioAutenticado) {
    await this.verificarPuedeEditar(datos.usuarioId, actor);

    const zona = await this.configuracion.zonaHoraria();
    const citas = await this.citasDelDia(datos.usuarioId, datos.fecha, datos.sedeId ?? undefined);

    // Con un horario especial solo molestan las citas que caen fuera de la
    // nueva ventana; con un cierre, todas.
    const afectadas =
      datos.tipo === 'CERRADO'
        ? citas
        : citas.filter((cita) => {
            if (datos.horaInicio === undefined || datos.horaFin === undefined) return true;
            const minutos = this.minutosDe(cita.inicioEn, zona);
            return !contiene(
              { horaInicio: datos.horaInicio, horaFin: datos.horaFin },
              { horaInicio: minutos.inicio, horaFin: minutos.fin },
            );
          });

    if (afectadas.length > 0 && !datos.forzar) {
      throw new ErrorNegocio(
        CODIGOS_ERROR.DIA_CON_RESERVAS,
        409,
        {
          citas: afectadas.map((c) => ({
            ...c,
            inicioEn: c.inicioEn.toISOString(),
            fechaLegible: fechaLegible(c.inicioEn, zona),
          })),
          total: afectadas.length,
          fecha: datos.fecha,
        },
        datos.tipo === 'CERRADO'
          ? `No puedes cerrar el ${datos.fecha}: tienes ${afectadas.length} ${afectadas.length === 1 ? 'cita reservada' : 'citas reservadas'}. Llama a esos clientes para cambiarles la fecha o cancelarlas, y vuelve a intentarlo.`
          : `Con ese horario quedarían ${afectadas.length} ${afectadas.length === 1 ? 'cita' : 'citas'} fuera de tu jornada. Reprográmalas primero.`,
      );
    }

    const excepcion = await this.prisma.agendaExcepcion.upsert({
      where: {
        usuarioId_fecha_sedeId: {
          usuarioId: datos.usuarioId,
          fecha: aFechaPura(datos.fecha),
          sedeId: datos.sedeId ?? null,
        } as never,
      },
      update: {
        tipo: datos.tipo,
        horaInicio: datos.horaInicio ?? null,
        horaFin: datos.horaFin ?? null,
        motivo: datos.motivo,
      },
      create: {
        usuarioId: datos.usuarioId,
        sedeId: datos.sedeId ?? null,
        fecha: aFechaPura(datos.fecha),
        tipo: datos.tipo,
        horaInicio: datos.horaInicio ?? null,
        horaFin: datos.horaFin ?? null,
        motivo: datos.motivo,
      },
    });

    await this.auditoria.registrar({
      accion: datos.tipo === 'CERRADO' ? 'ACTUALIZAR' : 'CREAR',
      entidad: 'AgendaExcepcion',
      entidadId: excepcion.id,
      despues: excepcion,
      resumen:
        datos.tipo === 'CERRADO'
          ? `Cerró el ${datos.fecha}${datos.motivo ? ` (${datos.motivo})` : ''}${
              afectadas.length > 0
                ? ` FORZANDO el cierre con ${afectadas.length} cita(s) ya reservada(s)`
                : ''
            }`
          : `Puso horario especial el ${datos.fecha}: ${minutosAHora(datos.horaInicio ?? 0)}–${minutosAHora(datos.horaFin ?? 0)}`,
      actor,
    });

    return excepcion;
  }

  async eliminarExcepcion(id: string, actor: UsuarioAutenticado) {
    const excepcion = await this.prisma.agendaExcepcion.findUnique({ where: { id } });
    if (!excepcion) throw ErrorNegocio.noEncontrado('esa excepción');

    await this.verificarPuedeEditar(excepcion.usuarioId, actor);
    await this.prisma.agendaExcepcion.delete({ where: { id } });

    await this.auditoria.registrar({
      accion: 'ELIMINAR',
      entidad: 'AgendaExcepcion',
      entidadId: id,
      antes: excepcion,
      resumen: `Quitó la excepción del ${excepcion.fecha.toISOString().slice(0, 10)}: el día vuelve a su horario normal`,
      actor,
    });
  }

  /** Excepciones de un barbero en un rango: las marca el calendario. */
  async excepciones(usuarioId: string, desde: string, hasta: string) {
    return this.prisma.agendaExcepcion.findMany({
      where: {
        usuarioId,
        fecha: { gte: aFechaPura(desde), lte: aFechaPura(hasta) },
      },
      orderBy: { fecha: 'asc' },
      include: { sede: { select: { id: true, nombre: true } } },
    });
  }

  /**
   * Consulta previa, sin efectos.
   *
   * El panel la llama al elegir una fecha en el diálogo de "marcar día libre",
   * para avisar antes de que el usuario pulse Guardar en lugar de recibir un
   * error después.
   */
  async citasQueImpidenCerrar(usuarioId: string, fecha: string, sedeId?: string) {
    const zona = await this.configuracion.zonaHoraria();
    const citas = await this.citasDelDia(usuarioId, fecha, sedeId);

    return {
      fecha,
      puedeCerrar: citas.length === 0,
      total: citas.length,
      citas: citas.map((c) => ({
        ...c,
        inicioEn: c.inicioEn.toISOString(),
        fechaLegible: fechaLegible(c.inicioEn, zona),
      })),
    };
  }

  // ---------------------------------------------------------- auxiliares

  private async citasDelDia(
    usuarioId: string,
    fecha: string,
    sedeId?: string,
  ): Promise<CitaAfectada[]> {
    const zona = await this.configuracion.zonaHoraria();
    const { inicio, fin } = limitesDelDia(fecha, zona);

    const reservas = await this.prisma.reserva.findMany({
      where: {
        barberoId: usuarioId,
        ...(sedeId ? { sedeId } : {}),
        estado: { in: ['PENDIENTE', 'CONFIRMADA', 'EN_CURSO'] },
        inicioEn: { gte: inicio, lt: fin },
      },
      orderBy: { inicioEn: 'asc' },
      select: {
        id: true,
        codigo: true,
        inicioEn: true,
        total: true,
        nombreContacto: true,
        telefonoContacto: true,
        cliente: { select: { nombreCompleto: true, telefono: true } },
        servicios: { select: { nombreSnapshot: true } },
      },
    });

    return reservas.map((r) => {
      const telefono = r.cliente?.telefono ?? r.telefonoContacto ?? '';
      return {
        id: r.id,
        codigo: r.codigo,
        inicioEn: r.inicioEn,
        hora: aHoraLocal(r.inicioEn, zona),
        cliente: r.cliente?.nombreCompleto ?? r.nombreContacto ?? 'Cliente sin ficha',
        telefono,
        telefonoVisible: telefonoVisible(telefono),
        servicios: r.servicios.map((s) => s.nombreSnapshot),
        total: Number(r.total),
      };
    });
  }

  /** Citas que quedarían fuera de la nueva plantilla semanal. */
  private async conflictosPorCambioDePlantilla(
    datos: GuardarAgendaSemanalDto,
  ): Promise<CitaAfectada[]> {
    const zona = await this.configuracion.zonaHoraria();

    // Solo se miran las citas futuras: el pasado ya ocurrió y no se toca.
    const futuras = await this.prisma.reserva.findMany({
      where: {
        barberoId: datos.usuarioId,
        sedeId: datos.sedeId,
        estado: { in: ['PENDIENTE', 'CONFIRMADA'] },
        inicioEn: { gte: new Date() },
      },
      orderBy: { inicioEn: 'asc' },
      select: {
        id: true,
        codigo: true,
        inicioEn: true,
        finEn: true,
        total: true,
        nombreContacto: true,
        telefonoContacto: true,
        cliente: { select: { nombreCompleto: true, telefono: true } },
        servicios: { select: { nombreSnapshot: true } },
      },
    });

    const conflictos: CitaAfectada[] = [];

    for (const cita of futuras) {
      const dia = diaSemanaLocal(aFechaLocal(cita.inicioEn, zona), zona);
      const nuevo = datos.dias.find((d) => d.diaSemana === dia);
      if (!nuevo) continue; // ese día no se está tocando

      const minutos = this.minutosDe(cita.inicioEn, zona, cita.finEn);

      const encaja =
        nuevo.trabaja &&
        contiene(
          { horaInicio: nuevo.horaInicio, horaFin: nuevo.horaFin },
          { horaInicio: minutos.inicio, horaFin: minutos.fin },
        ) &&
        // Tampoco puede caer dentro de un almuerzo nuevo.
        !nuevo.bloques.some(
          (b) => minutos.inicio < b.horaFin && b.horaInicio < minutos.fin,
        );

      if (!encaja) {
        const telefono = cita.cliente?.telefono ?? cita.telefonoContacto ?? '';
        conflictos.push({
          id: cita.id,
          codigo: cita.codigo,
          inicioEn: cita.inicioEn,
          hora: aHoraLocal(cita.inicioEn, zona),
          cliente: cita.cliente?.nombreCompleto ?? cita.nombreContacto ?? 'Cliente sin ficha',
          telefono,
          telefonoVisible: telefonoVisible(telefono),
          servicios: cita.servicios.map((s) => s.nombreSnapshot),
          total: Number(cita.total),
        });
      }
    }

    return conflictos;
  }

  private minutosDe(inicio: Date, zona: string, fin?: Date) {
    // Importación perezosa evitada: se calcula con Intl para no acoplar este
    // auxiliar al módulo de tiempo en cada llamada.
    const partes = new Intl.DateTimeFormat('es-CO', {
      timeZone: zona,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const leer = (fecha: Date) => {
      const texto = partes.format(fecha);
      const [h, m] = texto.split(':').map(Number);
      return (h ?? 0) * 60 + (m ?? 0);
    };
    const minutosInicio = leer(inicio);
    return { inicio: minutosInicio, fin: fin ? leer(fin) : minutosInicio };
  }

  /**
   * Un barbero configura su propia agenda; el administrador y la recepción, la
   * de cualquiera. Se comprueba en el servicio y no solo en el guard porque
   * el `usuarioId` viaja en el cuerpo de la petición.
   */
  private async verificarPuedeEditar(usuarioId: string, actor: UsuarioAutenticado): Promise<void> {
    if (actor.permisos.includes('agenda:gestionar_todas')) return;
    if (actor.id === usuarioId && actor.permisos.includes('agenda:gestionar_propia')) return;
    throw ErrorNegocio.sinPermiso('editar la agenda de otro barbero');
  }
}
