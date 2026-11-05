import { Injectable } from '@nestjs/common';
import { CODIGOS_ERROR, ESTADOS_QUE_OCUPAN } from '@cds/shared';
import type {
  BarberoPublico,
  ConfigPublica,
  CrearReservaPublicaDto,
  ConsultarCalendarioPublicoDto,
  ConsultarDisponibilidadPublicaDto,
  DiaCalendarioPublico,
  HuecoDisponible,
  HuecoPublico,
  OpcionesPublicas,
  ReservaPublica,
} from '@cds/shared';
import { PrismaService } from '../../comun/prisma/prisma.service.js';
import { ConfiguracionNegocioService } from '../../comun/configuracion/configuracion-negocio.service.js';
import { ErrorNegocio } from '../../comun/excepciones/error-negocio.js';
import { aFechaLocal, hoyLocal, limitesDelRango } from '../../comun/tiempo/tiempo.js';
import { DisponibilidadService } from '../disponibilidad/disponibilidad.service.js';
import { ReservasService } from '../reservas/reservas.service.js';
import {
  aBarberoPublico,
  aHuecoPublico,
  aReservaPublica,
  aSedePublica,
  aServicioPublico,
} from './dto-publico.js';

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
 * Lo que la respuesta de crear necesita, y nada más. El `include` de
 * `ReservasService.crear` es el del panel: trae la sede sin `ciudad`,
 * `telefono` ni `mapsUrl` y el barbero sin `bio`, así que se relee con el
 * `select` público. `tokenGestion` sale una sola vez, en esta respuesta.
 */
const SELECT_RESERVA_PUBLICA = {
  codigo: true,
  estado: true,
  inicioEn: true,
  finEn: true,
  total: true,
  tokenGestion: true,
  sede: { select: SELECT_SEDE },
  barbero: { select: { id: true, nombre: true, alias: true, bio: true, fotoUrl: true } },
  servicios: {
    select: { nombreSnapshot: true, precioSnapshot: true, duracionSnapshot: true },
    orderBy: { orden: 'asc' },
  },
} as const;

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
 * Fachada del canal público: valida (en el controlador), llama a la
 * persistencia y traduce con los mapeadores. No contiene lógica de negocio.
 */
