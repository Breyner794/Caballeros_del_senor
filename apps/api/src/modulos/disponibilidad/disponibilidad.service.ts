import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  CODIGOS_ERROR,
  generarInicios,
  restarBloques,
  seSolapan,
  type DiaCalendario,
  type DisponibilidadBarbero,
  type HuecoDisponible,
  type RangoMinutos,
} from '@cds/shared';
import { PrismaService } from '../../comun/prisma/prisma.service.js';
import { ConfiguracionNegocioService } from '../../comun/configuracion/configuracion-negocio.service.js';
import { ErrorNegocio } from '../../comun/excepciones/error-negocio.js';
import {
  aFechaLocal,
  aFechaPura,
  aHoraLocal,
  aInstante,
  aMinutosDelDia,
  diaSemanaLocal,
  hoyLocal,
  limitesDelRango,
  rangoDeFechas,
} from '../../comun/tiempo/tiempo.js';

/** Lo que ocupa un hueco de la agenda, venga de una cita o de un descanso. */
interface Ocupacion extends RangoMinutos {
  motivo: 'OCUPADO' | 'ALMUERZO' | 'DESCANSO';
}

export interface OpcionesDisponibilidad {
  sedeId: string;
  barberoId?: string;
  fecha: string;
  servicioIds: string[];
  /** Al reprogramar, ignora la propia cita para que no choque consigo misma. */
  excluirReservaId?: string;
  /**
   * Las reglas de antelación mínima solo se aplican al cliente de la web. La
   * recepción tiene que poder registrar una cita para dentro de diez minutos,
   * porque el cliente ya está en el local.
   */
  aplicarReglasCliente?: boolean;
}

/**
 * Motor de disponibilidad.
 *
 * Es el corazón del sistema: de aquí salen los huecos que se ofrecen en el
 * panel, los que ve el cliente en la web y la validación de que una cita se
 * puede crear. Por eso la misma función sirve para las tres cosas — si el
 * cálculo de "qué está libre" viviera en dos sitios, un día ofrecerían cosas
 * distintas y se duplicarían citas.
 *
 * El cálculo proyecta, para un barbero y un día, estas capas en orden:
 *
 *   1. ¿Abre la barbería ese día? (festivos y días especiales globales)
 *   2. ¿Abre esa sede ese día? (horario del local)
 *   3. ¿Trabaja el barbero? (su plantilla semanal)
 *   4. ¿Hay una excepción para esa fecha? (día libre, cita médica, horario
 *      especial — esta capa manda sobre la plantilla)
 *   5. Se restan almuerzos y descansos
 *   6. Se restan las citas ya existentes, contando su tiempo de limpieza
 *   7. Se generan los inicios cada N minutos (el slot) y se descarta todo
 *      inicio donde el servicio completo no quepa antes del cierre o del
 *      siguiente bloque
 */
