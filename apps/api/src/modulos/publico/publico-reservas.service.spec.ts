import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  crearConfiguracionDoble,
  crearDisponibilidadDoble,
  crearPrismaDoble,
} from '../../../test/soporte/dobles.js';
import { ID, configuracion } from '../../../test/soporte/datos.js';
import {
  SEDE_A,
  SERVICIO,
  huecosDe,
  agenda,
  respuestaDelDia,
  sede,
} from '../../../test/soporte/agenda-publica.js';
import { CODIGOS_ERROR, ESTADOS_QUE_OCUPAN } from '@cds/shared';
import { ErrorNegocio } from '../../comun/excepciones/error-negocio.js';
import { PublicoReservasService } from './publico-reservas.service.js';
import { PublicoService } from './publico.service.js';
import { SELECT_BARBERO_PUBLICO, SELECT_SEDE } from './selects-publico.js';

/** El servicio de escritura con el de lecturas real, sobre los mismos dobles. */
function montarServicio(
  prisma: ReturnType<typeof crearPrismaDoble>,
  disponibilidad: ReturnType<typeof crearDisponibilidadDoble>,
  reservas: unknown,
  notificaciones: unknown = { encolar: vi.fn(async () => undefined) },
): PublicoReservasService {
  const config = crearConfiguracionDoble(configuracion()) as never;
  const lecturas = new PublicoService(prisma as never, config, disponibilidad as never);
  const entorno = { get: (clave: string) => (clave === 'BOOKING_ORIGIN' ? 'https://reservas.test' : undefined) };
  return new PublicoReservasService(
    prisma as never,
    config,
    disponibilidad as never,
    reservas as never,
    lecturas,
    notificaciones as never,
    entorno as never,
  );
}

// ======================== Asignación automática ==============================

