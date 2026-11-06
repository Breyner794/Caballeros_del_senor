import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { CODIGOS_ERROR, type CrearReservaDto, type CrearWalkInDto } from '@cds/shared';
import { ErrorNegocio } from '../../comun/excepciones/error-negocio.js';
import { ReservasService } from './reservas.service.js';
import { ClientesService } from '../clientes/clientes.service.js';
import {
  AHORA,
  FECHA,
  ID,
  ZONA,
  actorBarbero,
  actorRecepcion,
  configuracion,
  horaLocal,
  lineaServicio,
  programaFidelidad,
  reserva,
  servicio,
  venta,
} from '../../../test/soporte/datos.js';
import {
  crearAuditoriaDoble,
  crearClientesDoble,
  crearConfiguracionDoble,
  crearDisponibilidadDoble,
  crearFidelidadDoble,
  crearPrismaDoble,
  crearVentasDoble,
  type PrismaDoble,
} from '../../../test/soporte/dobles.js';

/**
 * Suite de `ReservasService`.
 *
 * Flujos críticos cubiertos, en orden de riesgo:
 *
 *  1. **Crear** — es donde se decide si dos clientes acaban en la misma silla.
 *     Se comprueba el *orden* de las validaciones, no solo que fallen: si el
 *     cliente nuevo se creara antes de validar el hueco, cada intento fallido
 *     dejaría una ficha basura en la base.
 *  2. **Walk-in** — asigna hueco y turno por su cuenta, y puede cobrar en el
 *     mismo gesto.
 *  3. **Transiciones de estado** — reprogramar, cancelar, iniciar, no asistió.
 *     La máquina de estados es la que impide cobrar dos veces la misma cita.
 *  4. **Completar y cobrar** — toca cinco tablas en una transacción. Aquí el
 *     error caro no es un 500: es un sello sin visita o una comisión calculada
 *     sobre un corte gratis.
 *  5. **Aislamiento por barbero** — un barbero no puede leer la agenda de otro
 *     ni manipulando la petición.
 *
 * Fuera de alcance deliberadamente: la restricción de exclusión
 * `reservas_sin_solape_barbero`, que vive en Postgres y solo se puede ejercitar
 * con una base real. Lo que sí se cubre es que el servicio valide el hueco
 * ANTES de escribir, que es su parte del contrato.
 */

interface Entorno {
  servicio: ReservasService;
  prisma: PrismaDoble;
  configuracion: ReturnType<typeof crearConfiguracionDoble>;
  disponibilidad: ReturnType<typeof crearDisponibilidadDoble>;
  clientes: ReturnType<typeof crearClientesDoble>;
  fidelidad: ReturnType<typeof crearFidelidadDoble>;
  ventas: ReturnType<typeof crearVentasDoble>;
  auditoria: ReturnType<typeof crearAuditoriaDoble>;
}

function montar(
  cambiosConfig: Record<string, unknown> = {},
  cambiosFidelidad: Record<string, unknown> = {},
): Entorno {
  const prisma = crearPrismaDoble();
  const config = crearConfiguracionDoble(
    configuracion(cambiosConfig),
    programaFidelidad(cambiosFidelidad),
  );
  const disponibilidad = crearDisponibilidadDoble();
  const clientes = crearClientesDoble();
  const fidelidad = crearFidelidadDoble();
  const ventas = crearVentasDoble();
  const auditoria = crearAuditoriaDoble();

  const instancia = new ReservasService(
    prisma as never,
    auditoria as never,
    config as never,
    disponibilidad as never,
    clientes as never,
    fidelidad as never,
    ventas as never,
  );

  return {
    servicio: instancia,
    prisma,
    configuracion: config,
    disponibilidad,
    clientes,
    fidelidad,
    ventas,
    auditoria,
  };
}

/** Barbero válido y habilitado en la sede principal. */
function barberoValido(prisma: PrismaDoble, sedes: string[] = [ID.sede]): void {
  prisma.usuario.findFirst.mockResolvedValue({
    id: ID.barbero,
    sedeId: sedes[0] ?? null,
    sedesPermitidas: sedes.slice(1).map((sedeId) => ({ sedeId })),
  });
}

const datosCrear = (cambios: Partial<CrearReservaDto> = {}): CrearReservaDto =>
  ({
    sedeId: ID.sede,
    barberoId: ID.barbero,
    clienteId: ID.cliente,
    servicioIds: [ID.servicioCorte],
    inicioEn: horaLocal(600, '2026-03-11').toISOString(),
    descuento: 0,
    aplicarPremioFidelidad: false,
    confirmar: true,
    ...cambios,
  }) as CrearReservaDto;

const datosWalkIn = (cambios: Partial<CrearWalkInDto> = {}): CrearWalkInDto =>
  ({
    sedeId: ID.sede,
    barberoId: ID.barbero,
    clienteId: ID.cliente,
    servicioIds: [ID.servicioCorte],
    descuento: 0,
    aplicarPremioFidelidad: false,
    completarYCobrar: false,
    metodoPago: 'EFECTIVO',
    ...cambios,
  }) as CrearWalkInDto;