@Injectable()
export class PublicoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configuracion: ConfiguracionNegocioService,
    private readonly motorDisponibilidad: DisponibilidadService,
    private readonly reservas: ReservasService,
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

  // ------------------------------------------------------ Asignación de barbero

  /**
   * Quién atiende una cita cuando el cliente no eligió barbero. Devuelve su id.
   *
   * La decisión se toma aquí, al crear, y no en el navegador: un barbero que
   * estaba libre cuando se pintó la rejilla puede estar ocupado tres minutos
   * después. Entre los barberos visibles en la web que tienen el hueco libre
   * AHORA, gana el menos cargado ese día (minutos de reservas que ocupan silla,
   * en el día local de la cita). A igualdad de carga, el de `id` menor: es
   * inmutable, así que editar un perfil no cambia la elección.
   *
   * Reduce las colisiones, no las elimina: si dos clientes confirman el mismo
   * hueco a la vez, la restricción de exclusión de PostgreSQL rechaza a uno.
   * No acota la fecha a la ventana de reserva (`maxDiasAnticipacion`): asume
   * que quien llama ya la validó, como hace `validarHueco` al crear la cita.
   * Cuesta tres consultas por llamada, con independencia de cuántos barberos hay.
   */
  async elegirBarbero(datos: {
    sedeId: string;
    inicioEn: Date;
    servicioIds: string[];
  }): Promise<string> {
    const { zonaHoraria } = await this.configuracion.obtener();
    const fecha = aFechaLocal(datos.inicioEn, zonaHoraria);
    const instante = datos.inicioEn.toISOString();

    // Disponibilidad con las mismas reglas que vio el cliente al elegir la hora.
    // `delDia` devuelve a todos los barberos de la sede: se filtra por
    // visibilidad en la web y se hace en paralelo, no uno a uno.
    const [visibles, dia] = await Promise.all([
      this.idsBarberosVisibles(datos.sedeId),
      this.motorDisponibilidad.delDia({
        sedeId: datos.sedeId,
        fecha,
        servicioIds: datos.servicioIds,
        aplicarReglasCliente: true,
      }),
    ]);

    const idsVisibles = new Set(visibles);
    const candidatos = dia.barberos
      .filter(
        (b) =>
          idsVisibles.has(b.barberoId) &&
          b.trabaja &&
          b.huecos.some((h) => h.inicioEn === instante && h.disponible),
      )
      .map((b) => b.barberoId);

    if (!dia.laborable || candidatos.length === 0) {
      throw new ErrorNegocio(CODIGOS_ERROR.RESERVA_SOLAPADA, 409);
    }
    if (candidatos.length === 1) return candidatos[0]!;

    // Carga del día local de cada candidato (en todas las sedes), en una sola consulta.
    const { inicio, fin } = limitesDelRango(fecha, fecha, zonaHoraria);
    const reservas = await this.prisma.reserva.findMany({
      where: {
        // Sin filtrar por sede: los barberos cubren turnos entre sedes y su
        // tiempo se consume esté donde esté.
        barberoId: { in: candidatos },
        estado: { in: [...ESTADOS_QUE_OCUPAN] },
        inicioEn: { gte: inicio, lt: fin },
      },
      select: { barberoId: true, duracionMinutos: true },
    });

    const carga = new Map<string, number>(candidatos.map((id) => [id, 0]));
    for (const r of reservas as { barberoId: string; duracionMinutos: number }[]) {
      carga.set(r.barberoId, (carga.get(r.barberoId) ?? 0) + r.duracionMinutos);
    }

    // El desempate por `id` vive aquí, no en el orden en que la base devuelva
    // las filas: así la elección es la misma con el mismo estado.
    return [...candidatos].sort((a, b) => carga.get(a)! - carga.get(b)! || (a < b ? -1 : 1))[0]!;
  }

  // -------------------------------------------------------------- Crear reserva

  /**
   * Crea una reserva desde la web y devuelve su vista pública con el token de
   * gestión, que sale aquí y en ningún otro sitio.
   *
   * Las reglas de la cita (antelación, tope de citas activas, estado inicial,
   * canal) son del dominio: aquí solo se aplica lo que es del canal, que la web
   * solo reserva lo que muestra (sede activa, servicios y barbero visibles), y
   * se traduce el cuerpo. El DTO del dominio se construye campo a campo: lo que
   * no se nombra aquí no llega a la base de datos, por mucho que el cuerpo lo
   * traiga. El esquema público llama `cliente` a lo que el dominio llama
   * `clienteNuevo`; con la clave equivocada no habría error, pero la cita
   * quedaría sin ficha, sin teléfono y sin sellos de fidelidad.
   *
   * Si el horario se ocupa mientras el cliente confirmaba, el error lleva en
   * `detalle.huecos` los huecos recalculados de ese día para repintar la rejilla.
   */
  async crearReserva(datos: CrearReservaPublicaDto): Promise<ReservaPublica & { tokenGestion: string }> {
    await this.verificarVisibleEnWeb(datos);
    const inicioEn = new Date(datos.inicioEn);

    let creada: { id: string };
    try {
      const barberoId =
        datos.barberoId ??
        (await this.elegirBarbero({
          sedeId: datos.sedeId,
          inicioEn,
          servicioIds: datos.servicioIds,
        }));

      creada = await this.reservas.crear(
        {
          sedeId: datos.sedeId,
          barberoId,
          servicioIds: datos.servicioIds,
          inicioEn: datos.inicioEn,
          clienteNuevo: {
            nombreCompleto: datos.cliente.nombreCompleto,
            telefono: datos.cliente.telefono,
            email: datos.cliente.email,
          },
          notaCliente: datos.notaCliente,
          // El canal público no negocia precio ni premios; `confirmar` lo ignora
          // el dominio cuando viene de la web (decide `requiereConfirmacion`).
          descuento: 0,
          aplicarPremioFidelidad: false,
          confirmar: true,
        },
        null,
        true,
      );
    } catch (error) {
      throw await this.conHuecosSiSeOcupo(error, datos, inicioEn);
    }

    const fila = await this.prisma.reserva.findUnique({
      where: { id: creada.id },
      select: SELECT_RESERVA_PUBLICA,
    });
    if (!fila?.tokenGestion) {
      // La cita ya está guardada: que falte su lectura es un fallo del servidor.
      throw new Error(`La reserva ${creada.id} no se pudo releer tras crearla`);
    }
    return { ...aReservaPublica(fila), tokenGestion: fila.tokenGestion };
  }

  /**
   * Regla del canal, no del dominio: recepción sí puede reservar desde el panel
   * un servicio oculto en web, y `resolverServicios` solo filtra por `activo`.
   * Todo lo que falla es «no encontrado»: el cliente no distingue entre un
   * recurso oculto y uno que no existe.
   */
  private async verificarVisibleEnWeb(datos: CrearReservaPublicaDto): Promise<void> {
    const idsServicios = [...new Set(datos.servicioIds)];
    const [sede, servicios, barberosVisibles] = await Promise.all([
      this.prisma.sede.findFirst({
        where: { id: datos.sedeId, activa: true, eliminadoEn: null },
        select: { id: true },
      }),
      this.prisma.servicio.findMany({
        where: { id: { in: datos.servicioIds }, activo: true, visibleWeb: true, eliminadoEn: null },
        select: { id: true },
      }),
      datos.barberoId ? this.idsBarberosVisibles(datos.sedeId) : Promise.resolve(null),
    ]);

    const barberoOculto = barberosVisibles !== null && !barberosVisibles.includes(datos.barberoId!);
    if (!sede || servicios.length !== idsServicios.length || barberoOculto) {
      throw new ErrorNegocio(CODIGOS_ERROR.RECURSO_NO_ENCONTRADO, 404);
    }
  }

  /**
   * Dos clientes pueden pulsar el mismo hueco a la vez: el segundo recibe el
   * error con los huecos recalculados de ese día, no un formulario vacío. El
   * solape llega por tres caminos (validación del dominio, `elegirBarbero` sin
   * candidatos y la restricción de exclusión de PostgreSQL); cualquier otro
   * error se devuelve tal cual. Si no se pueden recalcular los huecos, se
   * devuelve el error original: no se tapa un 409 con un 500.
   */
  private async conHuecosSiSeOcupo(error: unknown, datos: CrearReservaPublicaDto, inicioEn: Date): Promise<unknown> {
    const esSolape =
      (error instanceof ErrorNegocio && error.codigo === CODIGOS_ERROR.RESERVA_SOLAPADA) ||
      PrismaService.esViolacionDe(error, 'reservas_sin_solape_barbero');
    if (!esSolape) return error;

    try {
      const { zonaHoraria } = await this.configuracion.obtener();
      const { huecos } = await this.disponibilidad({
        sedeId: datos.sedeId,
        barberoId: datos.barberoId,
        fecha: aFechaLocal(inicioEn, zonaHoraria),
        servicioIds: datos.servicioIds,
      });
      return new ErrorNegocio(CODIGOS_ERROR.RESERVA_SOLAPADA, 409, { huecos });
    } catch {
      return error;
    }
  }

  /** Ids de los barberos que la web muestra en una sede (principal o permitida). */
  private async idsBarberosVisibles(sedeId: string): Promise<string[]> {
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
