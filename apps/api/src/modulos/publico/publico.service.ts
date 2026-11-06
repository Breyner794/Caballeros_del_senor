import { Injectable } from '@nestjs/common';
import type {
  BarberoPublico,
  ConfigPublica,
  ConsultarCalendarioPublicoDto,
  ConsultarDisponibilidadPublicaDto,
  DiaCalendarioPublico,
  HuecoDisponible,
  HuecoPublico,
  OpcionesPublicas,
} from '@cds/shared';
import { PrismaService } from '../../comun/prisma/prisma.service.js';
import { ConfiguracionNegocioService } from '../../comun/configuracion/configuracion-negocio.service.js';
import { hoyLocal } from '../../comun/tiempo/tiempo.js';
import { DisponibilidadService } from '../disponibilidad/disponibilidad.service.js';
import { aBarberoPublico, aHuecoPublico, aSedePublica, aServicioPublico } from './dto-publico.js';
import { SELECT_BARBERO, SELECT_SEDE, SELECT_SERVICIO } from './selects-publico.js';

/**
 * Quién puede mostrar la web como barbero. Un único criterio para `opciones`,
 * `disponibilidad` y `elegirBarbero`: si hubiera copias, la que se olvidara
 * dejaría salir a un barbero que la web no muestra.
 */
const BARBERO_VISIBLE_EN_WEB = {
  rol: 'BARBERO',
  activo: true,
  visibleWeb: true,
  eliminadoEn: null,
} as const;

/**
 * Fachada de lectura del canal público: llama a la persistencia y traduce con
 * los mapeadores. No contiene lógica de negocio. El camino de escritura (crear
 * la cita) vive en `PublicoReservasService`, que se apoya en este servicio para
 * lo que ambos comparten.
 */
@Injectable()
export class PublicoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configuracion: ConfiguracionNegocioService,
    private readonly motorDisponibilidad: DisponibilidadService,
  ) {}

  // ---------------------------------------------------------------- Opciones

  /** Todo lo que el asistente de reserva necesita para que el cliente elija. */
  async opciones(): Promise<OpcionesPublicas> {
    const [sedes, servicios, barberos, config] = await Promise.all([
      this.prisma.sede.findMany({
        where: { activa: true, eliminadoEn: null },
        select: SELECT_SEDE,
        orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
      }),
      this.prisma.servicio.findMany({
        where: { activo: true, visibleWeb: true, eliminadoEn: null },
        select: SELECT_SERVICIO,
        orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
      }),
      this.prisma.usuario.findMany({
        where: BARBERO_VISIBLE_EN_WEB,
        select: SELECT_BARBERO,
        orderBy: { nombre: 'asc' },
      }),
      this.configuracion.obtener(),
    ]);

    // Un barbero atiende en su sede principal y en todas las `sedesPermitidas`
    // (cubre turnos): aparece en cada una de ellas, una sola vez por sede.
    const barberosPorSede = new Map<string, BarberoPublico[]>();
    for (const barbero of barberos) {
      const sedesHabilitadas = new Set<string>(barbero.sedesPermitidas.map((s) => s.sedeId));
      if (barbero.sedeId) sedesHabilitadas.add(barbero.sedeId);
      const publico = aBarberoPublico(barbero);
      for (const sedeId of sedesHabilitadas) {
        const lista = barberosPorSede.get(sedeId) ?? [];
        lista.push(publico);
        barberosPorSede.set(sedeId, lista);
      }
    }

    return {
      sedes: sedes.map((sede) => ({
        ...aSedePublica(sede),
        barberos: barberosPorSede.get(sede.id) ?? [],
      })),
      servicios: servicios.map(aServicioPublico),
      config: aConfigPublica(config),
    };
  }

  // ----------------------------------------------------------- Disponibilidad

  /**
   * Huecos de un día. Sin barbero elegido devuelve la UNIÓN de los huecos de la
   * sede: «hay sitio a las 10:00», sin decir de quién. La lista de qué barbero
   * está libre a cada hora es su agenda personal y se reconstruye hueco por
   * hueco si se publica; el barbero lo decide el servidor al crear la cita.
   * Las reglas de antelación y anticipación las aplica `DisponibilidadService`.
   */
  async disponibilidad(
    filtros: ConsultarDisponibilidadPublicaDto,
    /** Solo al reprogramar: la cita del cliente no cuenta como ocupada. Lo pone el servidor, nunca el cliente. */
    excluirReservaId?: string,
  ): Promise<{ fecha: string; laborable: boolean; huecos: HuecoPublico[] }> {
    // `delDia` no acota la fecha (eso lo hace `validarHueco` al crear): se
    // recorta aquí el rango de consulta, igual que en el calendario.
    const { hoy, tope } = await this.ventanaDeReserva();
    if (filtros.fecha < hoy || filtros.fecha > tope) {
      return { fecha: filtros.fecha, laborable: false, huecos: [] };
    }

    const [visibles, dia] = await Promise.all([
      this.idsBarberosVisibles(filtros.sedeId),
      this.motorDisponibilidad.delDia({
        sedeId: filtros.sedeId,
        barberoId: filtros.barberoId,
        fecha: filtros.fecha,
        servicioIds: filtros.servicioIds,
        aplicarReglasCliente: true,
        ...(excluirReservaId ? { excluirReservaId } : {}),
      }),
    ]);

    // `delDia` devuelve a todos los barberos de la sede: aquí se descartan los
    // que la web no debe mostrar, antes de que entren en la unión.
    const idsVisibles = new Set(visibles);
    // Si el cliente eligió barbero, solo cuenta ese: se comprueba aquí también
    // para no depender de que el motor filtre.
    const barberos = dia.barberos.filter(
      (b) => idsVisibles.has(b.barberoId) && (!filtros.barberoId || b.barberoId === filtros.barberoId),
    );

    // Una sede sin barberos visibles es un conjunto vacío, no un error.
    const laborable = dia.laborable && barberos.some((b) => b.trabaja);
    if (!laborable) return { fecha: filtros.fecha, laborable: false, huecos: [] };

    return {
      fecha: filtros.fecha,
      laborable: true,
      huecos: unirHuecos(barberos.map((b) => b.huecos)),
    };
  }

  /**
   * Qué días del rango tienen algún hueco. El rango se recorta a
   * `maxDiasAnticipacion`: más allá de ese tope el cliente no puede reservar.
   */
  async calendario(filtros: ConsultarCalendarioPublicoDto): Promise<DiaCalendarioPublico[]> {
    const { hoy, tope } = await this.ventanaDeReserva();
    const hasta = filtros.hasta < tope ? filtros.hasta : tope;
    // Un selector de fechas no ofrece días pasados.
    const desde = filtros.desde > hoy ? filtros.desde : hoy;
    if (desde > hasta) return [];

    // Mismas reglas que el detalle del día: duración elegida, antelación
    // mínima y solo barberos visibles, para que un día encendido tenga horas.
    const dias = await this.motorDisponibilidad.calendario({
      sedeId: filtros.sedeId,
      desde,
      hasta,
      servicioIds: filtros.servicioIds,
      aplicarReglasCliente: true,
      soloVisiblesWeb: true,
    });
    return dias.map((dia) => ({ fecha: dia.fecha, hayHueco: dia.huecosLibres > 0 }));
  }

  /**
   * Ids de los barberos que la web muestra en una sede (principal o permitida).
   * Es el único sitio donde se define «barbero visible en web»: el servicio de
   * escritura lo usa a través de aquí, no con un `where` propio. Es público solo
   * para eso; no es una operación del canal.
   */
  async idsBarberosVisibles(sedeId: string): Promise<string[]> {
    const barberos = await this.prisma.usuario.findMany({
      where: {
        ...BARBERO_VISIBLE_EN_WEB,
        OR: [{ sedeId }, { sedesPermitidas: { some: { sedeId } } }],
      },
      select: { id: true },
    });
    return barberos.map((b: { id: string }) => b.id);
  }

  /**
   * Primer y último día en que el cliente puede reservar: hoy y hoy más
   * `maxDiasAnticipacion`. `hoy` se calcula una sola vez para que, en el cruce
   * de medianoche, ambos extremos salgan del mismo día.
   */
  private async ventanaDeReserva(): Promise<{ hoy: string; tope: string }> {
    const config = await this.configuracion.obtener();
    const hoy = hoyLocal(config.zonaHoraria);
    return { hoy, tope: sumarDias(hoy, config.maxDiasAnticipacion) };
  }
}