/** Ejecuta la operación y devuelve el `ErrorNegocio` que lanzó. */
async function capturar(accion: () => Promise<unknown>): Promise<ErrorNegocio> {
  try {
    await accion();
  } catch (error) {
    if (error instanceof ErrorNegocio) return error;
    throw error;
  }
  throw new Error('Se esperaba un ErrorNegocio, pero la operación terminó sin fallar');
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================================
//  CREAR
// ============================================================================

describe('ReservasService.crear', () => {
  function prepararCreacionFeliz(entorno: Entorno, servicios = [servicio()]): void {
    barberoValido(entorno.prisma);
    entorno.prisma.servicio.findMany.mockResolvedValue(servicios);
    entorno.prisma.cliente.findFirst.mockResolvedValue({ id: ID.cliente });
    entorno.prisma.reserva.create.mockResolvedValue({
      id: ID.reserva,
      codigo: 'CDS-A1B2',
      estado: 'CONFIRMADA',
    });
    entorno.prisma.reserva.findUnique.mockResolvedValue(reserva());
  }

  it('crea una cita confirmada desde el panel y devuelve la reserva completa', async () => {
    const entorno = montar();
    prepararCreacionFeliz(entorno);

    const resultado = await entorno.servicio.crear(datosCrear(), actorRecepcion());

    expect(resultado.codigo).toBe('CDS-A1B2');

    const escritura = entorno.prisma.reserva.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(escritura.data).toMatchObject({
      estado: 'CONFIRMADA',
      canal: 'PANEL',
      clienteId: ID.cliente,
      sedeId: ID.sede,
      barberoId: ID.barbero,
      creadoPorId: ID.actor,
      duracionMinutos: 30,
    });
    expect(escritura.data['confirmadaEn']).toBeInstanceOf(Date);
    expect(entorno.auditoria.registrar).toHaveBeenCalledTimes(1);
  });

  it('un interbloqueo al escribir (la carrera por el mismo hueco) se traduce a RESERVA_SOLAPADA', async () => {
    const entorno = montar();
    prepararCreacionFeliz(entorno);
    entorno.prisma.reserva.create.mockRejectedValue(
      new Prisma.PrismaClientUnknownRequestError('PostgresError { code: "40P01", message: "deadlock detected" }', {
        clientVersion: 'test',
      }),
    );

    await expect(entorno.servicio.crear(datosCrear(), actorRecepcion())).rejects.toMatchObject({
      codigo: CODIGOS_ERROR.RESERVA_SOLAPADA,
      status: 409,
    });
  });

  it('calcula fin, fin con buffer, subtotal y total a partir de los servicios', async () => {
    const entorno = montar();
    prepararCreacionFeliz(entorno, [
      servicio({ duracionMinutos: 30, precio: new Prisma.Decimal(30000), bufferMinutos: 10 }),
      servicio({
        id: ID.servicioBarba,
        nombre: 'Barba',
        duracionMinutos: 20,
        precio: new Prisma.Decimal(15000),
        bufferMinutos: null,
      }),
    ]);

    await entorno.servicio.crear(
      datosCrear({ servicioIds: [ID.servicioCorte, ID.servicioBarba], descuento: 5000 }),
      actorRecepcion(),
    );

    const { data } = entorno.prisma.reserva.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    const inicio = horaLocal(600, '2026-03-11');

    expect(data['duracionMinutos']).toBe(50);
    // El tiempo de limpieza se cuenta una vez, y es el mayor de los servicios.
    expect(data['bufferMinutos']).toBe(10);
    expect(data['finEn']).toEqual(new Date(inicio.getTime() + 50 * 60_000));
    expect(data['finConBufferEn']).toEqual(new Date(inicio.getTime() + 60 * 60_000));
    expect(String(data['subtotal'])).toBe('45000');
    expect(String(data['total'])).toBe('40000');
  });

  it('respeta el orden en que la recepción eligió los servicios', async () => {
    const entorno = montar();
    // Prisma devuelve las filas en el orden que quiera; el orden lo manda la
    // petición, porque es el orden en que se van a hacer los servicios.
    prepararCreacionFeliz(entorno, [
      servicio({ id: ID.servicioBarba, nombre: 'Barba', duracionMinutos: 20 }),
      servicio(),
    ]);

    await entorno.servicio.crear(
      datosCrear({ servicioIds: [ID.servicioCorte, ID.servicioBarba] }),
      actorRecepcion(),
    );

    const { data } = entorno.prisma.reserva.create.mock.calls[0]![0] as {
      data: { servicios: { create: { nombreSnapshot: string; orden: number }[] } };
    };
    expect(data.servicios.create.map((s) => [s.orden, s.nombreSnapshot])).toEqual([
      [0, 'Corte clásico'],
      [1, 'Barba'],
    ]);
  });

  /**
   * Antes esta prueba afirmaba que el total nunca era negativo y pasaba en
   * verde: el `Decimal.max(0, …)` acotaba el total, pero el `descuento` se
   * guardaba tal cual. Contra Postgres de verdad, el CHECK
   * `reservas_importes_no_negativos` (que exige `descuento <= subtotal`)
   * rechazaba ese `INSERT` y la recepción veía un 500. Con dobles la
   * restricción no existe, así que el agujero solo se vio al escribir la suite
   * de integración.
   */
  it('rechaza un descuento mayor que el importe de la cita', async () => {
    const entorno = montar();
    prepararCreacionFeliz(entorno);

    const error = await capturar(() =>
      entorno.servicio.crear(datosCrear({ descuento: 90000 }), actorRecepcion()),
    );

    expect(error.codigo).toBe(CODIGOS_ERROR.VALIDACION);
    expect(error.getStatus()).toBe(422);
    expect(error.campos?.['descuento']?.[0]).toContain('30.000');
    expect(entorno.prisma.reserva.create).not.toHaveBeenCalled();
  });

  it('acepta el descuento que iguala al importe: la cita queda en cero', async () => {
    const entorno = montar();
    prepararCreacionFeliz(entorno);

    await entorno.servicio.crear(datosCrear({ descuento: 30000 }), actorRecepcion());

    const { data } = entorno.prisma.reserva.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(String(data['descuento'])).toBe('30000');
    expect(String(data['total'])).toBe('0');
  });

  it('valida el descuento contra el subtotal real, no contra un servicio suelto', async () => {
    const entorno = montar();
    prepararCreacionFeliz(entorno, [
      servicio({ precio: new Prisma.Decimal(30000) }),
      servicio({ id: ID.servicioBarba, nombre: 'Barba', precio: new Prisma.Decimal(15000) }),
    ]);

    // 40 000 pasa del precio del corte, pero no de los dos servicios juntos.
    await expect(
      entorno.servicio.crear(
        datosCrear({ servicioIds: [ID.servicioCorte, ID.servicioBarba], descuento: 40000 }),
        actorRecepcion(),
      ),
    ).resolves.toBeTruthy();
  });

  it('rechaza el descuento imposible también en el walk-in', async () => {
    const entorno = montar();
    barberoValido(entorno.prisma);
    entorno.prisma.servicio.findMany.mockResolvedValue([servicio()]);

    const error = await capturar(() =>
      entorno.servicio.crearWalkIn(datosWalkIn({ descuento: 90000 }), actorRecepcion()),
    );

    expect(error.codigo).toBe(CODIGOS_ERROR.VALIDACION);
    // Falla antes de buscar hueco: no se gasta una consulta de agenda en una
    // cita que no se va a poder guardar.
    expect(entorno.disponibilidad.primerHuecoLibre).not.toHaveBeenCalled();
  });

  it('deja la cita PENDIENTE cuando el panel no la confirma', async () => {
    const entorno = montar();
    prepararCreacionFeliz(entorno);

    await entorno.servicio.crear(datosCrear({ confirmar: false }), actorRecepcion());

    const { data } = entorno.prisma.reserva.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(data['estado']).toBe('PENDIENTE');
    expect(data['confirmadaEn']).toBeUndefined();
  });

  describe('desde la web', () => {
    it('marca canal WEB, no atribuye autoría y aplica las reglas del cliente', async () => {
      const entorno = montar({ requiereConfirmacion: false });
      prepararCreacionFeliz(entorno);
      entorno.prisma.reserva.count.mockResolvedValue(0);

      await entorno.servicio.crear(datosCrear(), actorRecepcion(), true);

      const { data } = entorno.prisma.reserva.create.mock.calls[0]![0] as {
        data: Record<string, unknown>;
      };
      expect(data['canal']).toBe('WEB');
      expect(data['creadoPorId']).toBeNull();
      expect(data['estado']).toBe('CONFIRMADA');
      expect(entorno.disponibilidad.validarHueco).toHaveBeenCalledWith(
        expect.objectContaining({ aplicarReglasCliente: true }),
      );
    });

    it('deja la cita PENDIENTE si el negocio exige confirmar las de la web', async () => {
      const entorno = montar({ requiereConfirmacion: true });
      prepararCreacionFeliz(entorno);
      entorno.prisma.reserva.count.mockResolvedValue(0);

      // `confirmar: true` viene del DTO, pero desde la web no manda el cliente.
      await entorno.servicio.crear(datosCrear({ confirmar: true }), actorRecepcion(), true);

      const { data } = entorno.prisma.reserva.create.mock.calls[0]![0] as {
        data: Record<string, unknown>;
      };
      expect(data['estado']).toBe('PENDIENTE');
    });

    it('rechaza al cliente que ya alcanzó el máximo de reservas activas', async () => {
      const entorno = montar({ maxReservasActivasCliente: 2 });
      prepararCreacionFeliz(entorno);
      entorno.prisma.reserva.count.mockResolvedValue(2);

      const error = await capturar(() =>
        entorno.servicio.crear(datosCrear(), actorRecepcion(), true),
      );

      expect(error.codigo).toBe(CODIGOS_ERROR.LIMITE_RESERVAS_ACTIVAS);
      expect(error.getStatus()).toBe(409);
      expect(error.detalle).toEqual({ activas: 2, maximo: 2 });
      expect(entorno.prisma.reserva.create).not.toHaveBeenCalled();
    });

    it('cuenta solo las citas futuras y vivas para ese límite', async () => {
      const entorno = montar();
      prepararCreacionFeliz(entorno);
      entorno.prisma.reserva.count.mockResolvedValue(0);

      await entorno.servicio.crear(datosCrear(), actorRecepcion(), true);

      expect(entorno.prisma.reserva.count).toHaveBeenCalledWith({
        where: {
          clienteId: ID.cliente,
          estado: { in: ['PENDIENTE', 'CONFIRMADA'] },
          inicioEn: { gte: AHORA },
        },
      });
    });
  });

  it('la recepción puede saltarse el límite de reservas activas', async () => {
    const entorno = montar({ maxReservasActivasCliente: 1 });
    prepararCreacionFeliz(entorno);

    await entorno.servicio.crear(datosCrear(), actorRecepcion());

    // Ni se consulta: el cliente está delante y la recepción sabe lo que hace.
    expect(entorno.prisma.reserva.count).not.toHaveBeenCalled();
    expect(entorno.prisma.reserva.create).toHaveBeenCalled();
  });

  // --- Errores de validación ---------------------------------------------

  it('falla si el barbero no existe o está inactivo', async () => {
    const entorno = montar();
    entorno.prisma.usuario.findFirst.mockResolvedValue(null);

    const error = await capturar(() => entorno.servicio.crear(datosCrear(), actorRecepcion()));

    expect(error.codigo).toBe(CODIGOS_ERROR.RECURSO_NO_ENCONTRADO);
    expect(error.getStatus()).toBe(404);
    expect(error.mensaje).toContain('barbero');
  });

  it('falla si el barbero no está habilitado en esa sede', async () => {
    const entorno = montar();
    barberoValido(entorno.prisma, [ID.sedeAlterna]);

    const error = await capturar(() => entorno.servicio.crear(datosCrear(), actorRecepcion()));

    expect(error.codigo).toBe(CODIGOS_ERROR.BARBERO_NO_PERTENECE_A_SEDE);
    expect(error.getStatus()).toBe(409);
    expect(entorno.prisma.reserva.create).not.toHaveBeenCalled();
  });

  it('acepta al barbero habilitado por sede secundaria', async () => {
    const entorno = montar();
    prepararCreacionFeliz(entorno);
    entorno.prisma.usuario.findFirst.mockResolvedValue({
      id: ID.barbero,
      sedeId: ID.sedeAlterna,
      sedesPermitidas: [{ sedeId: ID.sede }],
    });

    await expect(entorno.servicio.crear(datosCrear(), actorRecepcion())).resolves.toBeTruthy();
  });

  it('falla sin servicios', async () => {
    const entorno = montar();
    barberoValido(entorno.prisma);

    const error = await capturar(() =>
      entorno.servicio.crear(datosCrear({ servicioIds: [] }), actorRecepcion()),
    );

    expect(error.codigo).toBe(CODIGOS_ERROR.SIN_SERVICIOS);
    expect(error.getStatus()).toBe(400);
  });

  it('falla si alguno de los servicios no existe o está desactivado', async () => {
    const entorno = montar();
    barberoValido(entorno.prisma);
    // Se piden dos y solo uno está activo.
    entorno.prisma.servicio.findMany.mockResolvedValue([servicio()]);

    const error = await capturar(() =>
      entorno.servicio.crear(
        datosCrear({ servicioIds: [ID.servicioCorte, ID.servicioInactivo] }),
        actorRecepcion(),
      ),
    );

    expect(error.codigo).toBe(CODIGOS_ERROR.RECURSO_NO_ENCONTRADO);
    expect(error.mensaje).toContain('desactivado');
  });

  it('solo busca servicios activos y no eliminados', async () => {
    const entorno = montar();
    prepararCreacionFeliz(entorno);

    await entorno.servicio.crear(datosCrear(), actorRecepcion());

    expect(entorno.prisma.servicio.findMany).toHaveBeenCalledWith({
      where: { id: { in: [ID.servicioCorte] }, eliminadoEn: null, activo: true },
    });
  });

  it('propaga el conflicto de hueco ocupado sin escribir nada', async () => {
    const entorno = montar();
    barberoValido(entorno.prisma);
    entorno.prisma.servicio.findMany.mockResolvedValue([servicio()]);
    entorno.disponibilidad.validarHueco.mockRejectedValue(
      ErrorNegocio.conflicto(CODIGOS_ERROR.RESERVA_SOLAPADA),
    );

    const error = await capturar(() => entorno.servicio.crear(datosCrear(), actorRecepcion()));

    expect(error.codigo).toBe(CODIGOS_ERROR.RESERVA_SOLAPADA);
    expect(entorno.prisma.$transaction).not.toHaveBeenCalled();
    expect(entorno.auditoria.registrar).not.toHaveBeenCalled();
  });

  it('valida el hueco antes de crear la ficha del cliente nuevo', async () => {
    const entorno = montar();
    barberoValido(entorno.prisma);
    entorno.prisma.servicio.findMany.mockResolvedValue([servicio()]);
    entorno.disponibilidad.validarHueco.mockRejectedValue(
      ErrorNegocio.conflicto(CODIGOS_ERROR.RESERVA_SOLAPADA),
    );

    await capturar(() =>
      entorno.servicio.crear(
        datosCrear({
          clienteId: undefined,
          clienteNuevo: { nombreCompleto: 'Nuevo Cliente', telefono: '+573009998877' },
        }),
        actorRecepcion(),
      ),
    );

    // Si este orden se invirtiera, cada intento fallido dejaría una ficha
    // huérfana en la base de clientes.
    expect(entorno.clientes.crear).not.toHaveBeenCalled();
  });

  describe('resolución del cliente', () => {
    it('falla si el clienteId indicado no existe o está eliminado', async () => {
      const entorno = montar();
      barberoValido(entorno.prisma);
      entorno.prisma.servicio.findMany.mockResolvedValue([servicio()]);
      entorno.prisma.cliente.findFirst.mockResolvedValue(null);

      const error = await capturar(() => entorno.servicio.crear(datosCrear(), actorRecepcion()));

      expect(error.codigo).toBe(CODIGOS_ERROR.RECURSO_NO_ENCONTRADO);
      expect(error.mensaje).toContain('cliente');
    });

    it('crea la ficha al vuelo cuando el teléfono es nuevo', async () => {
      const entorno = montar();
      barberoValido(entorno.prisma);
      entorno.prisma.servicio.findMany.mockResolvedValue([servicio()]);
      entorno.prisma.cliente.findUnique.mockResolvedValue(null);
      entorno.clientes.crear.mockResolvedValue({ id: 'cliente-nuevo' });
      entorno.prisma.reserva.create.mockResolvedValue({
        id: ID.reserva,
        codigo: 'CDS-A1B2',
        estado: 'CONFIRMADA',
      });
      entorno.prisma.reserva.findUnique.mockResolvedValue(reserva());

      await entorno.servicio.crear(
        datosCrear({
          clienteId: undefined,
          clienteNuevo: { nombreCompleto: 'Nuevo Cliente', telefono: '+573009998877' },
        }),
        actorRecepcion(),
      );

      expect(entorno.clientes.crear).toHaveBeenCalledWith(
        expect.objectContaining({ nombreCompleto: 'Nuevo Cliente', telefono: '+573009998877' }),
        expect.objectContaining({ id: ID.actor }),
      );
      const { data } = entorno.prisma.reserva.create.mock.calls[0]![0] as {
        data: Record<string, unknown>;
      };
      expect(data['clienteId']).toBe('cliente-nuevo');
    });

    it('reutiliza la ficha existente si el teléfono ya estaba registrado', async () => {
      const entorno = montar();
      barberoValido(entorno.prisma);
      entorno.prisma.servicio.findMany.mockResolvedValue([servicio()]);
      entorno.prisma.cliente.findUnique.mockResolvedValue({
        id: ID.cliente,
        eliminadoEn: null,
      });
      entorno.prisma.reserva.create.mockResolvedValue({
        id: ID.reserva,
        codigo: 'CDS-A1B2',
        estado: 'CONFIRMADA',
      });
      entorno.prisma.reserva.findUnique.mockResolvedValue(reserva());

      await entorno.servicio.crear(
        datosCrear({
          clienteId: undefined,
          clienteNuevo: { nombreCompleto: 'Juan P', telefono: '+573001234567' },
        }),
        actorRecepcion(),
      );

      // No se duplica la ficha: es el mismo cliente escrito dos veces.
      expect(entorno.clientes.crear).not.toHaveBeenCalled();
      const { data } = entorno.prisma.reserva.create.mock.calls[0]![0] as {
        data: Record<string, unknown>;
      };
      expect(data['clienteId']).toBe(ID.cliente);
    });

    it('vuelve a crear la ficha si la existente estaba eliminada', async () => {
      const entorno = montar();
      barberoValido(entorno.prisma);
      entorno.prisma.servicio.findMany.mockResolvedValue([servicio()]);
      entorno.prisma.cliente.findUnique.mockResolvedValue({
        id: ID.cliente,
        eliminadoEn: new Date('2025-01-01T00:00:00Z'),
      });
      entorno.clientes.crear.mockResolvedValue({ id: 'cliente-rehecho' });
      entorno.prisma.reserva.create.mockResolvedValue({
        id: ID.reserva,
        codigo: 'CDS-A1B2',
        estado: 'CONFIRMADA',
      });
      entorno.prisma.reserva.findUnique.mockResolvedValue(reserva());

      await entorno.servicio.crear(
        datosCrear({
          clienteId: undefined,
          clienteNuevo: { nombreCompleto: 'Juan P', telefono: '+573001234567' },
        }),
        actorRecepcion(),
      );

      expect(entorno.clientes.crear).toHaveBeenCalled();
    });

    it('acepta la cita sin ficha de cliente (anónima)', async () => {
      const entorno = montar();
      barberoValido(entorno.prisma);
      entorno.prisma.servicio.findMany.mockResolvedValue([servicio()]);
      entorno.prisma.reserva.create.mockResolvedValue({
        id: ID.reserva,
        codigo: 'CDS-A1B2',
        estado: 'CONFIRMADA',
      });
      entorno.prisma.reserva.findUnique.mockResolvedValue(
        reserva({ cliente: null, clienteId: null }),
      );

      await entorno.servicio.crear(datosCrear({ clienteId: undefined }), actorRecepcion());

      const { data } = entorno.prisma.reserva.create.mock.calls[0]![0] as {
        data: Record<string, unknown>;
      };
      expect(data['clienteId']).toBeNull();
      // Y queda constancia de que nadie apuntó al cliente.
      expect(entorno.auditoria.registrar).toHaveBeenCalledWith(
        expect.objectContaining({ resumen: expect.stringContaining('cliente sin ficha') }),
      );
    });
  });
});

// ============================================================================
//  WALK-IN
// ============================================================================

describe('ReservasService.crearWalkIn', () => {
  function prepararWalkIn(entorno: Entorno): void {
    barberoValido(entorno.prisma);
    entorno.prisma.servicio.findMany.mockResolvedValue([servicio()]);
    entorno.prisma.reserva.aggregate.mockResolvedValue({ _max: { turnoWalkIn: null } });
    entorno.prisma.reserva.create.mockResolvedValue({
      id: ID.reserva,
      codigo: 'CDS-W001',
      estado: 'CONFIRMADA',
    });
    entorno.prisma.cliente.findUnique.mockResolvedValue({
      esGenerico: false,
      nombreCompleto: 'Juan Pérez',
    });
    entorno.prisma.cliente.findFirst.mockResolvedValue({ id: ID.cliente });
    entorno.clientes.clienteGenerico.mockResolvedValue({ id: ID.clienteGenerico });
    entorno.prisma.reserva.findUnique.mockResolvedValue(
      reserva({ canal: 'WALK_IN', turnoWalkIn: 1 }),
    );
    entorno.disponibilidad.primerHuecoLibre.mockResolvedValue({
      inicioEn: horaLocal(540),
      hora: '09:00',
    });
  }

  it('busca el primer hueco libre, confirma la cita y asigna el turno 1', async () => {
    const entorno = montar();
    prepararWalkIn(entorno);

    await entorno.servicio.crearWalkIn(datosWalkIn(), actorRecepcion());

    expect(entorno.disponibilidad.primerHuecoLibre).toHaveBeenCalledWith({
      sedeId: ID.sede,
      barberoId: ID.barbero,
      servicioIds: [ID.servicioCorte],
    });
    const { data } = entorno.prisma.reserva.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(data).toMatchObject({ estado: 'CONFIRMADA', canal: 'WALK_IN', turnoWalkIn: 1 });
    expect(data['inicioEn']).toEqual(horaLocal(540));
  });

  it('continúa la numeración de turnos del día', async () => {
    const entorno = montar();
    prepararWalkIn(entorno);
    entorno.prisma.reserva.aggregate.mockResolvedValue({ _max: { turnoWalkIn: 4 } });

    await entorno.servicio.crearWalkIn(datosWalkIn(), actorRecepcion());

    const { data } = entorno.prisma.reserva.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(data['turnoWalkIn']).toBe(5);
    // El turno es del día y del barbero, no global.
    expect(entorno.prisma.reserva.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ barberoId: ID.barbero, canal: 'WALK_IN' }),
        _max: { turnoWalkIn: true },
      }),
    );
  });

  it('respeta la hora concreta que indique la recepción y valida ese hueco', async () => {
    const entorno = montar();
    prepararWalkIn(entorno);
    const inicio = horaLocal(660).toISOString();

    await entorno.servicio.crearWalkIn(datosWalkIn({ inicioEn: inicio }), actorRecepcion());

    expect(entorno.disponibilidad.primerHuecoLibre).not.toHaveBeenCalled();
    expect(entorno.disponibilidad.validarHueco).toHaveBeenCalledWith(
      expect.objectContaining({ inicioEn: new Date(inicio) }),
    );
  });

  it('explica por qué no pudo asignar hueco en lugar de fallar en seco', async () => {
    const entorno = montar();
    prepararWalkIn(entorno);
    entorno.disponibilidad.primerHuecoLibre.mockResolvedValue({
      motivo: 'Su agenda está completa.',
    });

    const error = await capturar(() =>
      entorno.servicio.crearWalkIn(datosWalkIn(), actorRecepcion()),
    );

    expect(error.codigo).toBe(CODIGOS_ERROR.RESERVA_SOLAPADA);
    expect(error.getStatus()).toBe(409);
    expect(error.detalle).toEqual({ motivo: 'Su agenda está completa.' });
    expect(error.mensaje).toContain('Su agenda está completa.');
    expect(entorno.prisma.reserva.create).not.toHaveBeenCalled();
  });

  it('usa el cliente genérico cuando el barbero no registra al cliente', async () => {
    const entorno = montar();
    prepararWalkIn(entorno);
    entorno.clientes.clienteGenerico.mockResolvedValue({ id: ID.clienteGenerico });
    entorno.prisma.cliente.findUnique.mockResolvedValue({
      esGenerico: true,
      nombreCompleto: 'Consumidor final',
    });

    await entorno.servicio.crearWalkIn(datosWalkIn({ clienteId: undefined }), actorRecepcion());

    const { data } = entorno.prisma.reserva.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(data['clienteId']).toBe(ID.clienteGenerico);
    // La auditoría tiene que dejarlo explícito: es la trazabilidad que pidió el
    // negocio para cuando el cliente reclame sus sellos.
    expect(entorno.auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        resumen: expect.stringContaining('SIN ficha de cliente'),
      }),
    );
  });

  it('cobra en el mismo gesto cuando se pide completar y cobrar', async () => {
    const entorno = montar();
    prepararWalkIn(entorno);
    entorno.prisma.reserva.findUnique.mockResolvedValue(
      reserva({ canal: 'WALK_IN', inicioEn: horaLocal(540), finEn: horaLocal(570) }),
    );
    entorno.prisma.reserva.update.mockResolvedValue(reserva({ estado: 'COMPLETADA' }));
    entorno.prisma.reservaServicio.findMany.mockResolvedValue([
      { ...lineaServicio(), servicio: { canjeableFidelidad: true, cuentaFidelidad: true } },
    ]);
    entorno.ventas.registrarDesdeReserva.mockResolvedValue(venta());

    await entorno.servicio.crearWalkIn(
      datosWalkIn({ completarYCobrar: true, metodoPago: 'TARJETA' }),
      actorRecepcion(),
    );

    expect(entorno.ventas.registrarDesdeReserva).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ metodoPago: 'TARJETA', productos: [] }),
    );
  });
});

