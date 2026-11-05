import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type EstadoReserva as EstadoPrisma } from '@prisma/client';
import {
  CODIGOS_ERROR,
  calcularSalto,
  construirMeta,
  puedeTransicionar,
  type CancelarReservaDto,
  type CompletarReservaDto,
  type CrearReservaDto,
  type CrearWalkInDto,
  type EstadoReserva,
  type ReprogramarReservaDto,
} from '@cds/shared';
import { PrismaService } from '../../comun/prisma/prisma.service.js';
import { AuditoriaService } from '../../comun/auditoria/auditoria.service.js';
import { ConfiguracionNegocioService } from '../../comun/configuracion/configuracion-negocio.service.js';
import { ErrorNegocio } from '../../comun/excepciones/error-negocio.js';
import { codigoReserva, tokenGestion } from '../../comun/utilidades/codigos.js';
import { aFechaLocal, fechaLegible, limitesDelDia, limitesDelRango } from '../../comun/tiempo/tiempo.js';
import type { UsuarioAutenticado } from '../../comun/autenticacion/tipos.js';
import { DisponibilidadService } from '../disponibilidad/disponibilidad.service.js';
import { ClientesService } from '../clientes/clientes.service.js';
import { FidelidadService } from '../fidelidad/fidelidad.service.js';
import { VentasService } from '../ventas/ventas.service.js';

/** Datos de los servicios ya resueltos, listos para congelar en la reserva. */
interface ServiciosResueltos {
  items: {
    servicioId: string;
    nombreSnapshot: string;
    precioSnapshot: Prisma.Decimal;
    duracionSnapshot: number;
    canjeable: boolean;
    orden: number;
  }[];
  duracionMinutos: number;
  bufferMinutos: number;
  subtotal: Prisma.Decimal;
  cuentaFidelidad: boolean;
}

const INCLUDE_RESERVA = {
  cliente: {
    select: { id: true, nombreCompleto: true, telefono: true, esGenerico: true, notas: true },
  },
  barbero: { select: { id: true, nombre: true, apellido: true, alias: true, fotoUrl: true } },
  sede: { select: { id: true, nombre: true, direccion: true } },
  creadoPor: { select: { id: true, nombre: true, rol: true } },
  servicios: { orderBy: { orden: 'asc' } },
  canje: { select: { id: true, sellosConsumidos: true, valorCubierto: true } },
  venta: { select: { id: true, numero: true, total: true, metodoPago: true } },
} satisfies Prisma.ReservaInclude;

@Injectable()
export class ReservasService {
  private readonly logger = new Logger(ReservasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly configuracion: ConfiguracionNegocioService,
    private readonly disponibilidad: DisponibilidadService,
    private readonly clientes: ClientesService,
    private readonly fidelidad: FidelidadService,
    private readonly ventas: VentasService,
  ) {}

  // ============================== CREAR ==================================

  /**
   * Crea una reserva desde el panel.
   *
   * El orden de las comprobaciones importa: primero se valida que el hueco
   * exista y esté libre (así el error que ve la recepción es específico y
   * sugiere alternativas), y solo después se escribe. La restricción de
   * exclusión de la base de datos es la última red: si entre la validación y
   * la escritura otra persona ocupó el hueco, el `INSERT` falla y el filtro
   * global lo traduce a "ese horario acaba de ocuparse".
   */
  async crear(datos: CrearReservaDto, actor: UsuarioAutenticado | null, desdeWeb = false) {
    const zona = await this.configuracion.zonaHoraria();
    const inicioEn = new Date(datos.inicioEn);

    await this.verificarBarberoEnSede(datos.barberoId, datos.sedeId);

    const servicios = await this.resolverServicios(datos.servicioIds);
    this.verificarDescuento(datos.descuento, servicios.subtotal);

    await this.disponibilidad.validarHueco({
      sedeId: datos.sedeId,
      barberoId: datos.barberoId,
      inicioEn,
      servicioIds: datos.servicioIds,
      aplicarReglasCliente: desdeWeb,
    });

    const clienteId = await this.resolverCliente(datos, actor);
    if (clienteId) await this.verificarLimiteReservas(clienteId, desdeWeb);

    const config = await this.configuracion.obtener();
    const confirmar = desdeWeb ? !config.requiereConfirmacion : datos.confirmar;

    const reserva = await this.prisma.$transaction(async (tx) => {
      const creada = await this.insertarReserva(tx, {
        clienteId,
        sedeId: datos.sedeId,
        barberoId: datos.barberoId,
        inicioEn,
        servicios,
        estado: confirmar ? 'CONFIRMADA' : 'PENDIENTE',
        canal: desdeWeb ? 'WEB' : 'PANEL',
        descuento: datos.descuento,
        notaCliente: datos.notaCliente,
        notaInterna: datos.notaInterna,
        creadoPorId: desdeWeb ? null : (actor?.id ?? null),
      });

      // El premio se aplica al cobrar, no al reservar: hasta que el cliente no
      // se siente en la silla, el canje no debe consumir sus sellos.
      return creada;
    });

    const completa = await this.obtener(reserva.id);

    await this.auditoria.registrar({
      accion: 'CREAR',
      entidad: 'Reserva',
      entidadId: reserva.id,
      despues: { codigo: reserva.codigo, inicioEn, estado: reserva.estado },
      resumen: `Registró la cita ${reserva.codigo} de ${
        completa.cliente?.nombreCompleto ?? 'cliente sin ficha'
      } con ${completa.barbero.alias ?? completa.barbero.nombre} el ${fechaLegible(inicioEn, zona)}`,
      actor,
    });

    return completa;
  }

