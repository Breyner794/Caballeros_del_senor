import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CODIGOS_ERROR, ESTADOS_QUE_OCUPAN, puedeTransicionar } from '@cds/shared';
import type {
  CancelarReservaPublicaDto,
  CrearReservaPublicaDto,
  EstadoReserva,
  MiReservaPublica,
  ReprogramarReservaPublicaDto,
  ReservaPublica,
} from '@cds/shared';
import { PrismaService } from '../../comun/prisma/prisma.service.js';
import { ConfiguracionNegocioService } from '../../comun/configuracion/configuracion-negocio.service.js';
import { ErrorNegocio } from '../../comun/excepciones/error-negocio.js';
import { aFechaLocal, fechaLegible, limitesDelRango } from '../../comun/tiempo/tiempo.js';
import { DisponibilidadService } from '../disponibilidad/disponibilidad.service.js';
import { NotificacionesService } from '../notificaciones/notificaciones.service.js';
import { ReservasService } from '../reservas/reservas.service.js';
import { aReservaPublica, type ReservaEntrada } from './dto-publico.js';
import type { ReservaResuelta } from './guard-token-gestion.js';
import { PublicoService } from './publico.service.js';
import { SELECT_RESERVA_PUBLICA } from './selects-publico.js';

/**
 * Camino de escritura del canal público: elegir barbero, crear la cita y
 * gestionarla después con el token (ver, cancelar, reprogramar).
 *
 * Aparte de `PublicoService` porque es otra responsabilidad: lo que la web
 * puede hacer con la agenda (reservar, y después gestionar por token) frente a
 * lo que puede ver. `ReservasService` se inyecta solo aquí. La visibilidad en
 * web (`idsBarberosVisibles`) y los huecos del día se piden al servicio de
 * lecturas: una sola definición de cada cosa.
 */