// ============================================================================
//  CONSULTAS Y AISLAMIENTO POR BARBERO
// ============================================================================

describe('ReservasService: consultas', () => {
  it('obtener devuelve 404 cuando la reserva no existe', async () => {
    const entorno = montar();
    entorno.prisma.reserva.findUnique.mockResolvedValue(null);

    const error = await capturar(() => entorno.servicio.obtener(ID.reserva));

    expect(error.codigo).toBe(CODIGOS_ERROR.RECURSO_NO_ENCONTRADO);
    expect(error.getStatus()).toBe(404);
  });

  it('porCodigo normaliza el código a mayúsculas', async () => {
    const entorno = montar();
    entorno.prisma.reserva.findUnique.mockResolvedValue(reserva());

    await entorno.servicio.porCodigo('cds-a1b2');

    expect(entorno.prisma.reserva.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { codigo: 'CDS-A1B2' } }),
    );
  });

  it('porCodigo devuelve 404 con un código inexistente', async () => {
    const entorno = montar();
    entorno.prisma.reserva.findUnique.mockResolvedValue(null);

    const error = await capturar(() => entorno.servicio.porCodigo('CDS-ZZZZ'));

    expect(error.codigo).toBe(CODIGOS_ERROR.RECURSO_NO_ENCONTRADO);
  });

  describe('listar', () => {
    function prepararListado(entorno: Entorno, filas = [reserva()], total = 1): void {
      entorno.prisma.reserva.findMany.mockResolvedValue(filas);
      entorno.prisma.reserva.count.mockResolvedValue(total);
    }

    const filtrosBase = { pagina: 1, limite: 20, orden: 'desc' as const };

    it('devuelve datos y metadatos de paginación', async () => {
      const entorno = montar();
      prepararListado(entorno, [reserva()], 45);

      const resultado = await entorno.servicio.listar(
        { ...filtrosBase, pagina: 2, limite: 20 },
        actorRecepcion(),
      );

      expect(resultado.meta).toEqual({
        pagina: 2,
        limite: 20,
        total: 45,
        totalPaginas: 3,
        hayAnterior: true,
        haySiguiente: true,
      });
      expect(entorno.prisma.reserva.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 20, orderBy: { inicioEn: 'desc' } }),
      );
    });

    it('fuerza el filtro a la propia agenda del barbero sin permiso ampliado', async () => {
      const entorno = montar();
      prepararListado(entorno);

      // El barbero manipula la petición pidiendo la agenda de otro.
      await entorno.servicio.listar({ ...filtrosBase, barberoId: ID.barberoAjeno }, actorBarbero());

      const { where } = entorno.prisma.reserva.findMany.mock.calls[0]![0] as {
        where: Record<string, unknown>;
      };
      expect(where['barberoId']).toBe(ID.barbero);
    });

    it('respeta el barberoId pedido cuando hay permiso de ver todas', async () => {
      const entorno = montar();
      prepararListado(entorno);

      await entorno.servicio.listar(
        { ...filtrosBase, barberoId: ID.barberoAjeno },
        actorRecepcion(),
      );

      const { where } = entorno.prisma.reserva.findMany.mock.calls[0]![0] as {
        where: Record<string, unknown>;
      };
      expect(where['barberoId']).toBe(ID.barberoAjeno);
    });

    it('acota al día de hoy con soloHoy', async () => {
      const entorno = montar();
      prepararListado(entorno);

      await entorno.servicio.listar({ ...filtrosBase, soloHoy: true }, actorRecepcion());

      const { where } = entorno.prisma.reserva.findMany.mock.calls[0]![0] as {
        where: { inicioEn: { gte: Date; lt: Date } };
      };
      expect(where.inicioEn.gte).toEqual(horaLocal(0, FECHA));
      expect(where.inicioEn.lt).toEqual(horaLocal(0, '2026-03-11'));
    });

    it('traduce el rango desde/hasta a límites de día local', async () => {
      const entorno = montar();
      prepararListado(entorno);

      await entorno.servicio.listar(
        { ...filtrosBase, desde: '2026-03-10', hasta: '2026-03-12' },
        actorRecepcion(),
      );

      const { where } = entorno.prisma.reserva.findMany.mock.calls[0]![0] as {
        where: { inicioEn: { gte: Date; lt: Date } };
      };
      expect(where.inicioEn.gte).toEqual(horaLocal(0, '2026-03-10'));
      // Exclusivo: el día 12 entero entra, el 13 no.
      expect(where.inicioEn.lt).toEqual(horaLocal(0, '2026-03-13'));
    });

    it('busca por código en mayúsculas, por nombre y por teléfono en dígitos', async () => {
      const entorno = montar();
      prepararListado(entorno);

      await entorno.servicio.listar({ ...filtrosBase, buscar: '300 123 4567' }, actorRecepcion());

      const { where } = entorno.prisma.reserva.findMany.mock.calls[0]![0] as {
        where: { OR: Record<string, unknown>[] };
      };
      expect(where.OR).toEqual([
        { codigo: { contains: '300 123 4567' } },
        { cliente: { nombreCompleto: { contains: '300 123 4567', mode: 'insensitive' } } },
        { cliente: { telefono: { contains: '3001234567' } } },
      ]);
    });

    it('filtra por lista de estados cuando se envía', async () => {
      const entorno = montar();
      prepararListado(entorno);

      await entorno.servicio.listar(
        { ...filtrosBase, estados: ['PENDIENTE', 'CONFIRMADA'] },
        actorRecepcion(),
      );

      const { where } = entorno.prisma.reserva.findMany.mock.calls[0]![0] as {
        where: Record<string, unknown>;
      };
      expect(where['estado']).toEqual({ in: ['PENDIENTE', 'CONFIRMADA'] });
    });
  });

  describe('agendaDelDia', () => {
    it('resume el día por estado y suma ingresos solo de lo cobrado', async () => {
      const entorno = montar();
      entorno.prisma.reserva.findMany.mockResolvedValue([
        reserva({ estado: 'PENDIENTE', total: new Prisma.Decimal(30000) }),
        reserva({ estado: 'CONFIRMADA', total: new Prisma.Decimal(30000) }),
        reserva({ estado: 'EN_CURSO', total: new Prisma.Decimal(30000) }),
        reserva({ estado: 'COMPLETADA', total: new Prisma.Decimal(30000) }),
        reserva({ estado: 'COMPLETADA', total: new Prisma.Decimal(20000), canal: 'WALK_IN' }),
        reserva({ estado: 'NO_ASISTIO', total: new Prisma.Decimal(30000) }),
      ]);

      const resultado = await entorno.servicio.agendaDelDia({}, actorRecepcion());

      expect(resultado.fecha).toBe(FECHA);
      expect(resultado.resumen).toEqual({
        total: 6,
        pendientes: 1,
        confirmadas: 1,
        enCurso: 1,
        completadas: 2,
        noAsistio: 1,
        walkIns: 1,
        ingresos: 50000,
      });
    });

    it('excluye las canceladas de la agenda del día', async () => {
      const entorno = montar();
      entorno.prisma.reserva.findMany.mockResolvedValue([]);

      await entorno.servicio.agendaDelDia({}, actorRecepcion());

      const { where } = entorno.prisma.reserva.findMany.mock.calls[0]![0] as {
        where: Record<string, unknown>;
      };
      expect(where['estado']).toEqual({ notIn: ['CANCELADA'] });
    });

    it('un barbero sin permiso ampliado solo ve su propia agenda', async () => {
      const entorno = montar();
      entorno.prisma.reserva.findMany.mockResolvedValue([]);

      await entorno.servicio.agendaDelDia({ barberoId: ID.barberoAjeno }, actorBarbero());

      const { where } = entorno.prisma.reserva.findMany.mock.calls[0]![0] as {
        where: Record<string, unknown>;
      };
      expect(where['barberoId']).toBe(ID.barbero);
    });
  });
});