  /**
   * Walk-in: el cliente llegó sin cita y ya está en el local.
   *
   * No se pide hora: se busca el primer hueco libre del barbero y se le asigna
   * número de turno del día. Si la recepción manda una hora concreta, se
   * respeta.
   *
   * Si el barbero decide no registrar al cliente, la reserva va contra el
   * "Consumidor final" — y eso queda explícito en la auditoría. Es el punto
   * que pidió el cliente: la aplicación no puede adivinar una visita que nadie
   * apuntó, pero sí deja constancia de quién atendió sin ficha.
   */
  async crearWalkIn(datos: CrearWalkInDto, actor: UsuarioAutenticado) {
    const zona = await this.configuracion.zonaHoraria();

    await this.verificarBarberoEnSede(datos.barberoId, datos.sedeId);
    const servicios = await this.resolverServicios(datos.servicioIds);
    this.verificarDescuento(datos.descuento, servicios.subtotal);

    let inicioEn: Date;
    if (datos.inicioEn) {
      inicioEn = new Date(datos.inicioEn);
      await this.disponibilidad.validarHueco({
        sedeId: datos.sedeId,
        barberoId: datos.barberoId,
        inicioEn,
        servicioIds: datos.servicioIds,
      });
    } else {
      const hueco = await this.disponibilidad.primerHuecoLibre({
        sedeId: datos.sedeId,
        barberoId: datos.barberoId,
        servicioIds: datos.servicioIds,
      });

      if (!hueco.inicioEn) {
        throw ErrorNegocio.conflicto(
          CODIGOS_ERROR.RESERVA_SOLAPADA,
          { motivo: hueco.motivo },
          `No se pudo asignar un hueco automáticamente: ${hueco.motivo} Elige otro barbero o indica una hora concreta.`,
        );
      }
      inicioEn = hueco.inicioEn;
    }

    const clienteId = (await this.resolverCliente(datos, actor)) ?? (await this.clientes.clienteGenerico()).id;
    const turno = await this.siguienteTurno(datos.barberoId, inicioEn, zona);

    const reserva = await this.prisma.$transaction(async (tx) =>
      this.insertarReserva(tx, {
        clienteId,
        sedeId: datos.sedeId,
        barberoId: datos.barberoId,
        inicioEn,
        servicios,
        estado: 'CONFIRMADA',
        canal: 'WALK_IN',
        descuento: datos.descuento,
        notaCliente: datos.notaCliente,
        notaInterna: datos.notaInterna,
        creadoPorId: actor.id,
        turnoWalkIn: turno,
      }),
    );

    const generico = await this.prisma.cliente.findUnique({
      where: { id: clienteId },
      select: { esGenerico: true, nombreCompleto: true },
    });

    await this.auditoria.registrar({
      accion: 'CREAR',
      entidad: 'Reserva',
      entidadId: reserva.id,
      despues: { codigo: reserva.codigo, inicioEn, turnoWalkIn: turno },
      resumen: generico?.esGenerico
        ? `Registró un walk-in SIN ficha de cliente (turno ${turno}, ${reserva.codigo}). El cliente no acumula sellos de fidelidad.`
        : `Registró el walk-in de ${generico?.nombreCompleto} (turno ${turno}, ${reserva.codigo})`,
      actor,
    });

    // En un walk-in lo normal es cobrar en el mismo gesto.
    if (datos.completarYCobrar) {
      return this.completar(
        reserva.id,
        {
          metodoPago: datos.metodoPago,
          productos: [],
          aplicarPremioFidelidad: datos.aplicarPremioFidelidad,
        },
        actor,
      );
    }

    return this.obtener(reserva.id);
  }

  // ============================= CONSULTAS ===============================

  async obtener(id: string) {
    const reserva = await this.prisma.reserva.findUnique({
      where: { id },
      include: INCLUDE_RESERVA,
    });
    if (!reserva) throw ErrorNegocio.noEncontrado('esa reserva');
    return reserva;
  }

  async porCodigo(codigo: string) {
    const reserva = await this.prisma.reserva.findUnique({
      where: { codigo: codigo.toUpperCase() },
      include: INCLUDE_RESERVA,
    });
    if (!reserva) throw ErrorNegocio.noEncontrado('ninguna reserva con ese código');
    return reserva;
  }