describe('PublicoReservasService.elegirBarbero', () => {
  // 10:00 en Bogotá del 10 de noviembre de 2026.
  const INICIO = new Date('2026-11-10T15:00:00.000Z');
  const B1 = '00000000-0000-4000-8000-000000000001';
  const B2 = '00000000-0000-4000-8000-000000000002';
  const B3 = '00000000-0000-4000-8000-000000000003';

  let prisma: ReturnType<typeof crearPrismaDoble>;
  let disponibilidad: ReturnType<typeof crearDisponibilidadDoble>;
  let servicio: PublicoReservasService;

  /** Un barbero con el hueco de `INICIO` libre u ocupado. */
  const conHueco = (barberoId: string, disponible = true, trabaja = true) =>
    agenda(
      barberoId,
      [
        {
          inicioEn: INICIO.toISOString(),
          hora: '10:00',
          disponible,
          ...(disponible ? {} : { motivo: 'OCUPADO' as const }),
        },
      ],
      trabaja,
    );

  const pedir = () => servicio.elegirBarbero({ sedeId: SEDE_A, inicioEn: INICIO, servicioIds: [SERVICIO] });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T15:00:00Z'));
    prisma = crearPrismaDoble();
    prisma.usuario.findMany.mockResolvedValue([{ id: B1 }, { id: B2 }, { id: B3 }]);
    prisma.reserva.findMany.mockResolvedValue([]);
    disponibilidad = crearDisponibilidadDoble();
    disponibilidad.delDia.mockResolvedValue(
      respuestaDelDia([conHueco(B1), conHueco(B2), conHueco(B3)]),
    );
    servicio = montarServicio(prisma, disponibilidad, {});
  });

  afterEach(() => vi.useRealTimers());

  it('elige al barbero con menos minutos ocupados ese día', async () => {
    prisma.reserva.findMany.mockResolvedValue([
      { barberoId: B1, duracionMinutos: 120 },
      { barberoId: B1, duracionMinutos: 60 },
      { barberoId: B2, duracionMinutos: 60 },
      { barberoId: B3, duracionMinutos: 90 },
    ]);
    expect(await pedir()).toBe(B2);
  });

  it('un barbero sin reservas ese día tiene carga cero y gana', async () => {
    prisma.reserva.findMany.mockResolvedValue([
      { barberoId: B1, duracionMinutos: 30 },
      { barberoId: B2, duracionMinutos: 30 },
    ]);
    expect(await pedir()).toBe(B3);
  });

  it('a igualdad de carga elige el de id menor, sin depender del orden de las filas', async () => {
    prisma.reserva.findMany.mockResolvedValue([
      { barberoId: B3, duracionMinutos: 60 },
      { barberoId: B2, duracionMinutos: 60 },
      { barberoId: B1, duracionMinutos: 60 },
    ]);
    const directo = await pedir();

    // Mismo estado, pero la base devuelve todo en el orden contrario.
    prisma.usuario.findMany.mockResolvedValue([{ id: B3 }, { id: B2 }, { id: B1 }]);
    disponibilidad.delDia.mockResolvedValue(
      respuestaDelDia([conHueco(B3), conHueco(B2), conHueco(B1)]),
    );
    prisma.reserva.findMany.mockResolvedValue([
      { barberoId: B1, duracionMinutos: 60 },
      { barberoId: B2, duracionMinutos: 60 },
      { barberoId: B3, duracionMinutos: 60 },
    ]);
    const invertido = await pedir();

    expect(directo).toBe(B1);
    expect(invertido).toBe(B1);
  });

  it('ignora a los barberos que no tienen ese hueco libre', async () => {
    disponibilidad.delDia.mockResolvedValue(
      respuestaDelDia([conHueco(B1, false), conHueco(B2), conHueco(B3, true, false)]),
    );
    prisma.reserva.findMany.mockResolvedValue([{ barberoId: B2, duracionMinutos: 300 }]);
    expect(await pedir()).toBe(B2);
  });

  it('ignora a un barbero que no tiene ese instante en su rejilla', async () => {
    disponibilidad.delDia.mockResolvedValue(
      respuestaDelDia([agenda(B1, huecosDe(['09:00'])), conHueco(B2)]),
    );
    expect(await pedir()).toBe(B2);
  });

  it('ignora a los barberos no visibles en la web', async () => {
    // B1 es el menos cargado y está libre, pero la web no lo muestra.
    prisma.usuario.findMany.mockResolvedValue([{ id: B2 }, { id: B3 }]);
    prisma.reserva.findMany.mockResolvedValue([{ barberoId: B2, duracionMinutos: 60 }]);
    expect(await pedir()).toBe(B3);
    expect(prisma.usuario.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          rol: 'BARBERO',
          activo: true,
          visibleWeb: true,
          eliminadoEn: null,
        }),
      }),
    );
  });

  it('mide la carga solo con estados que ocupan y dentro del día local de la cita', async () => {
    await pedir();
    const { where } = prisma.reserva.findMany.mock.calls[0]![0];
    expect(where.estado).toEqual({ in: [...ESTADOS_QUE_OCUPAN] });
    // Día local 2026-11-10 en Bogotá: de 05:00Z a 05:00Z del día siguiente.
    expect(where.inicioEn.gte.toISOString()).toBe('2026-11-10T05:00:00.000Z');
    expect(where.inicioEn.lt.toISOString()).toBe('2026-11-11T05:00:00.000Z');
  });

  it('pide la disponibilidad del día local con las reglas del cliente y la duración elegida', async () => {
    await pedir();
    expect(disponibilidad.delDia).toHaveBeenCalledWith(
      expect.objectContaining({
        sedeId: SEDE_A,
        fecha: '2026-11-10',
        servicioIds: [SERVICIO],
        aplicarReglasCliente: true,
      }),
    );
  });

  it('cuenta la carga del barbero en todas las sedes, no solo en la de la cita', async () => {
    // B1 tiene 240 min en otra sede ese día (la consulta no filtra por sede).
    prisma.reserva.findMany.mockResolvedValue([
      { barberoId: B1, duracionMinutos: 240 },
      { barberoId: B2, duracionMinutos: 60 },
    ]);
    disponibilidad.delDia.mockResolvedValue(respuestaDelDia([conHueco(B1), conHueco(B2)]));
    expect(await pedir()).toBe(B2);
    const { where } = prisma.reserva.findMany.mock.calls[0]![0];
    expect(where).not.toHaveProperty('sedeId');
    expect(where.barberoId).toEqual({ in: [B1, B2] });
  });

  it('con un solo candidato no consulta la carga', async () => {
    disponibilidad.delDia.mockResolvedValue(
      respuestaDelDia([conHueco(B1, false), conHueco(B2), conHueco(B3, false)]),
    );
    expect(await pedir()).toBe(B2);
    expect(prisma.reserva.findMany).not.toHaveBeenCalled();
  });

  it('hace un número fijo de consultas, sin bucle por barbero', async () => {
    await pedir();
    expect(disponibilidad.delDia).toHaveBeenCalledTimes(1);
    expect(prisma.usuario.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.reserva.findMany).toHaveBeenCalledTimes(1);
  });

  it('lanza RESERVA_SOLAPADA si ninguno está libre', async () => {
    disponibilidad.delDia.mockResolvedValue(
      respuestaDelDia([conHueco(B1, false), conHueco(B2, false)]),
    );
    await expect(pedir()).rejects.toMatchObject({
      codigo: CODIGOS_ERROR.RESERVA_SOLAPADA,
      status: 409,
    });
  });

  it('lanza RESERVA_SOLAPADA si los únicos libres no son visibles', async () => {
    prisma.usuario.findMany.mockResolvedValue([]);
    await expect(pedir()).rejects.toBeInstanceOf(ErrorNegocio);
    await expect(pedir()).rejects.toMatchObject({
      codigo: CODIGOS_ERROR.RESERVA_SOLAPADA,
      status: 409,
    });
  });

  it('lanza RESERVA_SOLAPADA si el día no es laborable', async () => {
    disponibilidad.delDia.mockResolvedValue({ ...respuestaDelDia([]), laborable: false });
    await expect(pedir()).rejects.toMatchObject({ codigo: CODIGOS_ERROR.RESERVA_SOLAPADA });
  });
});

// ============================================================ Crear reserva