// ============================================================================
//  REPROGRAMAR
// ============================================================================

describe('ReservasService.reprogramar', () => {
  const nuevaHora = horaLocal(720, '2026-03-12');

  function prepararReprogramacion(entorno: Entorno, actual = reserva()): void {
    entorno.prisma.reserva.findUnique.mockResolvedValue(actual);
    barberoValido(entorno.prisma);
    entorno.prisma.reserva.update.mockResolvedValue(reserva({ inicioEn: nuevaHora }));
  }

  it('mueve la cita y recalcula fin y fin con buffer conservando la duración', async () => {
    const entorno = montar();
    prepararReprogramacion(entorno, reserva({ duracionMinutos: 45, bufferMinutos: 10 }));

    await entorno.servicio.reprogramar(
      ID.reserva,
      { inicioEn: nuevaHora.toISOString(), notificar: true },
      actorRecepcion(),
    );

    expect(entorno.prisma.reserva.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ID.reserva },
        data: {
          sedeId: ID.sede,
          barberoId: ID.barbero,
          inicioEn: nuevaHora,
          finEn: new Date(nuevaHora.getTime() + 45 * 60_000),
          finConBufferEn: new Date(nuevaHora.getTime() + 55 * 60_000),
        },
      }),
    );
  });

  it('excluye la propia cita al validar el hueco', async () => {
    const entorno = montar();
    prepararReprogramacion(entorno);

    await entorno.servicio.reprogramar(
      ID.reserva,
      { inicioEn: nuevaHora.toISOString(), notificar: true },
      actorRecepcion(),
    );

    // Sin esto la cita chocaría contra su propio hueco al moverla media hora.
    expect(entorno.disponibilidad.validarHueco).toHaveBeenCalledWith(
      expect.objectContaining({
        excluirReservaId: ID.reserva,
        servicioIds: [ID.servicioCorte],
      }),
    );
  });

  it('traslada la cita a otra sede comprobando que el barbero esté habilitado allí', async () => {
    const entorno = montar();
    prepararReprogramacion(entorno);
    entorno.prisma.usuario.findFirst.mockResolvedValue({
      id: ID.barbero,
      sedeId: ID.sede,
      sedesPermitidas: [{ sedeId: ID.sedeAlterna }],
    });

    await entorno.servicio.reprogramar(
      ID.reserva,
      { inicioEn: nuevaHora.toISOString(), sedeId: ID.sedeAlterna, notificar: true },
      actorRecepcion(),
    );

    expect(entorno.prisma.reserva.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sedeId: ID.sedeAlterna }),
      }),
    );
  });

  it('rechaza el traslado si el barbero no trabaja en la sede destino', async () => {
    const entorno = montar();
    prepararReprogramacion(entorno);
    barberoValido(entorno.prisma, [ID.sede]);

    const error = await capturar(() =>
      entorno.servicio.reprogramar(
        ID.reserva,
        { inicioEn: nuevaHora.toISOString(), sedeId: ID.sedeAlterna, notificar: true },
        actorRecepcion(),
      ),
    );

    expect(error.codigo).toBe(CODIGOS_ERROR.BARBERO_NO_PERTENECE_A_SEDE);
    expect(entorno.prisma.reserva.update).not.toHaveBeenCalled();
  });

  it.each(['COMPLETADA', 'CANCELADA', 'NO_ASISTIO', 'EN_CURSO'])(
    'no deja reprogramar una cita en estado %s',
    async (estado) => {
      const entorno = montar();
      prepararReprogramacion(entorno, reserva({ estado }));

      const error = await capturar(() =>
        entorno.servicio.reprogramar(
          ID.reserva,
          { inicioEn: nuevaHora.toISOString(), notificar: true },
          actorRecepcion(),
        ),
      );

      expect(error.codigo).toBe(CODIGOS_ERROR.ESTADO_RESERVA_INVALIDO);
      expect(error.getStatus()).toBe(409);
      expect(error.detalle).toEqual({ estadoActual: estado });
      expect(entorno.prisma.reserva.update).not.toHaveBeenCalled();
    },
  );

  describe('cuando reprograma el propio cliente', () => {
    it('rechaza el cambio dentro del plazo límite', async () => {
      const entorno = montar({ horasLimiteReprogramacion: 4 });
      // La cita es dentro de 2 horas: ya no se puede mover desde la web.
      prepararReprogramacion(
        entorno,
        reserva({ inicioEn: new Date(AHORA.getTime() + 2 * 3_600_000) }),
      );

      const error = await capturar(() =>
        entorno.servicio.reprogramar(
          ID.reserva,
          { inicioEn: nuevaHora.toISOString(), notificar: true },
          actorRecepcion(),
          true,
        ),
      );

      expect(error.codigo).toBe(CODIGOS_ERROR.FUERA_DE_PLAZO_REPROGRAMACION);
      expect(error.detalle).toEqual({ horasLimite: 4 });
    });

    it('acepta el cambio con margen suficiente y aplica las reglas de la web', async () => {
      const entorno = montar({ horasLimiteReprogramacion: 4 });
      prepararReprogramacion(
        entorno,
        reserva({ inicioEn: new Date(AHORA.getTime() + 10 * 3_600_000) }),
      );

      await entorno.servicio.reprogramar(
        ID.reserva,
        { inicioEn: nuevaHora.toISOString(), notificar: true },
        actorRecepcion(),
        true,
      );

      expect(entorno.disponibilidad.validarHueco).toHaveBeenCalledWith(
        expect.objectContaining({ aplicarReglasCliente: true }),
      );
      expect(entorno.prisma.reserva.update).toHaveBeenCalled();
    });

    it('la recepción puede mover una cita que ya está encima', async () => {
      const entorno = montar({ horasLimiteReprogramacion: 4 });
      prepararReprogramacion(
        entorno,
        reserva({ inicioEn: new Date(AHORA.getTime() + 30 * 60_000) }),
      );

      await expect(
        entorno.servicio.reprogramar(
          ID.reserva,
          { inicioEn: nuevaHora.toISOString(), notificar: true },
          actorRecepcion(),
        ),
      ).resolves.toBeTruthy();
    });
  });

  it('registra en auditoría el antes y el después', async () => {
    const entorno = montar();
    const antes = reserva();
    prepararReprogramacion(entorno, antes);

    await entorno.servicio.reprogramar(
      ID.reserva,
      { inicioEn: nuevaHora.toISOString(), motivo: 'El barbero se enfermó', notificar: true },
      actorRecepcion(),
    );

    expect(entorno.auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'REPROGRAMAR_RESERVA',
        entidadId: ID.reserva,
        antes: { inicioEn: antes.inicioEn, barberoId: ID.barbero, sedeId: ID.sede },
        despues: { inicioEn: nuevaHora, barberoId: ID.barbero, sedeId: ID.sede },
        resumen: expect.stringContaining('El barbero se enfermó'),
      }),
    );
  });
});