  async listar(
    filtros: {
      pagina: number;
      limite: number;
      sedeId?: string;
      barberoId?: string;
      clienteId?: string;
      estado?: EstadoReserva;
      estados?: EstadoReserva[];
      canal?: 'PANEL' | 'WEB' | 'WALK_IN';
      desde?: string;
      hasta?: string;
      soloHoy?: boolean;
      buscar?: string;
      orden: 'asc' | 'desc';
    },
    actor: UsuarioAutenticado,
  ) {
    const zona = await this.configuracion.zonaHoraria();
    const { skip, take, pagina, limite } = calcularSalto(filtros.pagina, filtros.limite);

    const where: Prisma.ReservaWhereInput = {
      ...(filtros.sedeId ? { sedeId: filtros.sedeId } : {}),
      ...(filtros.clienteId ? { clienteId: filtros.clienteId } : {}),
      ...(filtros.canal ? { canal: filtros.canal } : {}),
      ...(filtros.estado ? { estado: filtros.estado as EstadoPrisma } : {}),
      ...(filtros.estados?.length ? { estado: { in: filtros.estados as EstadoPrisma[] } } : {}),
      ...(filtros.buscar
        ? {
            OR: [
              { codigo: { contains: filtros.buscar.toUpperCase() } },
              { cliente: { nombreCompleto: { contains: filtros.buscar, mode: 'insensitive' } } },
              { cliente: { telefono: { contains: filtros.buscar.replace(/\D/g, '') || filtros.buscar } } },
            ],
          }
        : {}),
    };

    // Un barbero solo ve su propia agenda, salvo que tenga permiso ampliado.
    // Es una regla de negocio, no solo de interfaz: aunque manipule la
    // petición, la consulta sigue filtrada.
    if (!actor.permisos.includes('reservas:ver_todas')) {
      where.barberoId = actor.id;
    } else if (filtros.barberoId) {
      where.barberoId = filtros.barberoId;
    }

    if (filtros.soloHoy) {
      const hoy = aFechaLocal(new Date(), zona);
      const { inicio, fin } = limitesDelDia(hoy, zona);
      where.inicioEn = { gte: inicio, lt: fin };
    } else if (filtros.desde || filtros.hasta) {
      const { inicio, fin } = limitesDelRango(
        filtros.desde ?? filtros.hasta!,
        filtros.hasta ?? filtros.desde!,
        zona,
      );
      where.inicioEn = { gte: inicio, lt: fin };
    }

    const [datos, total] = await this.prisma.$transaction([
      this.prisma.reserva.findMany({
        where,
        skip,
        take,
        orderBy: { inicioEn: filtros.orden },
        include: INCLUDE_RESERVA,
      }),
      this.prisma.reserva.count({ where }),
    ]);

    return { datos, meta: construirMeta(total, pagina, limite) };
  }

  /** La agenda del día: lo primero que abre el barbero por la mañana. */
  async agendaDelDia(opciones: { fecha?: string; sedeId?: string; barberoId?: string }, actor: UsuarioAutenticado) {
    const zona = await this.configuracion.zonaHoraria();
    const fecha = opciones.fecha ?? aFechaLocal(new Date(), zona);
    const { inicio, fin } = limitesDelDia(fecha, zona);

    const barberoId = actor.permisos.includes('reservas:ver_todas')
      ? opciones.barberoId
      : actor.id;

    const reservas = await this.prisma.reserva.findMany({
      where: {
        inicioEn: { gte: inicio, lt: fin },
        ...(opciones.sedeId ? { sedeId: opciones.sedeId } : {}),
        ...(barberoId ? { barberoId } : {}),
        estado: { notIn: ['CANCELADA'] },
      },
      orderBy: [{ inicioEn: 'asc' }],
      include: INCLUDE_RESERVA,
    });

    const resumen = {
      total: reservas.length,
      pendientes: reservas.filter((r) => r.estado === 'PENDIENTE').length,
      confirmadas: reservas.filter((r) => r.estado === 'CONFIRMADA').length,
      enCurso: reservas.filter((r) => r.estado === 'EN_CURSO').length,
      completadas: reservas.filter((r) => r.estado === 'COMPLETADA').length,
      noAsistio: reservas.filter((r) => r.estado === 'NO_ASISTIO').length,
      walkIns: reservas.filter((r) => r.canal === 'WALK_IN').length,
      ingresos: reservas
        .filter((r) => r.estado === 'COMPLETADA')
        .reduce((suma, r) => suma + Number(r.total), 0),
    };

    return { fecha, reservas, resumen };
  }

  // ============================== CAMBIOS ================================