/** Suma días a una fecha local `YYYY-MM-DD` sin pasar por la zona horaria. */
function sumarDias(fecha: string, dias: number): string {
  const resultado = new Date(`${fecha}T00:00:00Z`);
  resultado.setUTCDate(resultado.getUTCDate() + dias);
  return resultado.toISOString().slice(0, 10);
}

/**
 * Unión de los huecos de varios barberos, un elemento por instante y en orden
 * cronológico (no en el de los barberos, que delataría la agenda de cada uno).
 *
 * Disponible si lo está alguno. Si no lo está nadie, el motivo solo sobrevive
 * cuando TODOS coinciden en `ANTELACION` o `NO_CABE`: mezclar motivos de varios
 * barberos es una pista sobre sus agendas. `aHuecoPublico` hace el resto.
 */
function unirHuecos(listas: HuecoDisponible[][]): HuecoPublico[] {
  // Un instante que solo existe en la jornada de un barbero (p. ej. el último
  // de la tarde) aparece en la unión, y es a propósito: ocultarlo escondería
  // huecos reservables de verdad. Lo que revela es el horario de apertura de la
  // barbería, no la agenda personal de nadie.
  const porInstante = new Map<string, HuecoDisponible[]>();
  for (const hueco of listas.flat()) {
    const grupo = porInstante.get(hueco.inicioEn) ?? [];
    grupo.push(hueco);
    porInstante.set(hueco.inicioEn, grupo);
  }

  return [...porInstante.values()]
    .map((grupo): HuecoPublico => {
      const primero = grupo[0]!;
      const disponible = grupo.some((h) => h.disponible);
      const motivosIguales = grupo.every((h) => h.motivo === primero.motivo);
      return aHuecoPublico({
        inicioEn: primero.inicioEn,
        hora: primero.hora,
        disponible,
        motivo: !disponible && motivosIguales ? primero.motivo : undefined,
      });
    })
    .sort((a, b) => new Date(a.inicioEn).getTime() - new Date(b.inicioEn).getTime());
}

/** Solo los seis campos que el frontend necesita para comportarse como la API. */
function aConfigPublica(config: {
  permiteElegirBarbero: boolean;
  maxDiasAnticipacion: number;
  minAntelacionMinutos: number;
  zonaHoraria: string;
  moneda: string;
  nombreNegocio: string;
}): ConfigPublica {
  return {
    permiteElegirBarbero: config.permiteElegirBarbero,
    maxDiasAnticipacion: config.maxDiasAnticipacion,
    minAntelacionMinutos: config.minAntelacionMinutos,
    zonaHoraria: config.zonaHoraria,
    moneda: config.moneda,
    nombreNegocio: config.nombreNegocio,
  };
}
