import { Injectable } from '@nestjs/common';
import { CODIGOS_ERROR, ESTADOS_QUE_OCUPAN } from '@cds/shared';
import type { CrearReservaPublicaDto, ReservaPublica } from '@cds/shared';
import { PrismaService } from '../../comun/prisma/prisma.service.js';
import { ConfiguracionNegocioService } from '../../comun/configuracion/configuracion-negocio.service.js';
import { ErrorNegocio } from '../../comun/excepciones/error-negocio.js';
import { aFechaLocal, limitesDelRango } from '../../comun/tiempo/tiempo.js';
import { DisponibilidadService } from '../disponibilidad/disponibilidad.service.js';
import { ReservasService } from '../reservas/reservas.service.js';
import { aReservaPublica } from './dto-publico.js';
import { PublicoService } from './publico.service.js';
import { SELECT_BARBERO_PUBLICO, SELECT_SEDE } from './selects-publico.js';

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
  barbero: { select: SELECT_BARBERO_PUBLICO },
  servicios: {
    select: { nombreSnapshot: true, precioSnapshot: true, duracionSnapshot: true },
    orderBy: { orden: 'asc' },
  },
} as const;

/**
 * Camino de escritura del canal público: elegir barbero y crear la cita.
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
  ) {}

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

    let creada: { id: string; codigo: string };
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

    const fila = await this.prisma.reserva.findUnique({
      where: { id: creada.id },
      select: SELECT_RESERVA_PUBLICA,
    });
    if (!fila?.tokenGestion) {
      // La cita ya está guardada: que falte su lectura es un fallo del servidor.
      // El token sale una sola vez, así que el cliente se queda sin su llave: el
      // código en el mensaje (que el filtro global registra) permite a soporte
      // localizar la cita en lugar de buscarla a ciegas.
      throw new Error(
        `La reserva ${creada.codigo} (${creada.id}) se guardó pero no se pudo releer: el cliente no recibió su token de gestión`,
      );
    }
    return { ...aReservaPublica(fila), tokenGestion: fila.tokenGestion };
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