  /**
   * Reprograma la cita.
   *
   * Permite cambiar hora, barbero y sede en un solo gesto. El cambio de sede
   * es el caso que pidió el cliente: el barbero se mueve de local y el cliente
   * acepta ir allí, así que la cita se traslada sin cancelarla.
   */
  async reprogramar(
    id: string,
    datos: ReprogramarReservaDto,
    actor: UsuarioAutenticado | null,
    desdeCliente = false,
  ) {
    const zona = await this.configuracion.zonaHoraria();
    const config = await this.configuracion.obtener();
    const antes = await this.obtener(id);

    if (!['PENDIENTE', 'CONFIRMADA'].includes(antes.estado)) {
      throw new ErrorNegocio(CODIGOS_ERROR.ESTADO_RESERVA_INVALIDO, 409, {
        estadoActual: antes.estado,
      });
    }

    if (desdeCliente) {
      const horasHasta = (antes.inicioEn.getTime() - Date.now()) / 3_600_000;
      if (horasHasta < config.horasLimiteReprogramacion) {
        throw new ErrorNegocio(CODIGOS_ERROR.FUERA_DE_PLAZO_REPROGRAMACION, 409, {
          horasLimite: config.horasLimiteReprogramacion,
        });
      }
    }

    const sedeId = datos.sedeId ?? antes.sedeId;
    const barberoId = datos.barberoId ?? antes.barberoId;
    const inicioEn = new Date(datos.inicioEn);

    await this.verificarBarberoEnSede(barberoId, sedeId);

    const servicioIds = antes.servicios.map((s) => s.servicioId);
    await this.disponibilidad.validarHueco({
      sedeId,
      barberoId,
      inicioEn,
      servicioIds,
      // Se excluye a sí misma: si no, la cita chocaría con su propio hueco al
      // moverla media hora.
      excluirReservaId: id,
      aplicarReglasCliente: desdeCliente,
    });

    const finEn = new Date(inicioEn.getTime() + antes.duracionMinutos * 60_000);
    const finConBufferEn = new Date(finEn.getTime() + antes.bufferMinutos * 60_000);

    const despues = await this.prisma.reserva.update({
      where: { id },
      data: {
        sedeId,
        barberoId,
        inicioEn,
        finEn,
        finConBufferEn,
        // Asimetría deliberada, no la «arregles». Si mueve la cita el propio
        // cliente, el token se rota: la respuesta le devuelve el nuevo y el
        // enlace viejo (que pudo quedar en un correo o en WhatsApp) deja de
        // servir. Si la mueve recepción NO se rota: nadie le enviaría el
        // enlace nuevo al cliente, que perdería el acceso a su propia cita, y
        // como el token identifica la cita (no una sesión) rotarlo aquí no
        // protege de nada.
        ...(desdeCliente ? { tokenGestion: tokenGestion() } : {}),
      },
      include: INCLUDE_RESERVA,
    });

    const cambioSede = sedeId !== antes.sedeId ? ` y de sede a ${despues.sede.nombre}` : '';
    const cambioBarbero =
      barberoId !== antes.barberoId
        ? ` con ${despues.barbero.alias ?? despues.barbero.nombre}`
        : '';

    await this.auditoria.registrar({
      accion: 'REPROGRAMAR_RESERVA',
      entidad: 'Reserva',
      entidadId: id,
      antes: { inicioEn: antes.inicioEn, barberoId: antes.barberoId, sedeId: antes.sedeId },
      despues: { inicioEn, barberoId, sedeId },
      resumen: `Movió la cita ${antes.codigo} del ${fechaLegible(antes.inicioEn, zona)} al ${fechaLegible(inicioEn, zona)}${cambioBarbero}${cambioSede}${datos.motivo ? `. Motivo: ${datos.motivo}` : ''}`,
      actor,
    });

    return despues;
  }

  async cancelar(
    id: string,
    datos: CancelarReservaDto,
    actor: UsuarioAutenticado | null,
    origen: 'PANEL' | 'CLIENTE' | 'SISTEMA' = 'PANEL',
  ) {
    const zona = await this.configuracion.zonaHoraria();
    const config = await this.configuracion.obtener();
    const antes = await this.obtener(id);

    if (!puedeTransicionar(antes.estado as EstadoReserva, 'CANCELADA')) {
      throw new ErrorNegocio(CODIGOS_ERROR.ESTADO_RESERVA_INVALIDO, 409, {
        estadoActual: antes.estado,
      });
    }

    if (origen === 'CLIENTE') {
      const horasHasta = (antes.inicioEn.getTime() - Date.now()) / 3_600_000;
      if (horasHasta < config.horasLimiteCancelacion) {
        throw new ErrorNegocio(CODIGOS_ERROR.FUERA_DE_PLAZO_CANCELACION, 409, {
          horasLimite: config.horasLimiteCancelacion,
        });
      }
    }

    const despues = await this.prisma.reserva.update({
      where: { id },
      data: {
        estado: 'CANCELADA',
        canceladaEn: new Date(),
        canceladaPor: origen,
        motivoCancelacion: datos.motivo,
        // Una cita cancelada no se gestiona más: el enlace deja de servir.
        tokenGestion: null,
      },
      include: INCLUDE_RESERVA,
    });

    // El hueco queda libre al instante: la restricción de exclusión solo mira
    // los estados que ocupan tiempo, y CANCELADA no es uno de ellos.
    if (antes.clienteId) await this.clientes.recalcularMetricas(antes.clienteId);

    await this.auditoria.registrar({
      accion: 'CANCELAR_RESERVA',
      entidad: 'Reserva',
      entidadId: id,
      antes: { estado: antes.estado },
      despues: { estado: 'CANCELADA', motivo: datos.motivo },
      resumen: `Canceló la cita ${antes.codigo} de ${
        antes.cliente?.nombreCompleto ?? 'cliente sin ficha'
      } del ${fechaLegible(antes.inicioEn, zona)}${datos.motivo ? `. Motivo: ${datos.motivo}` : ''}`,
      actor,
    });

    return despues;
  }