@Injectable()
export class PublicoReservasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configuracion: ConfiguracionNegocioService,
    private readonly motorDisponibilidad: DisponibilidadService,
    private readonly reservas: ReservasService,
    private readonly lecturas: PublicoService,
    private readonly notificaciones: NotificacionesService,
    private readonly entorno: ConfigService,
  ) {}

  private readonly logger = new Logger(PublicoReservasService.name);

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
      this.lecturas.idsBarberosVisibles(datos.sedeId),
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
      // Sin candidatos no siempre es «ocupado»: si ese instante existe en la
      // rejilla de algún barbero visible pero cerrado por la antelación mínima,
      // el motivo que se le debe dar al cliente es ese, el mismo que daría
      // `validarHueco` con un barbero elegido. Con `RESERVA_SOLAPADA` le diríamos
      // que el hueco se ocupó, y la rejilla recalculada tampoco se lo explicaría.
      const cerradoPorAntelacion = dia.barberos.some(
        (b) =>
          idsVisibles.has(b.barberoId) &&
          b.huecos.some((h) => h.inicioEn === instante && !h.disponible && h.motivo === 'ANTELACION'),
      );
      if (cerradoPorAntelacion) {
        const { minAntelacionMinutos } = await this.configuracion.obtener();
        throw new ErrorNegocio(CODIGOS_ERROR.ANTELACION_INSUFICIENTE, 400, { minAntelacionMinutos });
      }
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
    // Un servicio repetido no tiene sentido y duplicaría la duración de la cita.
    const servicioIds = [...new Set(datos.servicioIds)];
    await this.verificarVisibleEnWeb(datos, servicioIds);
    const inicioEn = new Date(datos.inicioEn);

    let creada: { id: string; codigo: string; clienteId: string | null };
    try {
      const barberoId =
        datos.barberoId ??
        (await this.elegirBarbero({
          sedeId: datos.sedeId,
          inicioEn,
          servicioIds,
        }));

      creada = await this.reservas.crear(
        {
          sedeId: datos.sedeId,
          barberoId,
          servicioIds,
          inicioEn: datos.inicioEn,
          clienteNuevo: {
            nombreCompleto: datos.cliente.nombreCompleto,
            telefono: datos.cliente.telefono,
            email: datos.cliente.email,
          },
          notaCliente: datos.notaCliente,
          // El canal público no negocia precio ni premios. `confirmar` lo ignora el
          // dominio cuando viene de la web (decide `requiereConfirmacion`), pero el
          // tipo lo exige y el valor ignorado debe ser el inocuo: con `true`, el día
          // que alguien simplifique esa condición, toda cita web entraría como
          // CONFIRMADA sin que recepción la apruebe. La web nunca confirma por su cuenta.
          descuento: 0,
          aplicarPremioFidelidad: false,
          confirmar: false,
        },
        null,
        true,
      );
    } catch (error) {
      throw await this.conHuecosSiSeOcupo(error, datos, servicioIds, inicioEn);
    }

    const fila = await this.releerTrasEscribir(creada);
    const respuesta = { ...aReservaPublica(fila), tokenGestion: fila.tokenGestion };

    // Ya está confirmada la escritura. El correo va después y sin esperarlo: el
    // cliente ya tiene su código en pantalla, y un proveedor lento o caído no
    // debe retrasar ni deshacer la cita. `notificarCita` no lanza.
    void this.notificarCita('reserva.confirmada', creada, fila);

    return respuesta;
  }

  /**
   * Correo de la cita (`reserva.confirmada` o `reserva.reprogramada`). Solo sale si la ficha tiene correo Y `aceptaEmail`:
   * el consentimiento se marca solo cuando el cliente escribe su correo en la
   * web, y una ficha con correo viejo pero sin consentimiento no recibe nada.
   * El destino sale de la ficha, no del cuerpo de la petición.
   *
   * Al reprogramar el dominio rota el token: el correo de la creación queda con
   * un enlace muerto, así que se envía otro con el nuevo (`fecha` es la hora nueva).
   *
   * El enlace lleva el token en el fragmento (`#`): no viaja al servidor, así que
   * no queda en logs de acceso ni en el `Referer`. Nunca se escribe en un log
   * desde aquí.
   */
  private async notificarCita(
    clave: 'reserva.confirmada' | 'reserva.reprogramada',
    reserva: { id: string; clienteId: string | null },
    fila: ReservaEntrada & { tokenGestion: string },
  ): Promise<void> {
    const { id: reservaId, clienteId } = reserva;
    try {
      if (!clienteId) return;
      const ficha = await this.prisma.cliente.findUnique({
        where: { id: clienteId },
        select: { nombreCompleto: true, email: true, aceptaEmail: true },
      });
      if (!ficha?.email || !ficha.aceptaEmail) return;

      const { zonaHoraria } = await this.configuracion.obtener();
      const origen = this.entorno.get<string>('BOOKING_ORIGIN') ?? 'http://localhost:5174';
      await this.notificaciones.encolar({
        reservaId,
        clienteId,
        clave,
        canal: 'EMAIL',
        destino: ficha.email,
        variables: {
          cliente: ficha.nombreCompleto,
          fecha: fechaLegible(fila.inicioEn, zonaHoraria),
          barbero: fila.barbero.nombre,
          sede: fila.sede.nombre,
          codigo: fila.codigo,
          enlace: `${origen}/cita#${fila.tokenGestion}`,
        },
        // La fila de la notificación guarda qué se envió, menos la llave de la cita.
        omitirDelPayload: ['enlace'],
      });
    } catch (fallo) {
      this.logger.error(
        `No se pudo preparar «${clave}» de la reserva ${fila.codigo}: ${
          fallo instanceof Error ? fallo.message : String(fallo)
        }`,
      );
    }
  }

  // ------------------------------------------- Gestión con el token de la cita

  /**
   * La cita del cliente, con lo que el frontend necesita para decidir qué
   * botones ofrecer. La reserva que entrega el guard es la fila interna (con
   * token, nota interna y ficha del cliente): aquí solo se usa su `id`, y la
   * respuesta sale de una relectura con el `select` público y los mapeadores.
   */
  async miReserva(reserva: ReservaResuelta): Promise<MiReservaPublica> {
    const fila = await this.prisma.reserva.findUnique({
      where: { id: reserva.id },
      select: SELECT_RESERVA_PUBLICA,
    });
    if (!fila) throw new ErrorNegocio(CODIGOS_ERROR.RECURSO_NO_ENCONTRADO, 404);
    return this.conBanderas(fila);
  }

  /**
   * Cancela la cita del cliente. El origen `CLIENTE` es lo que activa el plazo
   * (`horasLimiteCancelacion`) en el dominio: con otro valor no habría error,
   * solo se saltaría la regla. Si dos peticiones cancelan a la vez con el mismo
   * token, la segunda recibe `ESTADO_RESERVA_INVALIDO` del dominio, que vuelve a
   * leer el estado antes de escribir; aquí ese error se deja pasar tal cual.
   * El dominio anula el token al cancelar: no se replica.
   */
  async cancelarPropia(
    reserva: ReservaResuelta,
    datos: CancelarReservaPublicaDto,
  ): Promise<MiReservaPublica> {
    // `tokenTurnstile` es del canal y no llega al dominio; `notificar` toma el
    // valor por defecto del esquema del panel.
    await this.reservas.cancelar(reserva.id, { motivo: datos.motivo, notificar: true }, null, 'CLIENTE');
    // La cita cancelada ya no tiene token (el dominio lo anuló): se relee sin exigirlo.
    const fila = await this.prisma.reserva.findUnique({
      where: { id: reserva.id },
      select: SELECT_RESERVA_PUBLICA,
    });
    if (!fila) {
      throw new Error(`La reserva ${reserva.codigo} (${reserva.id}) se canceló pero no se pudo releer`);
    }
    return this.conBanderas(fila);
  }

  /**
   * Mueve la cita del cliente a otra hora (y, si quiere, a otro barbero de la
   * misma sede: la sede no se puede cambiar desde la web). El dominio rota el
   * token cuando reprograma el cliente, y el valor nuevo se devuelve aquí porque
   * es la única forma de que lo reciba: el enlace viejo deja de servir.
   */
  async reprogramarPropia(
    reserva: ReservaResuelta,
    datos: ReprogramarReservaPublicaDto,
  ): Promise<MiReservaPublica & { tokenGestion: string }> {
    // Regla del canal, no del dominio: recepción sí puede mover una cita a un
    // barbero oculto en web. Mismo criterio que `verificarVisibleEnWeb` al crear.
    if (datos.barberoId) {
      const visibles = await this.lecturas.idsBarberosVisibles(reserva.sedeId);
      if (!visibles.includes(datos.barberoId)) {
        throw new ErrorNegocio(CODIGOS_ERROR.RECURSO_NO_ENCONTRADO, 404);
      }
    }
    await this.reservas.reprogramar(
      reserva.id,
      { inicioEn: datos.inicioEn, barberoId: datos.barberoId, notificar: true },
      null,
      true,
    );
    const fila = await this.releerTrasEscribir(reserva);
    const respuesta = { ...(await this.conBanderas(fila)), tokenGestion: fila.tokenGestion };
    void this.notificarCita('reserva.reprogramada', reserva, fila);
    return respuesta;
  }

  /**
   * Relee la cita recién escrita con el `select` público. Exige el token: solo
   * se llama tras crear o reprogramar, donde el cliente lo necesita.
   */
  private async releerTrasEscribir(escrita: { id: string; codigo: string }) {
    const fila = await this.prisma.reserva.findUnique({
      where: { id: escrita.id },
      select: SELECT_RESERVA_PUBLICA,
    });
    if (!fila?.tokenGestion) {
      // La escritura ya está hecha: que falte la relectura es un fallo del servidor.
      // Si era un token nuevo, el cliente se queda sin su llave: el código en el
      // mensaje (que el filtro global registra) permite a soporte localizar la
      // cita en lugar de buscarla a ciegas.
      throw new Error(
        `La reserva ${escrita.codigo} (${escrita.id}) se guardó pero no se pudo releer: el cliente no recibió su token de gestión`,
      );
    }
    return fila as typeof fila & { tokenGestion: string };
  }

  /**
   * `puedeCancelar` y `puedeReprogramar` replican lo que el dominio comprueba al
   * rechazar (`ReservasService.cancelar` y `.reprogramar`): estado que lo
   * permite y horas que faltan (desde ahora hasta el inicio) no inferiores al
   * límite de su propia configuración. Son dos límites distintos. Solo informan:
   * quien decide es el dominio, que vuelve a comprobarlo al escribir.
   */
  private async conBanderas(fila: ReservaEntrada): Promise<MiReservaPublica> {
    const config = await this.configuracion.obtener();
    const estado = fila.estado as EstadoReserva;
    const horasHasta = (fila.inicioEn.getTime() - Date.now()) / 3_600_000;
    return {
      ...aReservaPublica(fila),
      puedeCancelar:
        puedeTransicionar(estado, 'CANCELADA') && horasHasta >= config.horasLimiteCancelacion,
      puedeReprogramar:
        ['PENDIENTE', 'CONFIRMADA'].includes(estado) && horasHasta >= config.horasLimiteReprogramacion,
    };
  }

  /**
   * Regla del canal, no del dominio: recepción sí puede reservar desde el panel
   * un servicio oculto en web, y `resolverServicios` solo filtra por `activo`.
   * Todo lo que falla es «no encontrado»: el cliente no distingue entre un
   * recurso oculto y uno que no existe.
   */
  private async verificarVisibleEnWeb(datos: CrearReservaPublicaDto, idsServicios: string[]): Promise<void> {
    const [sede, servicios, barberosVisibles] = await Promise.all([
      this.prisma.sede.findFirst({
        where: { id: datos.sedeId, activa: true, eliminadoEn: null },
        select: { id: true },
      }),
      this.prisma.servicio.findMany({
        where: { id: { in: idsServicios }, activo: true, visibleWeb: true, eliminadoEn: null },
        select: { id: true },
      }),
      datos.barberoId ? this.lecturas.idsBarberosVisibles(datos.sedeId) : Promise.resolve(null),
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
  private async conHuecosSiSeOcupo(
    error: unknown,
    datos: CrearReservaPublicaDto,
    servicioIds: string[],
    inicioEn: Date,
  ): Promise<unknown> {
    const esSolape =
      (error instanceof ErrorNegocio && error.codigo === CODIGOS_ERROR.RESERVA_SOLAPADA) ||
      PrismaService.esViolacionDe(error, 'reservas_sin_solape_barbero');
    if (!esSolape) return error;

    try {
      const { zonaHoraria } = await this.configuracion.obtener();
      const { huecos } = await this.lecturas.disponibilidad({
        sedeId: datos.sedeId,
        barberoId: datos.barberoId,
        fecha: aFechaLocal(inicioEn, zonaHoraria),
        servicioIds,
      });
      return new ErrorNegocio(CODIGOS_ERROR.RESERVA_SOLAPADA, 409, { huecos });
    } catch {
      return error;
    }
  }
}