// ============================================================================
//  CANCELAR
// ============================================================================

describe('ReservasService.cancelar', () => {
  function prepararCancelacion(entorno: Entorno, actual = reserva()): void {
    entorno.prisma.reserva.findUnique.mockResolvedValue(actual);
    entorno.prisma.reserva.update.mockResolvedValue(reserva({ estado: 'CANCELADA' }));
  }

  it('cancela desde el panel, guarda el origen y recalcula las métricas del cliente', async () => {
    const entorno = montar();
    prepararCancelacion(entorno);

    await entorno.servicio.cancelar(
      ID.reserva,
      { motivo: 'El cliente avisó', notificar: true },
      actorRecepcion(),
      'PANEL',
    );

    expect(entorno.prisma.reserva.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          estado: 'CANCELADA',
          canceladaEn: AHORA,
          canceladaPor: 'PANEL',
          motivoCancelacion: 'El cliente avisó',
          tokenGestion: null,
        },
      }),
    );
    expect(entorno.clientes.recalcularMetricas).toHaveBeenCalledWith(ID.cliente);
  });

  it('escribe solo si el estado sigue siendo el que leyó: la condición viaja en el where', async () => {
    const entorno = montar();
    prepararCancelacion(entorno, reserva({ estado: 'PENDIENTE' }));

    await entorno.servicio.cancelar(ID.reserva, { notificar: true }, actorRecepcion());

    expect(entorno.prisma.reserva.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ID.reserva, estado: 'PENDIENTE' } }),
    );
  });

  it('si otra petición la canceló entre la lectura y la escritura, responde ESTADO_RESERVA_INVALIDO', async () => {
    const entorno = montar();
    prepararCancelacion(entorno);
    entorno.prisma.reserva.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Record to update not found', {
        code: 'P2025',
        clientVersion: 'test',
      }),
    );
    // La relectura que informa del estado actual ya ve la cita cancelada.
    entorno.prisma.reserva.findUnique
      .mockResolvedValueOnce(reserva())
      .mockResolvedValue({ estado: 'CANCELADA' });

    await expect(
      entorno.servicio.cancelar(ID.reserva, { notificar: true }, null, 'CLIENTE'),
    ).rejects.toMatchObject({
      codigo: CODIGOS_ERROR.ESTADO_RESERVA_INVALIDO,
      detalle: { estadoActual: 'CANCELADA' },
    });
    expect(entorno.auditoria.registrar).not.toHaveBeenCalled();
    expect(entorno.clientes.recalcularMetricas).not.toHaveBeenCalled();
  });

  it.each(['PENDIENTE', 'CONFIRMADA', 'EN_CURSO'])(
    'permite cancelar desde el estado %s',
    async (estado) => {
      const entorno = montar();
      prepararCancelacion(entorno, reserva({ estado }));

      await expect(
        entorno.servicio.cancelar(ID.reserva, { notificar: true }, actorRecepcion()),
      ).resolves.toBeTruthy();
    },
  );

  it.each(['COMPLETADA', 'CANCELADA', 'NO_ASISTIO'])(
    'no permite cancelar desde el estado %s',
    async (estado) => {
      const entorno = montar();
      prepararCancelacion(entorno, reserva({ estado }));

      const error = await capturar(() =>
        entorno.servicio.cancelar(ID.reserva, { notificar: true }, actorRecepcion()),
      );

      expect(error.codigo).toBe(CODIGOS_ERROR.ESTADO_RESERVA_INVALIDO);
      expect(error.detalle).toEqual({ estadoActual: estado });
      expect(entorno.prisma.reserva.update).not.toHaveBeenCalled();
    },
  );

  it('aplica el plazo límite solo al cliente', async () => {
    const entorno = montar({ horasLimiteCancelacion: 4 });
    prepararCancelacion(entorno, reserva({ inicioEn: new Date(AHORA.getTime() + 2 * 3_600_000) }));

    const error = await capturar(() =>
      entorno.servicio.cancelar(ID.reserva, { notificar: true }, null, 'CLIENTE'),
    );

    expect(error.codigo).toBe(CODIGOS_ERROR.FUERA_DE_PLAZO_CANCELACION);
    expect(error.detalle).toEqual({ horasLimite: 4 });
  });

  it('el cliente puede cancelar con margen suficiente', async () => {
    const entorno = montar({ horasLimiteCancelacion: 4 });
    prepararCancelacion(entorno, reserva({ inicioEn: new Date(AHORA.getTime() + 24 * 3_600_000) }));

    await expect(
      entorno.servicio.cancelar(ID.reserva, { notificar: true }, null, 'CLIENTE'),
    ).resolves.toBeTruthy();
  });

  it('el proceso automático (SISTEMA) ignora el plazo', async () => {
    const entorno = montar({ horasLimiteCancelacion: 48 });
    prepararCancelacion(entorno, reserva({ inicioEn: new Date(AHORA.getTime() + 60 * 60_000) }));

    await entorno.servicio.cancelar(ID.reserva, { notificar: false }, null, 'SISTEMA');

    expect(entorno.prisma.reserva.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ canceladaPor: 'SISTEMA' }) }),
    );
  });

  it('no recalcula métricas si la cita no tenía ficha de cliente', async () => {
    const entorno = montar();
    prepararCancelacion(entorno, reserva({ clienteId: null, cliente: null }));

    await entorno.servicio.cancelar(ID.reserva, { notificar: true }, actorRecepcion());

    expect(entorno.clientes.recalcularMetricas).not.toHaveBeenCalled();
  });
});