  /** El barbero marca que ya está atendiendo: pinta la fila en el panel. */
  async iniciar(id: string, actor: UsuarioAutenticado) {
    const antes = await this.obtener(id);
    if (!puedeTransicionar(antes.estado as EstadoReserva, 'EN_CURSO')) {
      throw new ErrorNegocio(CODIGOS_ERROR.ESTADO_RESERVA_INVALIDO, 409, {
        estadoActual: antes.estado,
      });
    }

    return this.prisma.reserva.update({
      where: { id },
      data: { estado: 'EN_CURSO', iniciadaEn: new Date() },
      include: INCLUDE_RESERVA,
    });
  }

  async marcarNoAsistio(id: string, actor: UsuarioAutenticado) {
    const antes = await this.obtener(id);
    if (!puedeTransicionar(antes.estado as EstadoReserva, 'NO_ASISTIO')) {
      throw new ErrorNegocio(CODIGOS_ERROR.ESTADO_RESERVA_INVALIDO, 409, {
        estadoActual: antes.estado,
      });
    }

    const despues = await this.prisma.reserva.update({
      where: { id },
      data: { estado: 'NO_ASISTIO' },
      include: INCLUDE_RESERVA,
    });

    // No genera sello: el cliente no vino, así que no acumula visita.
    if (antes.clienteId) await this.clientes.recalcularMetricas(antes.clienteId);

    await this.auditoria.registrar({
      accion: 'ACTUALIZAR',
      entidad: 'Reserva',
      entidadId: id,
      resumen: `Marcó como "no asistió" la cita ${antes.codigo} de ${
        antes.cliente?.nombreCompleto ?? 'cliente sin ficha'
      }`,
      actor,
    });

    return despues;
  }