describe('PublicoReservasService.crearReserva', () => {
  const INICIO = '2026-11-05T15:00:00.000Z';
  const datosWeb = (cambios: Record<string, unknown> = {}) =>
    ({
      sedeId: ID.sede,
      servicioIds: [ID.servicioCorte],
      inicioEn: INICIO,
      barberoId: ID.barbero,
      cliente: { nombreCompleto: 'Juan Pérez', telefono: '+573001234567' },
      tokenTurnstile: 'token-del-widget',
      ...cambios,
    }) as never;

  /** Fila que devuelve la relectura con el `select` público. */
  const filaPublica = (cambios: Record<string, unknown> = {}) => ({
    codigo: 'CDS-A1B2',
    estado: 'CONFIRMADA',
    inicioEn: new Date(INICIO),
    finEn: new Date('2026-11-05T15:30:00.000Z'),
    total: new Prisma.Decimal(30000),
    tokenGestion: 'tok_unico',
    sede: sede(ID.sede, 'Centro'),
    barbero: { id: ID.barbero, nombre: 'Andrés', alias: 'Andy', bio: 'Clásicos', fotoUrl: null },
    servicios: [
      { nombreSnapshot: 'Corte', precioSnapshot: new Prisma.Decimal(30000), duracionSnapshot: 30 },
    ],
    ...cambios,
  });

  let prisma: ReturnType<typeof crearPrismaDoble>;
  let reservas: { crear: ReturnType<typeof vi.fn> };
  let disponibilidad: ReturnType<typeof crearDisponibilidadDoble>;
  let servicio: PublicoReservasService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T15:00:00Z'));
    prisma = crearPrismaDoble();
    prisma.sede.findFirst.mockResolvedValue({ id: ID.sede });
    prisma.servicio.findMany.mockResolvedValue([{ id: ID.servicioCorte }]);
    prisma.usuario.findMany.mockResolvedValue([{ id: ID.barbero }]);
    prisma.reserva.findUnique.mockResolvedValue(filaPublica());
    reservas = { crear: vi.fn(async () => ({ id: ID.reserva, codigo: 'CDS-A1B2' })) };
    disponibilidad = crearDisponibilidadDoble();
    servicio = montarServicio(prisma, disponibilidad, reservas);
  });

  afterEach(() => vi.useRealTimers());

  it('crea sin actor, con la ficha del cliente y marcando el canal web', async () => {
    await servicio.crearReserva(datosWeb());
    // Con la clave equivocada (`cliente`) la cita quedaría sin ficha y en silencio.
    expect(reservas.crear).toHaveBeenCalledWith(
      expect.objectContaining({
        clienteNuevo: { nombreCompleto: 'Juan Pérez', telefono: '+573001234567', email: undefined },
      }),
      null,
      true,
    );
  });

  it('solo pasa al dominio los campos que el canal público admite', async () => {
    await servicio.crearReserva(
      datosWeb({
        notaCliente: 'Sin prisa',
        // Lo que un atacante intentaría colar: el esquema lo descarta y, aun así,
        // el servicio construye el DTO campo a campo.
        clienteId: ID.cliente,
        descuento: 99999,
        notaInterna: 'x',
        confirmar: false,
        aplicarPremioFidelidad: true,
      }),
    );
    expect(reservas.crear.mock.calls[0]![0]).toEqual({
      sedeId: ID.sede,
      barberoId: ID.barbero,
      servicioIds: [ID.servicioCorte],
      inicioEn: INICIO,
      clienteNuevo: { nombreCompleto: 'Juan Pérez', telefono: '+573001234567', email: undefined },
      notaCliente: 'Sin prisa',
      descuento: 0,
      aplicarPremioFidelidad: false,
      confirmar: false,
    });
  });

  it('no manda dos veces el mismo servicio al dominio ni a la elección de barbero', async () => {
    const elegir = vi.spyOn(servicio, 'elegirBarbero').mockResolvedValue(ID.barbero);
    await servicio.crearReserva(
      datosWeb({ barberoId: undefined, servicioIds: [ID.servicioCorte, ID.servicioCorte] }),
    );
    expect(reservas.crear.mock.calls[0]![0]).toMatchObject({ servicioIds: [ID.servicioCorte] });
    expect(elegir).toHaveBeenCalledWith(expect.objectContaining({ servicioIds: [ID.servicioCorte] }));
  });

  it('si la relectura falla, el error lleva el código de la cita para que soporte la localice', async () => {
    reservas.crear.mockResolvedValue({ id: ID.reserva, codigo: 'CDS-A1B2' });
    prisma.reserva.findUnique.mockResolvedValue(null);
    await expect(servicio.crearReserva(datosWeb())).rejects.toThrow(/CDS-A1B2/);
  });

  it('rechaza un servicio que no es visible en web', async () => {
    // El `where` pide visibleWeb: la base devuelve menos filas que ids pedidos.
    prisma.servicio.findMany.mockResolvedValue([]);
    await expect(
      servicio.crearReserva(datosWeb({ servicioIds: [ID.servicioBarba] })),
    ).rejects.toMatchObject({ codigo: CODIGOS_ERROR.RECURSO_NO_ENCONTRADO });
    expect(prisma.servicio.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: [ID.servicioBarba] },
          activo: true,
          visibleWeb: true,
          eliminadoEn: null,
        }),
      }),
    );
    expect(reservas.crear).not.toHaveBeenCalled();
  });

  it('rechaza un barbero que no es visible en web', async () => {
    prisma.usuario.findMany.mockResolvedValue([{ id: 'otro-barbero' }]);
    await expect(servicio.crearReserva(datosWeb())).rejects.toMatchObject({
      codigo: CODIGOS_ERROR.RECURSO_NO_ENCONTRADO,
    });
    expect(reservas.crear).not.toHaveBeenCalled();
  });

  it('rechaza una sede inactiva o eliminada', async () => {
    prisma.sede.findFirst.mockResolvedValue(null);
    await expect(servicio.crearReserva(datosWeb())).rejects.toMatchObject({
      codigo: CODIGOS_ERROR.RECURSO_NO_ENCONTRADO,
    });
    expect(prisma.sede.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ID.sede, activa: true, eliminadoEn: null } }),
    );
    expect(reservas.crear).not.toHaveBeenCalled();
  });

  it('elige barbero cuando no viene en la petición', async () => {
    const elegir = vi.spyOn(servicio, 'elegirBarbero').mockResolvedValue(ID.barbero);
    await servicio.crearReserva(datosWeb({ barberoId: undefined }));
    expect(elegir).toHaveBeenCalledWith({
      sedeId: ID.sede,
      inicioEn: new Date(INICIO),
      servicioIds: [ID.servicioCorte],
    });
    expect(reservas.crear.mock.calls[0]![0]).toMatchObject({ barberoId: ID.barbero });
  });

  it('respeta el barbero elegido cuando viene', async () => {
    const elegir = vi.spyOn(servicio, 'elegirBarbero');
    await servicio.crearReserva(datosWeb());
    expect(elegir).not.toHaveBeenCalled();
    expect(reservas.crear.mock.calls[0]![0]).toMatchObject({ barberoId: ID.barbero });
  });

  it('devuelve el token de gestión una sola vez, al crear', async () => {
    const respuesta = await servicio.crearReserva(datosWeb());
    expect(respuesta.tokenGestion).toBe('tok_unico');
  });

  describe('confirmación por correo', () => {
    let notificaciones: { encolar: ReturnType<typeof vi.fn> };

    const fichaConCorreo = (cambios: Record<string, unknown> = {}) => ({
      nombreCompleto: 'Juan Pérez',
      email: 'juan@correo.co',
      aceptaEmail: true,
      ...cambios,
    });

    beforeEach(() => {
      notificaciones = { encolar: vi.fn(async () => undefined) };
      reservas.crear.mockResolvedValue({ id: ID.reserva, codigo: 'CDS-A1B2', clienteId: ID.cliente });
      prisma.cliente.findUnique.mockResolvedValue(fichaConCorreo());
      servicio = montarServicio(prisma, disponibilidad, reservas, notificaciones);
    });

    it('encola la confirmación con el enlace de gestión en el fragmento', async () => {
      await servicio.crearReserva(datosWeb());
      await vi.waitFor(() => expect(notificaciones.encolar).toHaveBeenCalledOnce());
      expect(notificaciones.encolar).toHaveBeenCalledWith({
        reservaId: ID.reserva,
        clienteId: ID.cliente,
        clave: 'reserva.confirmada',
        canal: 'EMAIL',
        destino: 'juan@correo.co',
        variables: {
          cliente: 'Juan Pérez',
          fecha: expect.stringContaining('noviembre'),
          barbero: 'Andrés',
          sede: 'Centro',
          codigo: 'CDS-A1B2',
          // El token va en el hash: un fragmento no viaja al servidor ni al Referer.
          enlace: 'https://reservas.test/cita#tok_unico',
        },
        omitirDelPayload: ['enlace'],
      });
    });

    it('usa la ficha del cliente, no el correo del cuerpo', async () => {
      await servicio.crearReserva(datosWeb({ cliente: { nombreCompleto: 'J', telefono: '+573001234567', email: 'otro@x.co' } }));
      await vi.waitFor(() => expect(notificaciones.encolar).toHaveBeenCalled());
      expect(notificaciones.encolar.mock.calls[0]![0]).toMatchObject({ destino: 'juan@correo.co' });
    });

    it('no encola nada si la ficha no tiene correo', async () => {
      prisma.cliente.findUnique.mockResolvedValue(fichaConCorreo({ email: null }));
      await servicio.crearReserva(datosWeb());
      await vi.waitFor(() => expect(prisma.cliente.findUnique).toHaveBeenCalled());
      await vi.advanceTimersByTimeAsync(0);
      expect(notificaciones.encolar).not.toHaveBeenCalled();
    });

    it('no encola nada si el cliente no aceptó correo, aunque la ficha tenga uno', async () => {
      // `aceptaEmail` solo se marca cuando el cliente escribe su correo en la web.
      prisma.cliente.findUnique.mockResolvedValue(fichaConCorreo({ aceptaEmail: false }));
      await servicio.crearReserva(datosWeb());
      await vi.waitFor(() => expect(prisma.cliente.findUnique).toHaveBeenCalled());
      await vi.advanceTimersByTimeAsync(0);
      expect(notificaciones.encolar).not.toHaveBeenCalled();
    });

    it('un fallo de notificación no tumba la reserva', async () => {
      notificaciones.encolar.mockRejectedValue(new Error('boom'));
      await expect(servicio.crearReserva(datosWeb())).resolves.toMatchObject({ tokenGestion: 'tok_unico' });
    });

    it('un fallo al leer la ficha tampoco tumba la reserva', async () => {
      prisma.cliente.findUnique.mockRejectedValue(new Error('base caída'));
      await expect(servicio.crearReserva(datosWeb())).resolves.toMatchObject({ codigo: 'CDS-A1B2' });
    });

    it('no espera al proveedor para responder', async () => {
      notificaciones.encolar.mockReturnValue(new Promise(() => undefined));
      await expect(servicio.crearReserva(datosWeb())).resolves.toMatchObject({ tokenGestion: 'tok_unico' });
    });

    it('si la reserva falla no se encola nada', async () => {
      reservas.crear.mockRejectedValue(new Error('x'));
      await expect(servicio.crearReserva(datosWeb())).rejects.toThrow();
      expect(prisma.cliente.findUnique).not.toHaveBeenCalled();
      expect(notificaciones.encolar).not.toHaveBeenCalled();
    });
  });

  it('responde con la forma pública exacta y pide todas las columnas que emiten los mapeadores', async () => {
    const respuesta = await servicio.crearReserva(datosWeb());
    expect(Object.keys(respuesta).sort()).toEqual(
      ['barbero', 'codigo', 'estado', 'finEn', 'inicioEn', 'sede', 'servicios', 'tokenGestion', 'total'].sort(),
    );
    expect(respuesta.sede).toEqual({
      id: ID.sede,
      nombre: 'Centro',
      direccion: 'Calle 1',
      ciudad: 'Bogotá',
      telefono: '3000000000',
      mapsUrl: 'https://maps.example/x',
    });
    expect(respuesta.barbero).toEqual({ id: ID.barbero, nombre: 'Andy', bio: 'Clásicos', fotoUrl: null });
    // Si falta una columna en el `select`, la clave sale `undefined` y la
    // prueba de claves exactas no lo ve: se fija el `select` entero.
    const select = prisma.reserva.findUnique.mock.calls[0]![0].select;
    expect(select.sede.select).toEqual({
      id: true,
      nombre: true,
      direccion: true,
      ciudad: true,
      telefono: true,
      mapsUrl: true,
    });
    expect(select.barbero.select).toEqual({
      id: true,
      nombre: true,
      alias: true,
      bio: true,
      fotoUrl: true,
    });
    expect(select.servicios.select).toEqual({
      nombreSnapshot: true,
      precioSnapshot: true,
      duracionSnapshot: true,
    });
  });

  describe('cuando el horario se acaba de ocupar', () => {
    const huecos = [{ inicioEn: '2026-11-05T16:00:00.000Z', hora: '11:00', disponible: true }];

    beforeEach(() => {
      disponibilidad.delDia.mockResolvedValue(respuestaDelDia([agenda(ID.barbero, huecos)]));
    });

    it('adjunta los huecos recalculados si el dominio rechaza por solape', async () => {
      reservas.crear.mockRejectedValue(new ErrorNegocio(CODIGOS_ERROR.RESERVA_SOLAPADA, 409));
      const error = await servicio.crearReserva(datosWeb()).catch((e) => e);
      expect(error).toBeInstanceOf(ErrorNegocio);
      expect(error.codigo).toBe(CODIGOS_ERROR.RESERVA_SOLAPADA);
      expect(error.getStatus()).toBe(409);
      expect(error.detalle.huecos).toBeInstanceOf(Array);
      expect(error.detalle.huecos).toEqual(huecos);
    });

    it('lo mismo si pierde la carrera contra la restricción de la base de datos', async () => {
      reservas.crear.mockRejectedValue(
        new Prisma.PrismaClientUnknownRequestError(
          'conflicting key value violates exclusion constraint "reservas_sin_solape_barbero"',
          { clientVersion: 'test' },
        ),
      );
      const error = await servicio.crearReserva(datosWeb()).catch((e) => e);
      expect(error.codigo).toBe(CODIGOS_ERROR.RESERVA_SOLAPADA);
      expect(error.detalle.huecos).toEqual(huecos);
    });

    it('lo mismo si elegirBarbero no encuentra a nadie libre', async () => {
      vi.spyOn(servicio, 'elegirBarbero').mockRejectedValue(
        new ErrorNegocio(CODIGOS_ERROR.RESERVA_SOLAPADA, 409),
      );
      const error = await servicio.crearReserva(datosWeb({ barberoId: undefined })).catch((e) => e);
      expect(error.codigo).toBe(CODIGOS_ERROR.RESERVA_SOLAPADA);
      expect(error.detalle.huecos).toEqual(huecos);
    });

    it('si no se pueden recalcular los huecos, propaga el error original', async () => {
      const original = new ErrorNegocio(CODIGOS_ERROR.RESERVA_SOLAPADA, 409);
      reservas.crear.mockRejectedValue(original);
      disponibilidad.delDia.mockRejectedValue(new Error('base caída'));
      await expect(servicio.crearReserva(datosWeb())).rejects.toBe(original);
    });

    it('no toca otros errores', async () => {
      const otro = new ErrorNegocio(CODIGOS_ERROR.RECURSO_NO_ENCONTRADO, 404);
      reservas.crear.mockRejectedValue(otro);
      await expect(servicio.crearReserva(datosWeb())).rejects.toBe(otro);
      expect(disponibilidad.delDia).not.toHaveBeenCalled();
    });
  });
});