// ============================================================================
//  INICIAR / NO ASISTIÓ
// ============================================================================

describe('ReservasService: iniciar y marcar no asistió', () => {
  it('inicia una cita confirmada y sella la hora de inicio', async () => {
    const entorno = montar();
    entorno.prisma.reserva.findUnique.mockResolvedValue(reserva({ estado: 'CONFIRMADA' }));
    entorno.prisma.reserva.update.mockResolvedValue(reserva({ estado: 'EN_CURSO' }));

    await entorno.servicio.iniciar(ID.reserva, actorRecepcion());

    expect(entorno.prisma.reserva.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { estado: 'EN_CURSO', iniciadaEn: AHORA } }),
    );
  });

  it.each(['PENDIENTE', 'EN_CURSO', 'COMPLETADA', 'CANCELADA', 'NO_ASISTIO'])(
    'no deja iniciar una cita en estado %s',
    async (estado) => {
      const entorno = montar();
      entorno.prisma.reserva.findUnique.mockResolvedValue(reserva({ estado }));

      const error = await capturar(() => entorno.servicio.iniciar(ID.reserva, actorRecepcion()));

      expect(error.codigo).toBe(CODIGOS_ERROR.ESTADO_RESERVA_INVALIDO);
      expect(entorno.prisma.reserva.update).not.toHaveBeenCalled();
    },
  );

  it('marca no asistió, no genera sello y recalcula métricas', async () => {
    const entorno = montar();
    entorno.prisma.reserva.findUnique.mockResolvedValue(reserva({ estado: 'CONFIRMADA' }));
    entorno.prisma.reserva.update.mockResolvedValue(reserva({ estado: 'NO_ASISTIO' }));

    await entorno.servicio.marcarNoAsistio(ID.reserva, actorRecepcion());

    expect(entorno.prisma.reserva.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { estado: 'NO_ASISTIO' } }),
    );
    // El cliente no vino: no acumula visita.
    expect(entorno.fidelidad.generarSello).not.toHaveBeenCalled();
    expect(entorno.clientes.recalcularMetricas).toHaveBeenCalledWith(ID.cliente);
    expect(entorno.auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ entidad: 'Reserva', entidadId: ID.reserva }),
    );
  });

  it.each(['EN_CURSO', 'COMPLETADA', 'CANCELADA', 'NO_ASISTIO'])(
    'no deja marcar no asistió desde el estado %s',
    async (estado) => {
      const entorno = montar();
      entorno.prisma.reserva.findUnique.mockResolvedValue(reserva({ estado }));

      const error = await capturar(() =>
        entorno.servicio.marcarNoAsistio(ID.reserva, actorRecepcion()),
      );

      expect(error.codigo).toBe(CODIGOS_ERROR.ESTADO_RESERVA_INVALIDO);
    },
  );
});

// ============================================================================
//  COMPLETAR Y COBRAR
// ============================================================================