  /**
   * Completar y cobrar.
   *
   * Es la operación más delicada del sistema porque toca cinco cosas a la vez
   * y todas tienen que cuadrar: el estado de la reserva, el canje de fidelidad,
   * el sello nuevo, la venta (con su comisión congelada) y el stock de los
   * productos vendidos. Va todo en una transacción: o cuadra entero o no pasa
   * nada. Una venta sin descontar stock, o un sello sin su visita, son errores
   * que después nadie sabe reconstruir.
   */
  async completar(id: string, datos: CompletarReservaDto, actor: UsuarioAutenticado) {
    const zona = await this.configuracion.zonaHoraria();
    const reserva = await this.obtener(id);

    if (!puedeTransicionar(reserva.estado as EstadoReserva, 'COMPLETADA')) {
      throw new ErrorNegocio(CODIGOS_ERROR.ESTADO_RESERVA_INVALIDO, 409, {
        estadoActual: reserva.estado,
      });
    }

    // El descuento del cobro se valida antes de abrir la transacción: así la
    // recepción ve el error en el campo, y no un fallo a medio camino entre el
    // canje de sellos y la venta.
    this.verificarDescuento(
      datos.descuento ?? reserva.descuento,
      new Prisma.Decimal(reserva.subtotal),
    );

    const aplicarPremio = datos.aplicarPremioFidelidad;

    if (aplicarPremio) {
      if (!reserva.clienteId) {
        throw ErrorNegocio.conflicto(
          CODIGOS_ERROR.SELLOS_INSUFICIENTES,
          undefined,
          'Para aplicar el premio hace falta la ficha del cliente: los sellos van asociados a una persona.',
        );
      }
      const canjeable = reserva.servicios.some((s) => s.cubiertoPorCanje === false);
      if (!canjeable) throw new ErrorNegocio(CODIGOS_ERROR.SERVICIO_NO_CANJEABLE, 409);
    }

    const resultado = await this.prisma.$transaction(async (tx) => {
      // 1. El premio cubre el servicio canjeable más caro de la cita.
      let valorCortesia = new Prisma.Decimal(0);
      let canjeId: string | null = null;
      // Qué línea de la cita quedó cubierta por el premio. Hay que recordarlo
      // aquí y no releer `reserva.servicios`: esa copia se cargó antes de la
      // transacción y no sabe nada del canje que se acaba de aplicar. Sin esto
      // la comisión se calcularía también sobre el corte gratis, que es dinero
      // que nunca entró a caja.
      let lineaCubiertaId: string | null = null;

      if (aplicarPremio && reserva.clienteId) {
        const servicios = await tx.reservaServicio.findMany({
          where: { reservaId: id },
          include: { servicio: { select: { canjeableFidelidad: true } } },
          orderBy: { precioSnapshot: 'desc' },
        });

        const aCubrir = servicios.find((s) => s.servicio.canjeableFidelidad);
        if (!aCubrir) throw new ErrorNegocio(CODIGOS_ERROR.SERVICIO_NO_CANJEABLE, 409);

        const canje = await this.fidelidad.canjear(tx, {
          clienteId: reserva.clienteId,
          reservaId: id,
          valorCubierto: aCubrir.precioSnapshot,
          autorizadoPorId: actor.id,
          notas: `Premio aplicado sobre "${aCubrir.nombreSnapshot}"`,
        });

        canjeId = canje.canjeId;
        valorCortesia = aCubrir.precioSnapshot;
        lineaCubiertaId = aCubrir.id;

        await tx.reservaServicio.update({
          where: { id: aCubrir.id },
          data: { cubiertoPorCanje: true },
        });
      }

      // 2. Totales de la cita.
      const descuento = new Prisma.Decimal(datos.descuento ?? Number(reserva.descuento));
      const subtotal = new Prisma.Decimal(reserva.subtotal);
      const total = Prisma.Decimal.max(
        new Prisma.Decimal(0),
        subtotal.minus(descuento).minus(valorCortesia),
      );

      const actualizada = await tx.reserva.update({
        where: { id },
        data: {
          estado: 'COMPLETADA',
          completadaEn: new Date(),
          descuento,
          total,
          ...(datos.notas ? { notaInterna: datos.notas } : {}),
        },
      });

      // 3. Venta: la entrada de dinero que verá el contador.
      const venta = await this.ventas.registrarDesdeReserva(tx, {
        reservaId: id,
        sedeId: reserva.sedeId,
        barberoId: reserva.barberoId,
        clienteId: reserva.clienteId,
        servicios: reserva.servicios.map((s) => ({
          servicioId: s.servicioId,
          nombre: s.nombreSnapshot,
          precio: s.precioSnapshot,
          esCortesia: s.id === lineaCubiertaId,
        })),
        productos: datos.productos,
        descuento,
        totalCortesia: valorCortesia,
        metodoPago: valorCortesia.greaterThan(0) && total.isZero() ? 'CORTESIA' : datos.metodoPago,
        registradoPorId: actor.id,
      });

      // 4. Sello de la visita (si no fue el propio canje el que la generó).
      let selloGenerado = false;
      if (reserva.clienteId) {
        const programa = await this.configuracion.obtenerFidelidad();
        const permitido = canjeId === null || programa.canjeGeneraSello;
        if (permitido) {
          selloGenerado = await this.fidelidad.generarSello(tx, {
            clienteId: reserva.clienteId,
            reservaId: id,
            sedeId: reserva.sedeId,
            cuentaFidelidad: await this.algunServicioCuenta(tx, id),
          });
        }
      }

      // 5. Métricas del cliente, dentro de la misma transacción para que la
      //    ficha nunca muestre un total distinto al historial.
      if (reserva.clienteId) {
        await this.clientes.recalcularMetricas(reserva.clienteId, tx);
      }

      return { actualizada, venta, selloGenerado, canjeId, valorCortesia, total };
    });

    const estadoFidelidad = reserva.clienteId
      ? await this.fidelidad.estado(reserva.clienteId)
      : null;

    await this.auditoria.registrar({
      accion: 'COMPLETAR_RESERVA',
      entidad: 'Reserva',
      entidadId: id,
      despues: {
        total: resultado.total,
        metodoPago: datos.metodoPago,
        ventaNumero: resultado.venta.numero,
        canje: resultado.canjeId !== null,
      },
      resumen: `Cobró la cita ${reserva.codigo} de ${
        reserva.cliente?.nombreCompleto ?? 'cliente sin ficha'
      }: ${this.pesos(resultado.total)} (venta ${resultado.venta.numero})${
        resultado.canjeId ? ' — premio de fidelidad aplicado' : ''
      }`,
      actor,
    });

    if (resultado.canjeId) {
      await this.auditoria.registrar({
        accion: 'CANJEAR_FIDELIDAD',
        entidad: 'CanjeFidelidad',
        entidadId: resultado.canjeId,
        resumen: `Entregó el premio de fidelidad a ${reserva.cliente?.nombreCompleto}: ${this.pesos(resultado.valorCortesia)} cubiertos en la cita ${reserva.codigo}`,
        actor,
      });
    }

    return {
      reserva: await this.obtener(id),
      venta: resultado.venta,
      fidelidad: estadoFidelidad,
      selloGenerado: resultado.selloGenerado,
    };
  }

  // ============================ AUXILIARES ===============================