// ================= Gestión de la cita con el token ===========================

describe('PublicoReservasService: gestión con token', () => {
  // Ahora: 2026-11-04 15:00Z. Límites por defecto de la configuración: 4 h y 4 h.
  const AHORA = new Date('2026-11-04T15:00:00Z');
  const enHoras = (h: number) => new Date(AHORA.getTime() + h * 3_600_000);

  /** Fila interna que entrega el guard: lleva token, nota interna y ficha del cliente. */
  const resuelta = (cambios: Record<string, unknown> = {}) =>
    ({
      id: ID.reserva,
      codigo: 'CDS-A1B2',
      estado: 'CONFIRMADA',
      inicioEn: enHoras(48),
      tokenGestion: 'tok_guard',
      notaInterna: 'NOTA INTERNA',
      clienteId: ID.cliente,
      ...cambios,
    }) as never;

  /** Lo que devuelve la relectura con el `select` público. */
  const filaPublica = (cambios: Record<string, unknown> = {}) => ({
    codigo: 'CDS-A1B2',
    estado: 'CONFIRMADA',
    inicioEn: enHoras(48),
    finEn: enHoras(48.5),
    total: new Prisma.Decimal(30000),
    tokenGestion: 'tok_relectura',
    sede: sede(ID.sede, 'Centro'),
    barbero: { id: ID.barbero, nombre: 'Andrés', alias: 'Andy', bio: 'Clásicos', fotoUrl: null },
    servicios: [
      { nombreSnapshot: 'Corte', precioSnapshot: new Prisma.Decimal(30000), duracionSnapshot: 30 },
    ],
    ...cambios,
  });

  let prisma: ReturnType<typeof crearPrismaDoble>;
  let reservas: { cancelar: ReturnType<typeof vi.fn>; reprogramar: ReturnType<typeof vi.fn> };
  let servicio: PublicoReservasService;

  const montarConLimites = (
    cambios: Record<string, unknown> = {},
    notificaciones: unknown = { encolar: vi.fn() },
  ) => {
    const config = crearConfiguracionDoble(configuracion(cambios)) as never;
    const disponibilidad = crearDisponibilidadDoble();
    const lecturas = new PublicoService(prisma as never, config, disponibilidad as never);
    servicio = new PublicoReservasService(
      prisma as never,
      config,
      disponibilidad as never,
      reservas as never,
      lecturas,
      notificaciones as never,
      { get: (clave: string) => (clave === 'BOOKING_ORIGIN' ? 'https://reservas.test' : undefined) } as never,
    );
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AHORA);
    prisma = crearPrismaDoble();
    prisma.reserva.findUnique.mockResolvedValue(filaPublica());
    reservas = {
      cancelar: vi.fn(async () => ({ id: ID.reserva })),
      reprogramar: vi.fn(async () => ({ id: ID.reserva })),
    };
    montarConLimites();
  });

  afterEach(() => vi.useRealTimers());

  describe('miReserva', () => {
    it('devuelve la vista pública con las dos banderas, sin token ni datos internos', async () => {
      const respuesta = await servicio.miReserva(resuelta());

      expect(Object.keys(respuesta).sort()).toEqual(
        [
          'barbero',
          'codigo',
          'estado',
          'finEn',
          'inicioEn',
          'puedeCancelar',
          'puedeReprogramar',
          'sede',
          'servicios',
          'total',
        ].sort(),
      );
      expect(respuesta).toMatchObject({ puedeCancelar: true, puedeReprogramar: true });
      expect(JSON.stringify(respuesta)).not.toMatch(/tok_guard|tok_relectura|NOTA INTERNA/);
    });

    it('relee por id con el select público completo', async () => {
      await servicio.miReserva(resuelta());
      const consulta = prisma.reserva.findUnique.mock.calls[0]![0];
      expect(consulta.where).toEqual({ id: ID.reserva });
      // Si faltara una columna que emite el mapeador, saldría `undefined` sin error.
      // Conjunto entero, no los casos que recordamos hoy: cualquier columna que
      // emita el mapeador y falte aquí saldría `undefined` sin que nada lo vea.
      expect(consulta.select.sede.select).toEqual(SELECT_SEDE);
      expect(consulta.select.barbero.select).toEqual(SELECT_BARBERO_PUBLICO);
    });

    it('con la cita a 2 h y límite de cancelación de 4 h, no puede cancelar', async () => {
      prisma.reserva.findUnique.mockResolvedValue(filaPublica({ inicioEn: enHoras(2) }));
      expect(await servicio.miReserva(resuelta())).toMatchObject({
        puedeCancelar: false,
        puedeReprogramar: false,
      });
    });

    it('los dos límites son independientes', async () => {
      // A 3 h: cancelar exige 2 h (puede), reprogramar exige 6 h (no puede).
      montarConLimites({ horasLimiteCancelacion: 2, horasLimiteReprogramacion: 6 });
      prisma.reserva.findUnique.mockResolvedValue(filaPublica({ inicioEn: enHoras(3) }));
      expect(await servicio.miReserva(resuelta())).toMatchObject({
        puedeCancelar: true,
        puedeReprogramar: false,
      });

      montarConLimites({ horasLimiteCancelacion: 6, horasLimiteReprogramacion: 2 });
      expect(await servicio.miReserva(resuelta())).toMatchObject({
        puedeCancelar: false,
        puedeReprogramar: true,
      });
    });

    it('justo en el límite todavía puede (el dominio rechaza solo por debajo)', async () => {
      prisma.reserva.findUnique.mockResolvedValue(filaPublica({ inicioEn: enHoras(4) }));
      expect(await servicio.miReserva(resuelta())).toMatchObject({
        puedeCancelar: true,
        puedeReprogramar: true,
      });
    });

    it('una cita que no está viva no se puede cancelar ni reprogramar, aunque sobre tiempo', async () => {
      // EN_CURSO queda fuera: el dominio sí permite EN_CURSO -> CANCELADA (y el plazo lo cubre en la práctica).
      for (const estado of ['COMPLETADA', 'CANCELADA', 'NO_ASISTIO']) {
        prisma.reserva.findUnique.mockResolvedValue(filaPublica({ estado }));
        expect(await servicio.miReserva(resuelta()), estado).toMatchObject({
          puedeCancelar: false,
          puedeReprogramar: false,
        });
      }
    });

    it('si la relectura no encuentra la cita, responde no encontrado', async () => {
      prisma.reserva.findUnique.mockResolvedValue(null);
      await expect(servicio.miReserva(resuelta())).rejects.toMatchObject({
        codigo: CODIGOS_ERROR.RECURSO_NO_ENCONTRADO,
      });
    });
  });

  describe('cancelarPropia', () => {
    const datos = { motivo: 'Me surgió un viaje', tokenTurnstile: 't' };

    it('cancela declarando el origen CLIENTE y sin actor', async () => {
      await servicio.cancelarPropia(resuelta(), datos);
      // Un origen equivocado no da error: solo se salta el plazo del cliente.
      expect(reservas.cancelar).toHaveBeenCalledWith(
        ID.reserva,
        { motivo: 'Me surgió un viaje', notificar: true },
        null,
        'CLIENTE',
      );
    });

    it('no pasa al dominio el token de Turnstile', async () => {
      await servicio.cancelarPropia(resuelta(), datos);
      expect(JSON.stringify(reservas.cancelar.mock.calls[0]![1])).not.toContain('tokenTurnstile');
    });

    it('responde con la cita cancelada, sin token y sin poder gestionarla', async () => {
      prisma.reserva.findUnique.mockResolvedValue(filaPublica({ estado: 'CANCELADA', tokenGestion: null }));
      const respuesta = await servicio.cancelarPropia(resuelta(), datos);
      expect(respuesta).toMatchObject({ estado: 'CANCELADA', puedeCancelar: false, puedeReprogramar: false });
      expect(respuesta).not.toHaveProperty('tokenGestion');
    });

    it('si el dominio rechaza por plazo, el error llega tal cual', async () => {
      const fuera = new ErrorNegocio(CODIGOS_ERROR.FUERA_DE_PLAZO_CANCELACION, 409);
      reservas.cancelar.mockRejectedValue(fuera);
      await expect(servicio.cancelarPropia(resuelta(), datos)).rejects.toBe(fuera);
    });

    it('el ESTADO_RESERVA_INVALIDO del dominio pasa tal cual, con su código y su 409', async () => {
      // Fija que el canal no envuelve ni se traga el error del dominio ni añade un
      // chequeo de estado propio que cortocircuite la segunda llamada. NO cubre la
      // carrera real (con el dominio doblado, esto equivale a dos llamadas
      // seguidas): esa ventana es de `ReservasService.cancelar` y le toca a la
      // prueba de integración con PostgreSQL.
      reservas.cancelar
        .mockResolvedValueOnce({ id: ID.reserva })
        .mockRejectedValueOnce(
          new ErrorNegocio(CODIGOS_ERROR.ESTADO_RESERVA_INVALIDO, 409, { estadoActual: 'CANCELADA' }),
        );
      prisma.reserva.findUnique.mockResolvedValue(filaPublica({ estado: 'CANCELADA', tokenGestion: null }));
      const delGuard = resuelta();

      const [primera, segunda] = await Promise.allSettled([
        servicio.cancelarPropia(delGuard, datos),
        servicio.cancelarPropia(delGuard, datos),
      ]);

      expect(primera.status).toBe('fulfilled');
      expect(segunda.status).toBe('rejected');
      const error = (segunda as PromiseRejectedResult).reason;
      expect(error).toBeInstanceOf(ErrorNegocio);
      expect(error.codigo).toBe(CODIGOS_ERROR.ESTADO_RESERVA_INVALIDO);
      expect(error.getStatus()).toBe(409);
      expect(reservas.cancelar).toHaveBeenCalledTimes(2);
    });
  });

  describe('reprogramarPropia', () => {
    const datos = { inicioEn: '2026-11-07T15:00:00.000Z', barberoId: ID.barbero, tokenTurnstile: 't' };

    beforeEach(() => {
      prisma.usuario.findMany.mockResolvedValue([{ id: ID.barbero }]);
    });

    it('reprograma marcando que viene del cliente, sin actor', async () => {
      await servicio.reprogramarPropia(resuelta(), datos);
      expect(reservas.reprogramar).toHaveBeenCalledWith(
        ID.reserva,
        { inicioEn: '2026-11-07T15:00:00.000Z', barberoId: ID.barbero, notificar: true },
        null,
        true,
      );
    });

    it('rechaza como no encontrado a un barbero que la web no muestra', async () => {
      // Regla del canal: recepción sí puede mover una cita a un barbero oculto en web.
      prisma.usuario.findMany.mockResolvedValue([{ id: ID.actor }]);
      await expect(servicio.reprogramarPropia(resuelta(), datos)).rejects.toMatchObject({
        codigo: CODIGOS_ERROR.RECURSO_NO_ENCONTRADO,
      });
      expect(reservas.reprogramar).not.toHaveBeenCalled();
    });

    it('comprueba la visibilidad contra la sede de la cita', async () => {
      prisma.usuario.findMany.mockResolvedValue([{ id: ID.barbero }]);
      await servicio.reprogramarPropia(resuelta({ sedeId: ID.sede }), datos);
      expect(JSON.stringify(prisma.usuario.findMany.mock.calls[0]![0])).toContain(ID.sede);
      expect(reservas.reprogramar).toHaveBeenCalled();
    });

    it('sin barbero nuevo no consulta la visibilidad', async () => {
      await servicio.reprogramarPropia(resuelta(), { ...datos, barberoId: undefined });
      expect(prisma.usuario.findMany).not.toHaveBeenCalled();
      expect(reservas.reprogramar).toHaveBeenCalled();
    });

    it('el cliente no puede mover la cita de sede ni colar otros campos', async () => {
      await servicio.reprogramarPropia(resuelta(), { ...datos, sedeId: ID.sede, motivo: 'x' } as never);
      expect(Object.keys(reservas.reprogramar.mock.calls[0]![1]).sort()).toEqual(
        ['barberoId', 'inicioEn', 'notificar'].sort(),
      );
    });

    it('devuelve el token nuevo, el de la relectura y no el de la fila del guard', async () => {
      const respuesta = await servicio.reprogramarPropia(resuelta(), datos);
      expect(respuesta.tokenGestion).toBe('tok_relectura');
      expect(respuesta.tokenGestion).not.toBe('tok_guard');
      expect(prisma.reserva.findUnique.mock.calls[0]![0].where).toEqual({ id: ID.reserva });
    });

    it('si falta el token tras reprogramar, es un fallo del servidor con el código de la cita', async () => {
      prisma.reserva.findUnique.mockResolvedValue(filaPublica({ tokenGestion: null }));
      await expect(servicio.reprogramarPropia(resuelta(), datos)).rejects.toThrow(/CDS-A1B2/);
    });

    describe('correo con el enlace nuevo', () => {
      let notificaciones: { encolar: ReturnType<typeof vi.fn> };

      beforeEach(() => {
        notificaciones = { encolar: vi.fn(async () => undefined) };
        montarConLimites({}, notificaciones);
        prisma.cliente.findUnique.mockResolvedValue({
          nombreCompleto: 'Juan Pérez',
          email: 'juan@correo.co',
          aceptaEmail: true,
        });
      });

      it('encola la reprogramación con el token nuevo y la hora nueva', async () => {
        await servicio.reprogramarPropia(resuelta(), datos);
        await vi.waitFor(() => expect(notificaciones.encolar).toHaveBeenCalledOnce());
        expect(notificaciones.encolar).toHaveBeenCalledWith(
          expect.objectContaining({
            reservaId: ID.reserva,
            clienteId: ID.cliente,
            clave: 'reserva.reprogramada',
            canal: 'EMAIL',
            destino: 'juan@correo.co',
            omitirDelPayload: ['enlace'],
            variables: expect.objectContaining({
              codigo: 'CDS-A1B2',
              // El de la relectura: el del guard ya no sirve.
              enlace: 'https://reservas.test/cita#tok_relectura',
              fecha: expect.any(String),
            }),
          }),
        );
        expect(JSON.stringify(notificaciones.encolar.mock.calls)).not.toContain('tok_guard');
      });

      it('no encola sin correo ni consentimiento', async () => {
        prisma.cliente.findUnique.mockResolvedValue({
          nombreCompleto: 'J',
          email: 'juan@correo.co',
          aceptaEmail: false,
        });
        await servicio.reprogramarPropia(resuelta(), datos);
        await vi.waitFor(() => expect(prisma.cliente.findUnique).toHaveBeenCalled());
        await vi.advanceTimersByTimeAsync(0);
        expect(notificaciones.encolar).not.toHaveBeenCalled();
      });

      it('un fallo de notificación no tumba la reprogramación', async () => {
        notificaciones.encolar.mockRejectedValue(new Error('boom'));
        await expect(servicio.reprogramarPropia(resuelta(), datos)).resolves.toMatchObject({
          tokenGestion: 'tok_relectura',
        });
      });

      it('si el dominio rechaza la reprogramación no se encola nada', async () => {
        reservas.reprogramar.mockRejectedValue(new Error('x'));
        await expect(servicio.reprogramarPropia(resuelta(), datos)).rejects.toThrow();
        expect(notificaciones.encolar).not.toHaveBeenCalled();
      });
    });

    it('no filtra la nota interna', async () => {
      const respuesta = await servicio.reprogramarPropia(resuelta(), datos);
      expect(JSON.stringify(respuesta)).not.toMatch(/NOTA INTERNA|tok_guard/);
    });
  });
});