describe('ReservasService.completar', () => {
  function prepararCobro(
    entorno: Entorno,
    actual = reserva({ estado: 'EN_CURSO' }),
    lineas = [
      { ...lineaServicio(), servicio: { canjeableFidelidad: true, cuentaFidelidad: true } },
    ],
  ): void {
    entorno.prisma.reserva.findUnique.mockResolvedValue(actual);
    entorno.prisma.reserva.update.mockResolvedValue({ ...actual, estado: 'COMPLETADA' });
    entorno.prisma.reservaServicio.findMany.mockResolvedValue(lineas);
    entorno.prisma.reservaServicio.update.mockResolvedValue(lineas[0]);
    entorno.ventas.registrarDesdeReserva.mockResolvedValue(venta());
    entorno.fidelidad.canjear.mockResolvedValue({ canjeId: 'canje-1', sellosConsumidos: 7 });
    entorno.fidelidad.estado.mockResolvedValue({ sellos: 1, premiosDisponibles: 0 });
  }

  const datosCobro = {
    metodoPago: 'EFECTIVO' as const,
    productos: [],
    aplicarPremioFidelidad: false,
  };

  it('cobra la cita: actualiza estado, registra venta, genera sello y recalcula métricas', async () => {
    const entorno = montar();
    prepararCobro(entorno);

    const resultado = await entorno.servicio.completar(ID.reserva, datosCobro, actorRecepcion());

    expect(entorno.prisma.reserva.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estado: 'COMPLETADA', completadaEn: AHORA }),
      }),
    );
    expect(entorno.ventas.registrarDesdeReserva).toHaveBeenCalledTimes(1);
    expect(entorno.fidelidad.generarSello).toHaveBeenCalledTimes(1);
    expect(entorno.clientes.recalcularMetricas).toHaveBeenCalledWith(ID.cliente, expect.anything());
    expect(resultado.venta.numero).toBe('V-0001');
    expect(resultado.selloGenerado).toBe(true);
  });

  it('hace todo el cobro en una sola transacción', async () => {
    const entorno = montar();
    prepararCobro(entorno);

    await entorno.servicio.completar(ID.reserva, datosCobro, actorRecepcion());

    // Una venta sin su sello, o un sello sin su visita, nadie los reconstruye.
    expect(entorno.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('calcula el total restando el descuento indicado al cobrar', async () => {
    const entorno = montar();
    prepararCobro(entorno);

    await entorno.servicio.completar(
      ID.reserva,
      { ...datosCobro, descuento: 5000 },
      actorRecepcion(),
    );

    const { data } = entorno.prisma.reserva.update.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(String(data['descuento'])).toBe('5000');
    expect(String(data['total'])).toBe('25000');
  });

  it('conserva el descuento de la reserva si no se envía otro', async () => {
    const entorno = montar();
    prepararCobro(entorno, reserva({ estado: 'EN_CURSO', descuento: new Prisma.Decimal(3000) }));

    await entorno.servicio.completar(ID.reserva, datosCobro, actorRecepcion());

    const { data } = entorno.prisma.reserva.update.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(String(data['total'])).toBe('27000');
  });

  it('rechaza al cobrar un descuento mayor que el importe de la cita', async () => {
    const entorno = montar();
    prepararCobro(entorno);

    const error = await capturar(() =>
      entorno.servicio.completar(ID.reserva, { ...datosCobro, descuento: 99000 }, actorRecepcion()),
    );

    expect(error.codigo).toBe(CODIGOS_ERROR.VALIDACION);
    expect(error.getStatus()).toBe(422);
    // Nada de abrir la transacción: ni canje de sellos, ni venta a medias.
    expect(entorno.prisma.$transaction).not.toHaveBeenCalled();
    expect(entorno.fidelidad.canjear).not.toHaveBeenCalled();
    expect(entorno.auditoria.registrar).not.toHaveBeenCalled();
  });

  it('cobra en cero cuando el descuento iguala al importe', async () => {
    const entorno = montar();
    prepararCobro(entorno);

    await entorno.servicio.completar(
      ID.reserva,
      { ...datosCobro, descuento: 30000 },
      actorRecepcion(),
    );

    const { data } = entorno.prisma.reserva.update.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(String(data['descuento'])).toBe('30000');
    expect(String(data['total'])).toBe('0');
  });

  it('valida el descuento que ya traía la reserva cuando el cobro no envía otro', async () => {
    const entorno = montar();
    // Una reserva con un descuento incoherente de antes: al cobrarla, el error
    // sale en el campo y no como fallo del motor.
    prepararCobro(
      entorno,
      reserva({
        estado: 'EN_CURSO',
        subtotal: new Prisma.Decimal(30000),
        descuento: new Prisma.Decimal(90000),
      }),
    );

    const error = await capturar(() =>
      entorno.servicio.completar(ID.reserva, datosCobro, actorRecepcion()),
    );

    expect(error.codigo).toBe(CODIGOS_ERROR.VALIDACION);
  });

  it.each(['PENDIENTE', 'COMPLETADA', 'CANCELADA', 'NO_ASISTIO'])(
    'no deja cobrar una cita en estado %s',
    async (estado) => {
      const entorno = montar();
      prepararCobro(entorno, reserva({ estado }));

      const error = await capturar(() =>
        entorno.servicio.completar(ID.reserva, datosCobro, actorRecepcion()),
      );

      expect(error.codigo).toBe(CODIGOS_ERROR.ESTADO_RESERVA_INVALIDO);
      expect(error.detalle).toEqual({ estadoActual: estado });
      expect(entorno.prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('deja cobrar directamente una cita confirmada sin pasar por EN_CURSO', async () => {
    const entorno = montar();
    prepararCobro(entorno, reserva({ estado: 'CONFIRMADA' }));

    await expect(
      entorno.servicio.completar(ID.reserva, datosCobro, actorRecepcion()),
    ).resolves.toBeTruthy();
  });

  describe('premio de fidelidad', () => {
    it('cubre el servicio canjeable más caro y lo descuenta del total', async () => {
      const entorno = montar();
      prepararCobro(
        entorno,
        reserva({
          estado: 'EN_CURSO',
          subtotal: new Prisma.Decimal(45000),
          servicios: [
            lineaServicio(),
            lineaServicio({ id: 'linea-2', servicioId: ID.servicioBarba }),
          ],
        }),
        [
          {
            ...lineaServicio({ id: 'linea-caro', precioSnapshot: new Prisma.Decimal(30000) }),
            servicio: { canjeableFidelidad: true, cuentaFidelidad: true },
          },
        ],
      );

      await entorno.servicio.completar(
        ID.reserva,
        { ...datosCobro, aplicarPremioFidelidad: true },
        actorRecepcion(),
      );

      expect(entorno.fidelidad.canjear).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          clienteId: ID.cliente,
          reservaId: ID.reserva,
          valorCubierto: new Prisma.Decimal(30000),
          autorizadoPorId: ID.actor,
        }),
      );
      expect(entorno.prisma.reservaServicio.update).toHaveBeenCalledWith({
        where: { id: 'linea-caro' },
        data: { cubiertoPorCanje: true },
      });

      const { data } = entorno.prisma.reserva.update.mock.calls[0]![0] as {
        data: Record<string, unknown>;
      };
      expect(String(data['total'])).toBe('15000');
    });

    it('pide los servicios por precio descendente para cubrir el más caro', async () => {
      const entorno = montar();
      prepararCobro(entorno);

      await entorno.servicio.completar(
        ID.reserva,
        { ...datosCobro, aplicarPremioFidelidad: true },
        actorRecepcion(),
      );

      expect(entorno.prisma.reservaServicio.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { precioSnapshot: 'desc' } }),
      );
    });

    it('marca como cortesía solo la línea cubierta por el premio', async () => {
      const entorno = montar();
      prepararCobro(
        entorno,
        reserva({
          estado: 'EN_CURSO',
          subtotal: new Prisma.Decimal(45000),
          servicios: [
            lineaServicio({ id: 'linea-1' }),
            lineaServicio({
              id: 'linea-2',
              servicioId: ID.servicioBarba,
              nombreSnapshot: 'Barba',
              precioSnapshot: new Prisma.Decimal(15000),
            }),
          ],
        }),
        [
          {
            ...lineaServicio({ id: 'linea-1' }),
            servicio: { canjeableFidelidad: true, cuentaFidelidad: true },
          },
        ],
      );

      await entorno.servicio.completar(
        ID.reserva,
        { ...datosCobro, aplicarPremioFidelidad: true },
        actorRecepcion(),
      );

      const [, datosVenta] = entorno.ventas.registrarDesdeReserva.mock.calls[0]! as [
        unknown,
        { servicios: { nombre: string; esCortesia: boolean }[]; totalCortesia: Prisma.Decimal },
      ];
      // Si el corte gratis contara como venta, la comisión del barbero se
      // calcularía sobre dinero que nunca entró a caja.
      expect(datosVenta.servicios).toEqual([
        expect.objectContaining({ nombre: 'Corte clásico', esCortesia: true }),
        expect.objectContaining({ nombre: 'Barba', esCortesia: false }),
      ]);
      expect(String(datosVenta.totalCortesia)).toBe('30000');
    });

    it('registra el método CORTESIA cuando el premio deja el total en cero', async () => {
      const entorno = montar();
      prepararCobro(entorno);

      await entorno.servicio.completar(
        ID.reserva,
        { ...datosCobro, metodoPago: 'TARJETA', aplicarPremioFidelidad: true },
        actorRecepcion(),
      );

      const [, datosVenta] = entorno.ventas.registrarDesdeReserva.mock.calls[0]! as [
        unknown,
        { metodoPago: string },
      ];
      expect(datosVenta.metodoPago).toBe('CORTESIA');
    });

    it('mantiene el método de pago real si el cliente aún paga algo', async () => {
      const entorno = montar();
      prepararCobro(entorno, reserva({ estado: 'EN_CURSO', subtotal: new Prisma.Decimal(45000) }));

      await entorno.servicio.completar(
        ID.reserva,
        { ...datosCobro, metodoPago: 'NEQUI', aplicarPremioFidelidad: true },
        actorRecepcion(),
      );

      const [, datosVenta] = entorno.ventas.registrarDesdeReserva.mock.calls[0]! as [
        unknown,
        { metodoPago: string },
      ];
      expect(datosVenta.metodoPago).toBe('NEQUI');
    });

    it('exige ficha de cliente para aplicar el premio', async () => {
      const entorno = montar();
      prepararCobro(entorno, reserva({ estado: 'EN_CURSO', clienteId: null, cliente: null }));

      const error = await capturar(() =>
        entorno.servicio.completar(
          ID.reserva,
          { ...datosCobro, aplicarPremioFidelidad: true },
          actorRecepcion(),
        ),
      );

      expect(error.codigo).toBe(CODIGOS_ERROR.SELLOS_INSUFICIENTES);
      expect(error.mensaje).toContain('ficha del cliente');
      expect(entorno.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rechaza el premio si todas las líneas ya estaban cubiertas', async () => {
      const entorno = montar();
      prepararCobro(
        entorno,
        reserva({
          estado: 'EN_CURSO',
          servicios: [lineaServicio({ cubiertoPorCanje: true })],
        }),
      );

      const error = await capturar(() =>
        entorno.servicio.completar(
          ID.reserva,
          { ...datosCobro, aplicarPremioFidelidad: true },
          actorRecepcion(),
        ),
      );

      expect(error.codigo).toBe(CODIGOS_ERROR.SERVICIO_NO_CANJEABLE);
      expect(error.getStatus()).toBe(409);
    });

    it('rechaza el premio si ningún servicio de la cita es canjeable', async () => {
      const entorno = montar();
      prepararCobro(entorno, reserva({ estado: 'EN_CURSO' }), [
        {
          ...lineaServicio(),
          servicio: { canjeableFidelidad: false, cuentaFidelidad: true },
        },
      ]);

      const error = await capturar(() =>
        entorno.servicio.completar(
          ID.reserva,
          { ...datosCobro, aplicarPremioFidelidad: true },
          actorRecepcion(),
        ),
      );

      expect(error.codigo).toBe(CODIGOS_ERROR.SERVICIO_NO_CANJEABLE);
      expect(entorno.fidelidad.canjear).not.toHaveBeenCalled();
    });

    it('no genera sello nuevo con el corte gratis si el programa no lo permite', async () => {
      const entorno = montar({}, { canjeGeneraSello: false });
      prepararCobro(entorno);

      const resultado = await entorno.servicio.completar(
        ID.reserva,
        { ...datosCobro, aplicarPremioFidelidad: true },
        actorRecepcion(),
      );

      expect(entorno.fidelidad.generarSello).not.toHaveBeenCalled();
      expect(resultado.selloGenerado).toBe(false);
    });

    it('genera sello con el corte gratis si el programa lo permite', async () => {
      const entorno = montar({}, { canjeGeneraSello: true });
      prepararCobro(entorno);

      await entorno.servicio.completar(
        ID.reserva,
        { ...datosCobro, aplicarPremioFidelidad: true },
        actorRecepcion(),
      );

      expect(entorno.fidelidad.generarSello).toHaveBeenCalled();
    });

    it('deja dos entradas de auditoría: el cobro y la entrega del premio', async () => {
      const entorno = montar();
      prepararCobro(entorno);

      await entorno.servicio.completar(
        ID.reserva,
        { ...datosCobro, aplicarPremioFidelidad: true },
        actorRecepcion(),
      );

      const acciones = entorno.auditoria.registrar.mock.calls.map(
        (llamada) => (llamada[0] as { accion: string }).accion,
      );
      expect(acciones).toEqual(['COMPLETAR_RESERVA', 'CANJEAR_FIDELIDAD']);
    });
  });

  it('propaga el fallo de la transacción sin dejar auditoría del cobro', async () => {
    const entorno = montar();
    prepararCobro(entorno);
    // Lo típico: el cliente se lleva una pomada y no hay stock.
    entorno.ventas.registrarDesdeReserva.mockRejectedValue(
      ErrorNegocio.conflicto(CODIGOS_ERROR.STOCK_INSUFICIENTE),
    );

    const error = await capturar(() =>
      entorno.servicio.completar(
        ID.reserva,
        { ...datosCobro, productos: [{ productoId: ID.producto, cantidad: 2 }] },
        actorRecepcion(),
      ),
    );

    expect(error.codigo).toBe(CODIGOS_ERROR.STOCK_INSUFICIENTE);
    expect(entorno.auditoria.registrar).not.toHaveBeenCalled();
  });

  it('no toca la fidelidad cuando la cita no tiene ficha de cliente', async () => {
    const entorno = montar();
    prepararCobro(entorno, reserva({ estado: 'EN_CURSO', clienteId: null, cliente: null }));

    const resultado = await entorno.servicio.completar(ID.reserva, datosCobro, actorRecepcion());

    expect(entorno.fidelidad.generarSello).not.toHaveBeenCalled();
    expect(entorno.clientes.recalcularMetricas).not.toHaveBeenCalled();
    expect(resultado.fidelidad).toBeNull();
    expect(resultado.selloGenerado).toBe(false);
  });

  it('traslada los productos vendidos a la venta', async () => {
    const entorno = montar();
    prepararCobro(entorno);
    const productos = [{ productoId: ID.producto, cantidad: 2, precioUnitario: 12000 }];

    await entorno.servicio.completar(ID.reserva, { ...datosCobro, productos }, actorRecepcion());

    const [, datosVenta] = entorno.ventas.registrarDesdeReserva.mock.calls[0]! as [
      unknown,
      { productos: unknown[]; registradoPorId: string },
    ];
    expect(datosVenta.productos).toEqual(productos);
    expect(datosVenta.registradoPorId).toBe(ID.actor);
  });

  it('usa la zona horaria del negocio para los textos de auditoría', async () => {
    const entorno = montar();
    prepararCobro(entorno);

    await entorno.servicio.completar(ID.reserva, datosCobro, actorRecepcion());

    expect(entorno.configuracion.zonaHoraria).toHaveBeenCalled();
    expect(ZONA).toBe('America/Bogota');
  });
});