  /**
   * Resuelve a qué cliente pertenece la reserva.
   *
   * Tres caminos, los tres legítimos: ficha existente, ficha nueva creada al
   * vuelo desde el propio formulario, o ninguna (walk-in anónimo). El tercero
   * devuelve `null` y es quien llama el que decide si usa el genérico.
   */
  private async resolverCliente(
    datos: {
      clienteId?: string;
      clienteNuevo?: { nombreCompleto: string; telefono: string; email?: string; notas?: string };
    },
    actor: UsuarioAutenticado | null,
  ): Promise<string | null> {
    if (datos.clienteId) {
      const existe = await this.prisma.cliente.findFirst({
        where: { id: datos.clienteId, eliminadoEn: null },
        select: { id: true },
      });
      if (!existe) throw ErrorNegocio.noEncontrado('ese cliente');
      return existe.id;
    }

    if (datos.clienteNuevo) {
      // Si el teléfono ya existe se reutiliza la ficha en lugar de fallar: la
      // recepción escribió el número sin buscar antes, y el cliente es el
      // mismo. Evita duplicados silenciosos.
      const existente = await this.prisma.cliente.findUnique({
        where: { telefono: datos.clienteNuevo.telefono },
        select: { id: true, eliminadoEn: true },
      });

      if (existente && !existente.eliminadoEn) return existente.id;

      const creado = await this.clientes.crear(
        {
          nombreCompleto: datos.clienteNuevo.nombreCompleto,
          telefono: datos.clienteNuevo.telefono,
          email: datos.clienteNuevo.email,
          notas: datos.clienteNuevo.notas,
          aceptaWhatsapp: true,
          // Rellenar el correo en el formulario público es el acto de consentir.
          // Sin correo el campo se omite en lugar de mandar `false`: al reactivar
          // una ficha, `ClientesService.crear` copia estos datos tal cual y un
          // `false` borraría un consentimiento que el cliente dio antes.
          ...(datos.clienteNuevo.email ? { aceptaEmail: true } : {}),
          activo: true,
        },
        actor,
      );
      return creado.id;
    }

    return null;
  }

  /** Congela nombre, precio y duración de cada servicio elegido. */
  private async resolverServicios(servicioIds: string[]): Promise<ServiciosResueltos> {
    if (servicioIds.length === 0) throw new ErrorNegocio(CODIGOS_ERROR.SIN_SERVICIOS, 400);

    const config = await this.configuracion.obtener();
    const servicios = await this.prisma.servicio.findMany({
      where: { id: { in: servicioIds }, eliminadoEn: null, activo: true },
    });

    if (servicios.length !== servicioIds.length) {
      throw ErrorNegocio.noEncontrado('alguno de los servicios seleccionados (puede estar desactivado)');
    }

    // Se respeta el orden en que la recepción los eligió.
    const ordenados = servicioIds
      .map((id) => servicios.find((s) => s.id === id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s));

    const items = ordenados.map((servicio, indice) => ({
      servicioId: servicio.id,
      nombreSnapshot: servicio.nombre,
      precioSnapshot: servicio.precio,
      duracionSnapshot: servicio.duracionMinutos,
      canjeable: servicio.canjeableFidelidad,
      orden: indice,
    }));

    return {
      items,
      duracionMinutos: ordenados.reduce((s, x) => s + x.duracionMinutos, 0),
      // Con varios servicios el tiempo de limpieza se cuenta una sola vez.
      bufferMinutos: Math.max(
        ...ordenados.map((s) => s.bufferMinutos ?? config.bufferMinutosDefault),
      ),
      subtotal: ordenados.reduce(
        (suma, s) => suma.plus(s.precio),
        new Prisma.Decimal(0),
      ),
      cuentaFidelidad: ordenados.some((s) => s.cuentaFidelidad),
    };
  }

  private async insertarReserva(
    tx: Prisma.TransactionClient,
    datos: {
      clienteId: string | null;
      sedeId: string;
      barberoId: string;
      inicioEn: Date;
      servicios: ServiciosResueltos;
      estado: 'PENDIENTE' | 'CONFIRMADA';
      canal: 'PANEL' | 'WEB' | 'WALK_IN';
      descuento: number;
      notaCliente?: string;
      notaInterna?: string;
      creadoPorId: string | null;
      turnoWalkIn?: number;
    },
  ) {
    const finEn = new Date(datos.inicioEn.getTime() + datos.servicios.duracionMinutos * 60_000);
    const finConBufferEn = new Date(finEn.getTime() + datos.servicios.bufferMinutos * 60_000);

    const descuento = new Prisma.Decimal(datos.descuento ?? 0);
    // Punto de paso obligado: quien llame mañana a `insertarReserva` sin haber
    // validado antes tampoco podrá escribir un descuento imposible.
    this.verificarDescuento(descuento, datos.servicios.subtotal);

    const total = Prisma.Decimal.max(
      new Prisma.Decimal(0),
      datos.servicios.subtotal.minus(descuento),
    );

    return tx.reserva.create({
      data: {
        codigo: codigoReserva(),
        tokenGestion: tokenGestion(),
        clienteId: datos.clienteId,
        sedeId: datos.sedeId,
        barberoId: datos.barberoId,
        creadoPorId: datos.creadoPorId,
        estado: datos.estado,
        canal: datos.canal,
        inicioEn: datos.inicioEn,
        finEn,
        finConBufferEn,
        duracionMinutos: datos.servicios.duracionMinutos,
        bufferMinutos: datos.servicios.bufferMinutos,
        subtotal: datos.servicios.subtotal,
        descuento,
        total,
        notaCliente: datos.notaCliente,
        notaInterna: datos.notaInterna,
        turnoWalkIn: datos.turnoWalkIn,
        ...(datos.estado === 'CONFIRMADA' ? { confirmadaEn: new Date() } : {}),
        servicios: {
          create: datos.servicios.items.map((item) => ({
            servicioId: item.servicioId,
            nombreSnapshot: item.nombreSnapshot,
            precioSnapshot: item.precioSnapshot,
            duracionSnapshot: item.duracionSnapshot,
            orden: item.orden,
          })),
        },
      },
    });
  }