@Injectable()
export class DisponibilidadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configuracion: ConfiguracionNegocioService,
  ) {}

  /** Disponibilidad de uno o de todos los barberos de una sede en un día. */
  async delDia(opciones: OpcionesDisponibilidad): Promise<{
    fecha: string;
    laborable: boolean;
    motivo?: string;
    duracionNecesaria: number;
    barberos: DisponibilidadBarbero[];
  }> {
    const config = await this.configuracion.obtener();
    const zona = config.zonaHoraria;
    const diaSemana = diaSemanaLocal(opciones.fecha, zona);

    const { duracionServicio, buffer } = await this.duracionDe(opciones.servicioIds);
    const duracionNecesaria = duracionServicio + buffer;

    // --- Capa 1: ¿la barbería abre ese día? --------------------------------
    const diaEspecial = await this.prisma.diaEspecial.findFirst({
      where: {
        fecha: aFechaPura(opciones.fecha),
        OR: [{ sedeId: null }, { sedeId: opciones.sedeId }],
      },
      // Lo específico de la sede manda sobre la regla global.
      orderBy: { sedeId: 'desc' },
    });

    if (diaEspecial?.tipo === 'FESTIVO_CERRADO') {
      return {
        fecha: opciones.fecha,
        laborable: false,
        motivo: diaEspecial.nombre,
        duracionNecesaria,
        barberos: [],
      };
    }

    // --- Capa 2: horario de la sede ----------------------------------------
    const horarioSede = await this.prisma.sedeHorario.findUnique({
      where: { sedeId_diaSemana: { sedeId: opciones.sedeId, diaSemana } },
    });

    if (!horarioSede || horarioSede.cerrado) {
      return {
        fecha: opciones.fecha,
        laborable: false,
        motivo: 'La sede no abre ese día',
        duracionNecesaria,
        barberos: [],
      };
    }

    // El día especial "abierto" o "con horario especial" pisa el horario normal.
    const ventanaSede: RangoMinutos =
      diaEspecial && diaEspecial.horaInicio !== null && diaEspecial.horaFin !== null
        ? { horaInicio: diaEspecial.horaInicio, horaFin: diaEspecial.horaFin }
        : { horaInicio: horarioSede.horaInicio, horaFin: horarioSede.horaFin };

    // --- Capas 3 y 4: agenda del barbero y excepciones ---------------------
    const agendas = await this.prisma.agendaDia.findMany({
      where: {
        sedeId: opciones.sedeId,
        diaSemana,
        ...(opciones.barberoId ? { usuarioId: opciones.barberoId } : {}),
        usuario: { activo: true, eliminadoEn: null, rol: 'BARBERO' },
      },
      include: {
        bloques: true,
        usuario: {
          select: { id: true, nombre: true, apellido: true, alias: true, fotoUrl: true, slotMinutos: true },
        },
      },
      orderBy: { usuario: { nombre: 'asc' } },
    });

    if (agendas.length === 0) {
      return {
        fecha: opciones.fecha,
        laborable: true,
        motivo: opciones.barberoId
          ? 'El barbero no tiene agenda configurada en esa sede'
          : 'Ningún barbero tiene agenda configurada en esa sede',
        duracionNecesaria,
        barberos: [],
      };
    }

    const idsBarberos = agendas.map((a) => a.usuarioId);

    const [excepciones, reservas] = await Promise.all([
      this.prisma.agendaExcepcion.findMany({
        where: {
          usuarioId: { in: idsBarberos },
          fecha: aFechaPura(opciones.fecha),
          OR: [{ sedeId: null }, { sedeId: opciones.sedeId }],
        },
      }),
      this.reservasDelDia(idsBarberos, opciones.fecha, zona, opciones.excluirReservaId),
    ]);

    const ahora = new Date();
    const minutosAhora = aMinutosDelDia(ahora, zona);
    const esHoy = opciones.fecha === hoyLocal(zona);
    const antelacion = opciones.aplicarReglasCliente ? config.minAntelacionMinutos : 0;

    const barberos: DisponibilidadBarbero[] = [];

    for (const agenda of agendas) {
      const excepcion = excepciones.find((e) => e.usuarioId === agenda.usuarioId);
      const nombre = `${agenda.usuario.nombre}${agenda.usuario.apellido ? ` ${agenda.usuario.apellido}` : ''}`;

      const base: Omit<DisponibilidadBarbero, 'huecos' | 'librestotal' | 'ocupadosTotal'> = {
        barberoId: agenda.usuarioId,
        barberoNombre: nombre,
        alias: agenda.usuario.alias,
        fotoUrl: agenda.usuario.fotoUrl,
        trabaja: true,
        jornada: null,
        slotMinutos: await this.configuracion.slotEfectivo({
          slotDelDia: agenda.slotMinutos,
          slotDelUsuario: agenda.usuario.slotMinutos,
        }),
      };

      // La excepción de fecha concreta manda sobre la plantilla semanal.
      if (excepcion?.tipo === 'CERRADO') {
        barberos.push({
          ...base,
          trabaja: false,
          motivoNoTrabaja: excepcion.motivo ?? 'No disponible ese día',
          huecos: [],
          librestotal: 0,
          ocupadosTotal: 0,
        });
        continue;
      }

      if (!agenda.trabaja && excepcion?.tipo !== 'HORARIO_ESPECIAL') {
        barberos.push({
          ...base,
          trabaja: false,
          motivoNoTrabaja: 'No atiende ese día',
          huecos: [],
          librestotal: 0,
          ocupadosTotal: 0,
        });
        continue;
      }

      const jornadaBarbero: RangoMinutos =
        excepcion?.tipo === 'HORARIO_ESPECIAL' &&
        excepcion.horaInicio !== null &&
        excepcion.horaFin !== null
          ? { horaInicio: excepcion.horaInicio, horaFin: excepcion.horaFin }
          : { horaInicio: agenda.horaInicio, horaFin: agenda.horaFin };

      // La jornada efectiva es la intersección con el horario de la sede: un
      // barbero no puede atender con el local cerrado.
      const jornada: RangoMinutos = {
        horaInicio: Math.max(jornadaBarbero.horaInicio, ventanaSede.horaInicio),
        horaFin: Math.min(jornadaBarbero.horaFin, ventanaSede.horaFin),
      };

      if (jornada.horaFin <= jornada.horaInicio) {
        barberos.push({
          ...base,
          trabaja: false,
          motivoNoTrabaja: 'Su horario queda fuera del horario de la sede',
          huecos: [],
          librestotal: 0,
          ocupadosTotal: 0,
        });
        continue;
      }

      // --- Capas 5 y 6: se restan bloques y citas --------------------------
      const ocupaciones: Ocupacion[] = [
        ...agenda.bloques.map((b) => ({
          horaInicio: b.horaInicio,
          horaFin: b.horaFin,
          motivo: (b.tipo === 'ALMUERZO' ? 'ALMUERZO' : 'DESCANSO') as Ocupacion['motivo'],
        })),
        ...reservas
          .filter((r) => r.barberoId === agenda.usuarioId)
          .map((r) => ({
            horaInicio: aMinutosDelDia(r.inicioEn, zona),
            // Se usa el fin CON buffer: el tiempo de limpieza también ocupa.
            horaFin: aMinutosDelDia(r.finConBufferEn, zona),
            motivo: 'OCUPADO' as const,
          })),
      ];

      // --- Capa 7: generación de inicios ----------------------------------
      const tramosLibres = restarBloques(
        jornada,
        ocupaciones.map((o) => ({ horaInicio: o.horaInicio, horaFin: o.horaFin })),
      );

      const huecos: HuecoDisponible[] = [];
      const paso = base.slotMinutos;

      // Se recorre la jornada completa para poder mostrar también los huecos
      // ocupados: el panel los pinta en gris y así el barbero ve su día entero,
      // no solo lo que queda libre.
      for (const inicio of generarInicios(jornada, paso, paso)) {
        const motivo = this.motivoDelInicio({
          inicio,
          jornada,
          ocupaciones,
          tramosLibres,
          duracionNecesaria,
          esHoy,
          minutosAhora,
          antelacion,
        });

        huecos.push({
          inicioEn: aInstante(opciones.fecha, inicio, zona).toISOString(),
          hora: aHoraLocal(aInstante(opciones.fecha, inicio, zona), zona),
          disponible: motivo === undefined,
          ...(motivo ? { motivo } : {}),
        });
      }

      barberos.push({
        ...base,
        jornada,
        huecos,
        librestotal: huecos.filter((h) => h.disponible).length,
        ocupadosTotal: huecos.filter((h) => h.motivo === 'OCUPADO').length,
      });
    }

    return { fecha: opciones.fecha, laborable: true, duracionNecesaria, barberos };
  }

  /**
   * Validación antes de crear o mover una cita.
   *
   * Comprueba que la hora pedida sea exactamente uno de los inicios que el
   * motor ofrece. No basta con mirar si hay solape: una cita a las 9:07 cuando
   * los slots son de 30 minutos deja un hueco inservible de 23 minutos, y a la
   * tercera vez la agenda del barbero es un queso gruyere.
   *
   * Devuelve además alternativas cercanas, para que el panel pueda sugerir
   * "¿las 10:00?" en lugar de un error seco.
   */
  async validarHueco(opciones: {
    sedeId: string;
    barberoId: string;
    inicioEn: Date;
    servicioIds: string[];
    excluirReservaId?: string;
    aplicarReglasCliente?: boolean;
  }): Promise<void> {
    const zona = await this.configuracion.zonaHoraria();
    const config = await this.configuracion.obtener();
    const fecha = aFechaLocal(opciones.inicioEn, zona);

    if (opciones.inicioEn.getTime() < Date.now()) {
      throw new ErrorNegocio(CODIGOS_ERROR.RESERVA_EN_EL_PASADO, 400);
    }

    if (opciones.aplicarReglasCliente) {
      const minutosHasta = (opciones.inicioEn.getTime() - Date.now()) / 60_000;
      if (minutosHasta < config.minAntelacionMinutos) {
        throw new ErrorNegocio(CODIGOS_ERROR.ANTELACION_INSUFICIENTE, 400, {
          minAntelacionMinutos: config.minAntelacionMinutos,
        });
      }
      const diasHasta = (opciones.inicioEn.getTime() - Date.now()) / 86_400_000;
      if (diasHasta > config.maxDiasAnticipacion) {
        throw new ErrorNegocio(CODIGOS_ERROR.FECHA_DEMASIADO_LEJANA, 400, {
          maxDiasAnticipacion: config.maxDiasAnticipacion,
        });
      }
    }

    const resultado = await this.delDia({
      sedeId: opciones.sedeId,
      barberoId: opciones.barberoId,
      fecha,
      servicioIds: opciones.servicioIds,
      excluirReservaId: opciones.excluirReservaId,
      aplicarReglasCliente: opciones.aplicarReglasCliente,
    });

    if (!resultado.laborable) {
      throw new ErrorNegocio(CODIGOS_ERROR.DIA_NO_LABORABLE, 409, { motivo: resultado.motivo });
    }

    const barbero = resultado.barberos.find((b) => b.barberoId === opciones.barberoId);
    if (!barbero) {
      throw new ErrorNegocio(CODIGOS_ERROR.BARBERO_NO_PERTENECE_A_SEDE, 409);
    }
    if (!barbero.trabaja) {
      throw new ErrorNegocio(CODIGOS_ERROR.BARBERO_NO_TRABAJA_ESE_DIA, 409, {
        motivo: barbero.motivoNoTrabaja,
      });
    }

    const buscado = opciones.inicioEn.toISOString();
    const hueco = barbero.huecos.find((h) => h.inicioEn === buscado);

    if (!hueco) {
      throw new ErrorNegocio(CODIGOS_ERROR.HORARIO_FUERA_DE_JORNADA, 409, {
        alternativas: this.alternativas(barbero, opciones.inicioEn),
        slotMinutos: barbero.slotMinutos,
      });
    }

    if (!hueco.disponible) {
      const codigo =
        hueco.motivo === 'OCUPADO'
          ? CODIGOS_ERROR.RESERVA_SOLAPADA
          : hueco.motivo === 'ANTELACION'
            ? CODIGOS_ERROR.ANTELACION_INSUFICIENTE
            : hueco.motivo === 'PASADO'
              ? CODIGOS_ERROR.RESERVA_EN_EL_PASADO
              : CODIGOS_ERROR.HORARIO_FUERA_DE_JORNADA;

      throw new ErrorNegocio(codigo, 409, {
        alternativas: this.alternativas(barbero, opciones.inicioEn),
      });
    }
  }

  /**
   * Primer hueco libre a partir de ahora: lo que usa el registro de walk-in.
   *
   * El cliente ya está en la silla, así que la recepción no debería tener que
   * elegir una hora en un desplegable — el sistema propone la siguiente y
   * listo.
   */
  async primerHuecoLibre(opciones: {
    sedeId: string;
    barberoId: string;
    servicioIds: string[];
    desde?: Date;
  }): Promise<{ inicioEn: Date; hora: string; motivo?: undefined } | { inicioEn?: undefined; hora?: undefined; motivo: string }> {
    const zona = await this.configuracion.zonaHoraria();
    const desde = opciones.desde ?? new Date();
    // Se mira hoy y mañana: si no cabe en dos días, la agenda está llena y
    // tiene más sentido que la recepción elija fecha a mano.
    const fechas = rangoDeFechas(
      aFechaLocal(desde, zona),
      aFechaLocal(new Date(desde.getTime() + 86_400_000), zona),
    );

    // Se guarda el motivo del último día revisado para poder explicar por qué
    // no hay hueco. "No hay huecos" y "este barbero no tiene cronograma en
    // esta sede" son problemas muy distintos, y el segundo se arregla
    // configurando la agenda, no buscando otra hora.
    let ultimoMotivo: string | undefined;

    for (const fecha of fechas) {
      const resultado = await this.delDia({
        sedeId: opciones.sedeId,
        barberoId: opciones.barberoId,
        fecha,
        servicioIds: opciones.servicioIds,
      });

      const barbero = resultado.barberos.find((b) => b.barberoId === opciones.barberoId);

      if (!barbero) {
        ultimoMotivo =
          resultado.motivo ?? 'Este barbero no tiene cronograma configurado en esta sede.';
      } else if (!barbero.trabaja) {
        ultimoMotivo = barbero.motivoNoTrabaja ?? 'El barbero no atiende ese día.';
      } else {
        const libre = barbero.huecos.find(
          (h) => h.disponible && new Date(h.inicioEn).getTime() >= desde.getTime(),
        );
        if (libre) return { inicioEn: new Date(libre.inicioEn), hora: libre.hora };
        ultimoMotivo = 'Su agenda está completa.';
      }
    }

    return {
      motivo: ultimoMotivo ?? 'No hay ningún hueco libre en los próximos dos días.',
    };
  }

  /**
   * Resumen de ocupación por día para pintar el calendario con colores.
   *
   * Es la vista que pidió el cliente para diciembre: de un vistazo, qué días
   * están libres, apretados o llenos. Se calcula sobre el agregado de todos
   * los barberos de la sede, o de uno solo si se filtra.
   */
  async calendario(opciones: {
    sedeId?: string;
    barberoId?: string;
    desde: string;
    hasta: string;
    /**
     * Opcionales y aditivos: sin ellos el calendario es el del panel (todos
     * los barberos, capacidad de un slot, sin reglas del cliente). Con
     * `servicioIds` cuenta solo los inicios en que cabe esa duración.
     */
    servicioIds?: string[];
    /** Aplica la antelación mínima de hoy, como el detalle del día. */
    aplicarReglasCliente?: boolean;
    /** Solo barberos visibles en la web (el canal público). */
    soloVisiblesWeb?: boolean;
  }): Promise<DiaCalendario[]> {
    const config = await this.configuracion.obtener();
    const zona = config.zonaHoraria;
    const fechas = rangoDeFechas(opciones.desde, opciones.hasta, 92);
    if (fechas.length === 0) return [];

    // Una sede concreta, o la principal si no se indica ninguna.
    const sedeId =
      opciones.sedeId ??
      (
        await this.prisma.sede.findFirst({
          where: { activa: true, eliminadoEn: null },
          orderBy: { orden: 'asc' },
          select: { id: true },
        })
      )?.id;

    if (!sedeId) return [];

    // Se traen de golpe los datos de todo el rango: una consulta por día
    // convertiría un mes en 30 viajes a la base de datos.
    const { inicio, fin } = limitesDelRango(opciones.desde, opciones.hasta, zona);

    const [diasEspeciales, horariosSede, agendas, excepciones, reservas] = await Promise.all([
      this.prisma.diaEspecial.findMany({
        where: { fecha: { gte: aFechaPura(opciones.desde), lte: aFechaPura(opciones.hasta) }, OR: [{ sedeId: null }, { sedeId }] },
      }),
      this.prisma.sedeHorario.findMany({ where: { sedeId } }),
      this.prisma.agendaDia.findMany({
        where: {
          sedeId,
          ...(opciones.barberoId ? { usuarioId: opciones.barberoId } : {}),
          usuario: {
            activo: true,
            eliminadoEn: null,
            rol: 'BARBERO',
            ...(opciones.soloVisiblesWeb ? { visibleWeb: true } : {}),
          },
        },
        include: { bloques: true, usuario: { select: { slotMinutos: true } } },
      }),
      this.prisma.agendaExcepcion.findMany({
        where: {
          fecha: { gte: aFechaPura(opciones.desde), lte: aFechaPura(opciones.hasta) },
          ...(opciones.barberoId ? { usuarioId: opciones.barberoId } : {}),
        },
      }),
      this.prisma.reserva.findMany({
        where: {
          sedeId,
          ...(opciones.barberoId ? { barberoId: opciones.barberoId } : {}),
          estado: { in: ['PENDIENTE', 'CONFIRMADA', 'EN_CURSO', 'COMPLETADA'] },
          inicioEn: { gte: inicio, lt: fin },
        },
        select: { barberoId: true, inicioEn: true, finConBufferEn: true },
      }),
    ]);

    // Modo exacto: se evalúa cada inicio con la misma regla que el detalle del
    // día. Es cómputo sobre los datos ya traídos, no una consulta por día.
    const exacto = opciones.servicioIds !== undefined || opciones.aplicarReglasCliente === true;
    let duracionNecesaria = 0;
    if (exacto) {
      const { duracionServicio, buffer } = await this.duracionDe(opciones.servicioIds ?? []);
      duracionNecesaria = duracionServicio + buffer;
    }
    const antelacion = opciones.aplicarReglasCliente ? config.minAntelacionMinutos : 0;
    const hoy = hoyLocal(zona);
    const minutosAhora = aMinutosDelDia(new Date(), zona);

    const resultado: DiaCalendario[] = [];

    for (const fecha of fechas) {
      const diaSemana = diaSemanaLocal(fecha, zona);
      const especial = diasEspeciales.find(
        (d) => d.fecha.toISOString().slice(0, 10) === fecha,
      );
      const horario = horariosSede.find((h) => h.diaSemana === diaSemana);

      if (especial?.tipo === 'FESTIVO_CERRADO' || !horario || horario.cerrado) {
        resultado.push({
          fecha,
          laborable: false,
          estado: 'cerrado',
          totalHuecos: 0,
          huecosLibres: 0,
          reservas: 0,
          ...(especial ? { etiqueta: especial.nombre } : {}),
        });
        continue;
      }

      const ventanaSede: RangoMinutos =
        especial && especial.horaInicio !== null && especial.horaFin !== null
          ? { horaInicio: especial.horaInicio, horaFin: especial.horaFin }
          : { horaInicio: horario.horaInicio, horaFin: horario.horaFin };

      let totalHuecos = 0;
      let huecosOcupados = 0;

      for (const agenda of agendas.filter((a) => a.diaSemana === diaSemana)) {
        const excepcion = excepciones.find(
          (e) =>
            e.usuarioId === agenda.usuarioId &&
            e.fecha.toISOString().slice(0, 10) === fecha &&
            (e.sedeId === null || e.sedeId === sedeId),
        );

        if (excepcion?.tipo === 'CERRADO') continue;
        if (!agenda.trabaja && excepcion?.tipo !== 'HORARIO_ESPECIAL') continue;

        const jornadaBarbero =
          excepcion?.tipo === 'HORARIO_ESPECIAL' &&
          excepcion.horaInicio !== null &&
          excepcion.horaFin !== null
            ? { horaInicio: excepcion.horaInicio, horaFin: excepcion.horaFin }
            : { horaInicio: agenda.horaInicio, horaFin: agenda.horaFin };

        const jornada: RangoMinutos = {
          horaInicio: Math.max(jornadaBarbero.horaInicio, ventanaSede.horaInicio),
          horaFin: Math.min(jornadaBarbero.horaFin, ventanaSede.horaFin),
        };
        if (jornada.horaFin <= jornada.horaInicio) continue;

        const paso =
          agenda.slotMinutos ?? agenda.usuario.slotMinutos ?? config.slotMinutosDefault;

        if (exacto) {
          const ocupaciones: Ocupacion[] = [
            ...agenda.bloques.map((b) => ({
              horaInicio: b.horaInicio,
              horaFin: b.horaFin,
              motivo: (b.tipo === 'ALMUERZO' ? 'ALMUERZO' : 'DESCANSO') as Ocupacion['motivo'],
            })),
            ...reservas
              .filter(
                (r) =>
                  r.barberoId === agenda.usuarioId && aFechaLocal(r.inicioEn, zona) === fecha,
              )
              .map((r) => ({
                horaInicio: aMinutosDelDia(r.inicioEn, zona),
                horaFin: aMinutosDelDia(r.finConBufferEn, zona),
                motivo: 'OCUPADO' as const,
              })),
          ];
          const tramosLibres = restarBloques(
            jornada,
            ocupaciones.map((o) => ({ horaInicio: o.horaInicio, horaFin: o.horaFin })),
          );
          for (const inicio of generarInicios(jornada, paso, paso)) {
            totalHuecos += 1;
            const motivo = this.motivoDelInicio({
              inicio,
              jornada,
              ocupaciones,
              tramosLibres,
              duracionNecesaria,
              esHoy: fecha === hoy,
              minutosAhora,
              antelacion,
            });
            if (motivo !== undefined) huecosOcupados += 1;
          }
          continue;
        }

        const tramos = restarBloques(jornada, agenda.bloques);
        const capacidad = tramos.reduce(
          (suma, tramo) => suma + generarInicios(tramo, paso, paso).length,
          0,
        );

        const citasDelDia = reservas.filter(
          (r) =>
            r.barberoId === agenda.usuarioId &&
            aFechaLocal(r.inicioEn, zona) === fecha,
        );

        const ocupados = citasDelDia.reduce((suma, cita) => {
          const minutos =
            aMinutosDelDia(cita.finConBufferEn, zona) - aMinutosDelDia(cita.inicioEn, zona);
          return suma + Math.max(1, Math.ceil(minutos / paso));
        }, 0);

        totalHuecos += capacidad;
        huecosOcupados += Math.min(ocupados, capacidad);
      }

      const huecosLibres = Math.max(0, totalHuecos - huecosOcupados);
      const proporcion = totalHuecos > 0 ? huecosLibres / totalHuecos : 0;

      resultado.push({
        fecha,
        laborable: totalHuecos > 0,
        estado:
          totalHuecos === 0
            ? 'cerrado'
            : proporcion === 0
              ? 'lleno'
              : proporcion < 0.35
                ? 'parcial'
                : 'libre',
        totalHuecos,
        huecosLibres,
        reservas: huecosOcupados,
        ...(especial ? { etiqueta: especial.nombre } : {}),
      });
    }

    return resultado;
  }

  // ---------------------------------------------------------- auxiliares

  /**
   * Por qué un inicio no se puede ofrecer (`undefined` si está libre). Es la
   * única definición de «hueco libre»: la usan el detalle del día y el
   * calendario, para que nunca discrepen.
   */
  private motivoDelInicio(datos: {
    inicio: number;
    jornada: RangoMinutos;
    ocupaciones: Ocupacion[];
    tramosLibres: RangoMinutos[];
    duracionNecesaria: number;
    esHoy: boolean;
    minutosAhora: number;
    antelacion: number;
  }): HuecoDisponible['motivo'] | undefined {
    const { inicio, jornada, ocupaciones, tramosLibres, duracionNecesaria } = datos;
    const cabe = inicio + duracionNecesaria <= jornada.horaFin;
    const tramo = tramosLibres.find(
      (t) => inicio >= t.horaInicio && inicio + duracionNecesaria <= t.horaFin,
    );
    const choque = ocupaciones.find((o) =>
      seSolapan(o, { horaInicio: inicio, horaFin: inicio + duracionNecesaria }),
    );

    if (datos.esHoy && inicio < datos.minutosAhora) return 'PASADO';
    if (datos.esHoy && inicio < datos.minutosAhora + datos.antelacion) return 'ANTELACION';
    if (choque) return choque.motivo;
    if (!cabe || !tramo) return 'NO_CABE';
    return undefined;
  }

  /** Suma de duraciones y buffer de los servicios elegidos. */
  private async duracionDe(
    servicioIds: string[],
  ): Promise<{ duracionServicio: number; buffer: number }> {
    const config = await this.configuracion.obtener();

    if (servicioIds.length === 0) {
      // Sin servicios elegidos todavía se muestra la rejilla con la duración
      // de un slot: así el calendario del panel se puede pintar antes de que
      // la recepción elija qué le van a hacer al cliente.
      return { duracionServicio: config.slotMinutosDefault, buffer: 0 };
    }

    const servicios = await this.prisma.servicio.findMany({
      where: { id: { in: servicioIds }, eliminadoEn: null },
      select: { id: true, duracionMinutos: true, bufferMinutos: true },
    });

    if (servicios.length !== servicioIds.length) {
      throw ErrorNegocio.noEncontrado('alguno de los servicios seleccionados');
    }

    const duracionServicio = servicios.reduce((s, x) => s + x.duracionMinutos, 0);
    // Con varios servicios en la misma cita, el tiempo de limpieza se aplica
    // una sola vez al final: la silla se limpia cuando el cliente se levanta.
    const buffer = Math.max(
      ...servicios.map((s) => s.bufferMinutos ?? config.bufferMinutosDefault),
    );

    return { duracionServicio, buffer };
  }

  private async reservasDelDia(
    barberoIds: string[],
    fecha: string,
    zona: string,
    excluirReservaId?: string,
  ): Promise<{ barberoId: string; inicioEn: Date; finConBufferEn: Date }[]> {
    const { inicio, fin } = limitesDelRango(fecha, fecha, zona);

    const where: Prisma.ReservaWhereInput = {
      barberoId: { in: barberoIds },
      // COMPLETADA también ocupa: esa silla estuvo usada a esa hora y el
      // calendario del mes lo cuenta igual. Si aquí no se incluyera, el
      // resumen del mes y el detalle del día dirían cosas distintas sobre el
      // mismo día, que es la forma más rápida de que nadie se fíe de ninguno.
      // CANCELADA y NO_ASISTIO sí liberan el hueco al instante.
      estado: { in: ['PENDIENTE', 'CONFIRMADA', 'EN_CURSO', 'COMPLETADA'] },
      inicioEn: { gte: inicio, lt: fin },
      ...(excluirReservaId ? { id: { not: excluirReservaId } } : {}),
    };

    return this.prisma.reserva.findMany({
      where,
      select: { barberoId: true, inicioEn: true, finConBufferEn: true },
      orderBy: { inicioEn: 'asc' },
    });
  }

  /** Los tres huecos libres más cercanos a la hora que se pidió. */
  private alternativas(barbero: DisponibilidadBarbero, deseado: Date): HuecoDisponible[] {
    return barbero.huecos
      .filter((h) => h.disponible)
      .map((h) => ({ hueco: h, distancia: Math.abs(new Date(h.inicioEn).getTime() - deseado.getTime()) }))
      .sort((a, b) => a.distancia - b.distancia)
      .slice(0, 3)
      .map((x) => x.hueco);
  }
}