// ============================================================================
//  CANAL PÚBLICO: ACTOR NULO, CORREO Y TOKEN DE GESTIÓN
// ============================================================================

describe('ReservasService: canal público (actor nulo, correo y token de gestión)', () => {
  const nuevaHora = horaLocal(720, '2026-03-12');

  function prepararCreacionWeb(entorno: Entorno): void {
    barberoValido(entorno.prisma);
    entorno.prisma.servicio.findMany.mockResolvedValue([servicio()]);
    entorno.prisma.cliente.findUnique.mockResolvedValue(null);
    entorno.clientes.crear.mockResolvedValue({ id: 'cliente-nuevo' });
    entorno.prisma.reserva.count.mockResolvedValue(0);
    entorno.prisma.reserva.create.mockResolvedValue({
      id: ID.reserva,
      codigo: 'CDS-A1B2',
      estado: 'CONFIRMADA',
    });
    entorno.prisma.reserva.findUnique.mockResolvedValue(reserva());
  }

  const datosWeb = (email?: string) =>
    datosCrear({
      clienteId: undefined,
      clienteNuevo: {
        nombreCompleto: 'Juan P',
        telefono: '+573001234567',
        ...(email ? { email } : {}),
      },
    });

  it('crea con actor nulo y audita sin usuario', async () => {
    const entorno = montar();
    prepararCreacionWeb(entorno);

    await entorno.servicio.crear(datosWeb(), null, true);

    // Una fila de auditoría con usuario vacío dice la verdad; una con un usuario
    // inventado miente. El canal WEB de la reserva explica quién la creó.
    expect(entorno.auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'CREAR', actor: null }),
    );
    const { data } = entorno.prisma.reserva.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(data['creadoPorId']).toBeNull();
    expect(data['canal']).toBe('WEB');
  });

  it('pasa el correo a la ficha nueva y marca aceptaEmail', async () => {
    const entorno = montar();
    prepararCreacionWeb(entorno);

    await entorno.servicio.crear(datosWeb('juan@ejemplo.com'), null, true);

    expect(entorno.clientes.crear).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'juan@ejemplo.com', aceptaEmail: true }),
      null,
    );
  });

  it('sin correo no manda aceptaEmail: lo omite, no lo pone a false', async () => {
    const entorno = montar();
    prepararCreacionWeb(entorno);

    await entorno.servicio.crear(datosWeb(), null, true);

    const [datos] = entorno.clientes.crear.mock.calls[0]! as [Record<string, unknown>];
    expect(datos).not.toHaveProperty('aceptaEmail');
  });

  it('no degrada el consentimiento previo al reactivar una ficha cuando no hay correo', async () => {
    const entorno = montar();
    prepararCreacionWeb(entorno);
    const clientesReal = new ClientesService(
      entorno.prisma as never,
      entorno.auditoria as never,
      entorno.configuracion as never,
    );
    entorno.clientes.crear.mockImplementation((datos: never, actor: never) =>
      clientesReal.crear(datos, actor),
    );
    // La ficha eliminada había consentido recibir correo.
    entorno.prisma.cliente.findUnique.mockResolvedValue({
      id: ID.cliente,
      nombreCompleto: 'Juan P',
      eliminadoEn: new Date('2026-01-01T00:00:00Z'),
      aceptaEmail: true,
    });
    entorno.prisma.cliente.update.mockResolvedValue({ id: ID.cliente });

    await entorno.servicio.crear(datosWeb(), null, true);

    const { data } = entorno.prisma.cliente.update.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(data).not.toHaveProperty('aceptaEmail');
  });

  it('no restaura el consentimiento de WhatsApp que el cliente retiró al reactivar su ficha', async () => {
    const entorno = montar();
    prepararCreacionWeb(entorno);
    const clientesReal = new ClientesService(
      entorno.prisma as never,
      entorno.auditoria as never,
      entorno.configuracion as never,
    );
    entorno.clientes.crear.mockImplementation((datos: never, actor: never) =>
      clientesReal.crear(datos, actor),
    );
    // La ficha eliminada había pedido no recibir mensajes por WhatsApp.
    entorno.prisma.cliente.findUnique.mockResolvedValue({
      id: ID.cliente,
      nombreCompleto: 'Juan P',
      eliminadoEn: new Date('2026-01-01T00:00:00Z'),
      aceptaWhatsapp: false,
    });
    entorno.prisma.cliente.update.mockResolvedValue({ id: ID.cliente });

    await entorno.servicio.crear(datosWeb(), null, true);

    const { data } = entorno.prisma.cliente.update.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(data).not.toHaveProperty('aceptaWhatsapp');
  });

  it('reutiliza y reactiva la ficha de un teléfono eliminado sin borrarle las notas', async () => {
    const entorno = montar();
    prepararCreacionWeb(entorno);
    // El servicio de clientes es el real: lo que se fija es lo que acaba
    // escribiéndose en la ficha, no lo que el doble prometa.
    const clientesReal = new ClientesService(
      entorno.prisma as never,
      entorno.auditoria as never,
      entorno.configuracion as never,
    );
    entorno.clientes.crear.mockImplementation((datos: never, actor: never) =>
      clientesReal.crear(datos, actor),
    );
    entorno.prisma.cliente.findUnique.mockResolvedValue({
      id: ID.cliente,
      nombreCompleto: 'Juan P',
      eliminadoEn: new Date('2026-01-01T00:00:00Z'),
    });
    entorno.prisma.cliente.update.mockResolvedValue({ id: ID.cliente });

    await entorno.servicio.crear(datosWeb('juan@ejemplo.com'), null, true);

    expect(entorno.prisma.cliente.create).not.toHaveBeenCalled();
    const { where, data } = entorno.prisma.cliente.update.mock.calls[0]![0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(where).toEqual({ id: ID.cliente });
    expect(data['eliminadoEn']).toBeNull();
    expect(data['activo']).toBe(true);
    // Prisma ignora `undefined`: la clave puede viajar, pero nunca con un valor
    // ('' o null) que pise las notas que la ficha ya tenía.
    expect(data).not.toHaveProperty('notas');
    const { data: reservaData } = entorno.prisma.reserva.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(reservaData['clienteId']).toBe(ID.cliente);
  });

  it('desde el panel guarda el correo pero no marca aceptaEmail', async () => {
    const entorno = montar();
    prepararCreacionWeb(entorno);

    // Tener el dato no es tener permiso para usarlo: lo escribe recepción, no
    // el cliente, así que nadie ha consentido nada.
    await entorno.servicio.crear(datosWeb('juan@ejemplo.com'), actorRecepcion());

    const [datos] = entorno.clientes.crear.mock.calls[0]! as [Record<string, unknown>];
    expect(datos).toMatchObject({ email: 'juan@ejemplo.com' });
    expect(datos).not.toHaveProperty('aceptaEmail');
  });

  it('desde el panel no puede crear una cita sin actor', async () => {
    const entorno = montar();
    prepararCreacionWeb(entorno);

    await expect(entorno.servicio.crear(datosWeb(), null)).rejects.toThrow();

    // Una cita del panel sin autor sería un agujero de auditoría silencioso.
    expect(entorno.prisma.reserva.create).not.toHaveBeenCalled();
    expect(entorno.clientes.crear).not.toHaveBeenCalled();
    expect(entorno.auditoria.registrar).not.toHaveBeenCalled();
  });

  it('desde el panel no puede reprogramar sin actor', async () => {
    const entorno = montar();
    entorno.prisma.reserva.findUnique.mockResolvedValue(reserva());
    barberoValido(entorno.prisma);

    await expect(
      entorno.servicio.reprogramar(
        ID.reserva,
        { inicioEn: nuevaHora.toISOString(), notificar: true },
        null,
      ),
    ).rejects.toThrow();
    expect(entorno.prisma.reserva.update).not.toHaveBeenCalled();
  });

  it('invalida el token de gestión al cancelar', async () => {
    const entorno = montar();
    entorno.prisma.reserva.findUnique.mockResolvedValue(reserva());
    entorno.prisma.reserva.update.mockResolvedValue(reserva({ estado: 'CANCELADA' }));

    await entorno.servicio.cancelar(ID.reserva, { notificar: true }, null, 'CLIENTE');

    expect(entorno.prisma.reserva.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tokenGestion: null }) }),
    );
    expect(entorno.auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'CANCELAR_RESERVA', actor: null }),
    );
  });

  it('rota el token de gestión al reprogramar y devuelve el nuevo', async () => {
    const entorno = montar();
    entorno.prisma.reserva.findUnique.mockResolvedValue(reserva({ tokenGestion: 'token-viejo' }));
    barberoValido(entorno.prisma);
    // El doble de `update` devuelve lo que se le escribió, como la base real.
    entorno.prisma.reserva.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({ ...reserva(), ...data }),
    );

    const resultado = await entorno.servicio.reprogramar(
      ID.reserva,
      { inicioEn: nuevaHora.toISOString(), notificar: true },
      null,
      true,
    );

    // El enlace viejo pudo quedar en un correo o en un historial de WhatsApp.
    const { data } = entorno.prisma.reserva.update.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(data['tokenGestion']).toEqual(expect.any(String));
    expect(data['tokenGestion']).not.toBe('token-viejo');
    expect(resultado.tokenGestion).toBe(data['tokenGestion']);
    expect(entorno.auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'REPROGRAMAR_RESERVA', actor: null }),
    );
  });

  it('no rota el token cuando reprograma el panel', async () => {
    const entorno = montar();
    entorno.prisma.reserva.findUnique.mockResolvedValue(reserva());
    barberoValido(entorno.prisma);
    entorno.prisma.reserva.update.mockResolvedValue(reserva({ inicioEn: nuevaHora }));

    await entorno.servicio.reprogramar(
      ID.reserva,
      { inicioEn: nuevaHora.toISOString(), notificar: true },
      actorRecepcion(),
    );

    const { data } = entorno.prisma.reserva.update.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(data).not.toHaveProperty('tokenGestion');
  });
});