  /**
   * El descuento no puede pasar del importe de la cita.
   *
   * La base de datos ya lo exige (`reservas_importes_no_negativos` incluye
   * `descuento <= subtotal`), pero acotar solo el total con `Decimal.max(0, …)`
   * no basta: el `descuento` se guardaba tal cual, así que un descuento de
   * 90 000 sobre una cita de 30 000 hacía fallar el `INSERT`. El filtro global
   * no traducía las violaciones de CHECK, de modo que la recepción veía
   * "Ocurrió un error inesperado" y la cita se quedaba sin cobrar.
   *
   * Se rechaza en lugar de recortar en silencio a propósito: si alguien teclea
   * 90 000 donde quería 9 000, recortar al subtotal daría la cita por gratis y
   * nadie se enteraría hasta el cierre de caja. El error va al campo, con el
   * máximo aplicable en el mensaje.
   */
  private verificarDescuento(
    descuento: Prisma.Decimal | number | null | undefined,
    subtotal: Prisma.Decimal,
  ): void {
    const valor = new Prisma.Decimal(descuento ?? 0);
    if (valor.lessThanOrEqualTo(subtotal)) return;

    throw ErrorNegocio.validacion(
      {
        descuento: [
          `El descuento no puede pasar de ${this.pesos(subtotal)}, que es lo que suman los servicios de la cita.`,
        ],
      },
      `El descuento (${this.pesos(valor)}) es mayor que el importe de la cita (${this.pesos(subtotal)}).`,
    );
  }

  private async verificarBarberoEnSede(barberoId: string, sedeId: string): Promise<void> {
    const barbero = await this.prisma.usuario.findFirst({
      where: { id: barberoId, rol: 'BARBERO', activo: true, eliminadoEn: null },
      select: { id: true, sedeId: true, sedesPermitidas: { select: { sedeId: true } } },
    });

    if (!barbero) throw ErrorNegocio.noEncontrado('ese barbero');

    const permitidas = [
      ...(barbero.sedeId ? [barbero.sedeId] : []),
      ...barbero.sedesPermitidas.map((s) => s.sedeId),
    ];

    if (!permitidas.includes(sedeId)) {
      throw new ErrorNegocio(CODIGOS_ERROR.BARBERO_NO_PERTENECE_A_SEDE, 409);
    }
  }

  /** Evita que un cliente acapare la agenda reservando diez veces. */
  private async verificarLimiteReservas(clienteId: string, soloWeb: boolean): Promise<void> {
    if (!soloWeb) return; // la recepción puede saltarse el límite si hace falta

    const config = await this.configuracion.obtener();
    const activas = await this.prisma.reserva.count({
      where: {
        clienteId,
        estado: { in: ['PENDIENTE', 'CONFIRMADA'] },
        inicioEn: { gte: new Date() },
      },
    });

    if (activas >= config.maxReservasActivasCliente) {
      throw new ErrorNegocio(CODIGOS_ERROR.LIMITE_RESERVAS_ACTIVAS, 409, {
        activas,
        maximo: config.maxReservasActivasCliente,
      });
    }
  }

  /** Número de turno del día para los walk-ins de ese barbero. */
  private async siguienteTurno(barberoId: string, instante: Date, zona: string): Promise<number> {
    const { inicio, fin } = limitesDelDia(aFechaLocal(instante, zona), zona);

    const ultimo = await this.prisma.reserva.aggregate({
      where: {
        barberoId,
        canal: 'WALK_IN',
        inicioEn: { gte: inicio, lt: fin },
      },
      _max: { turnoWalkIn: true },
    });

    return (ultimo._max.turnoWalkIn ?? 0) + 1;
  }

  private async algunServicioCuenta(tx: Prisma.TransactionClient, reservaId: string): Promise<boolean> {
    const servicios = await tx.reservaServicio.findMany({
      where: { reservaId },
      select: { servicio: { select: { cuentaFidelidad: true } } },
    });
    return servicios.some((s) => s.servicio.cuentaFidelidad);
  }

  private pesos(valor: Prisma.Decimal | number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(Number(valor));
  }
}
