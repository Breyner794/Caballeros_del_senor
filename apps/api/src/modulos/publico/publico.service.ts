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

/**
 * Los `select` piden solo las columnas que emite el mapeador correspondiente:
 * una fuga tendría que atravesar dos barreras (el `select` y el mapeador).
 * Si el mapeador gana un campo, hay que añadirlo aquí o saldrá `undefined`.
 */
const SELECT_SEDE = {
  id: true,
  nombre: true,
  direccion: true,
  ciudad: true,
  telefono: true,
  mapsUrl: true,
} as const;

const SELECT_SERVICIO = {
  id: true,
  nombre: true,
  descripcion: true,
  incluye: true,
  precio: true,
  duracionMinutos: true,
} as const;

/** `sedeId` y `sedesPermitidas` solo sirven para agrupar: no salen en la respuesta. */
const SELECT_BARBERO = {
  id: true,
  nombre: true,
  alias: true,
  bio: true,
  fotoUrl: true,
  sedeId: true,
  sedesPermitidas: { select: { sedeId: true } },
} as const;

/**
 * Fachada del canal público: valida (en el controlador), llama a la
 * persistencia y traduce con los mapeadores. No contiene lógica de negocio.
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
        where: { rol: 'BARBERO', activo: true, visibleWeb: true, eliminadoEn: null },
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
  ): Promise<{ fecha: string; laborable: boolean; huecos: HuecoPublico[] }> {
    const [visibles, dia] = await Promise.all([
      this.prisma.usuario.findMany({
        where: {
          rol: 'BARBERO',
          activo: true,
          visibleWeb: true,
          eliminadoEn: null,
          OR: [{ sedeId: filtros.sedeId }, { sedesPermitidas: { some: { sedeId: filtros.sedeId } } }],
        },
        select: { id: true },
      }),
      this.motorDisponibilidad.delDia({
        sedeId: filtros.sedeId,
        barberoId: filtros.barberoId,
        fecha: filtros.fecha,
        servicioIds: filtros.servicioIds,
        aplicarReglasCliente: true,
      }),
    ]);

    // `delDia` devuelve a todos los barberos de la sede: aquí se descartan los
    // que la web no debe mostrar, antes de que entren en la unión.
    const idsVisibles = new Set(visibles.map((b: { id: string }) => b.id));
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
    const config = await this.configuracion.obtener();
    const tope = sumarDias(hoyLocal(config.zonaHoraria), config.maxDiasAnticipacion);
    const hasta = filtros.hasta < tope ? filtros.hasta : tope;
    // Un selector de fechas no ofrece días pasados.
    const hoy = hoyLocal(config.zonaHoraria);
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
