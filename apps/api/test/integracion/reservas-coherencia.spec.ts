import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { RespuestaError } from '@cds/shared';
import { PrismaService } from '../../src/comun/prisma/prisma.service.js';
import { FiltroGlobalExcepciones } from '../../src/comun/excepciones/filtro-global.js';
import { cerrarConexion, prisma } from './soporte/conexion.js';
import { datosReserva, limpiarReservas, sembrar } from './soporte/semilla.js';

/**
 * Los CHECK que protegen la tabla `reservas`, contra Postgres real.
 *
 * Van aquí y no en la suite unitaria por el mismo motivo que la restricción de
 * exclusión: con un doble de Prisma estas reglas no existen, así que una
 * prueba unitaria puede "pasar" guardando una fila que la base de datos de
 * producción rechazaría.
 *
 *   reservas_rango_valido           finEn > inicioEn AND finConBufferEn >= finEn
 *   reservas_importes_no_negativos  subtotal, descuento, total >= 0
 *                                   AND descuento <= subtotal
 *
 * El filtro global no traduce las violaciones de CHECK: caen en el `default` y
 * salen como ERROR_INTERNO 500, con registro en `RegistroError`. El comentario
 * del propio filtro lo dice sin rodeos — "es un bug nuestro (dejamos pasar
 * datos incoherentes)". Por eso estas pruebas importan: cada una describe una
 * fila que, si la API llegara a construirla, el usuario vería como un error
 * inesperado.
 */

async function capturar(accion: () => Promise<unknown>): Promise<unknown> {
  try {
    await accion();
  } catch (error) {
    return error;
  }
  throw new Error('Se esperaba que la base de datos rechazara la escritura, y la aceptó');
}

const viola = (error: unknown, restriccion: string): boolean =>
  PrismaService.esViolacionDe(error, restriccion);

/** Escribe la fila saltándose los tipos: el objetivo es provocar el CHECK. */
const insertar = (datos: Record<string, unknown>) =>
  prisma().reserva.create({
    data: { ...datosReserva({ desde: 600, hasta: 660 }), ...datos } as never,
  });

beforeAll(async () => {
  await sembrar();
});

beforeEach(async () => {
  await limpiarReservas();
});

afterAll(async () => {
  await limpiarReservas();
  await cerrarConexion();
});

// ============================================================================
//  COHERENCIA TEMPORAL
// ============================================================================

describe('reservas_rango_valido', () => {
  it('rechaza una cita que acaba antes de empezar', async () => {
    const error = await capturar(() =>
      insertar({
        inicioEn: new Date('2026-06-16T11:00:00.000Z'),
        finEn: new Date('2026-06-16T10:00:00.000Z'),
        finConBufferEn: new Date('2026-06-16T10:00:00.000Z'),
      }),
    );

    expect(viola(error, 'reservas_rango_valido')).toBe(true);
  });

  it('rechaza una cita de duración cero', async () => {
    const mismoInstante = new Date('2026-06-16T10:00:00.000Z');

    const error = await capturar(() =>
      insertar({ inicioEn: mismoInstante, finEn: mismoInstante, finConBufferEn: mismoInstante }),
    );

    expect(viola(error, 'reservas_rango_valido')).toBe(true);
  });

  it('rechaza un fin con buffer anterior al fin visible', async () => {
    // Sería un buffer negativo: la silla se liberaría antes de que el cliente
    // termine.
    const error = await capturar(() =>
      insertar({
        inicioEn: new Date('2026-06-16T10:00:00.000Z'),
        finEn: new Date('2026-06-16T11:00:00.000Z'),
        finConBufferEn: new Date('2026-06-16T10:45:00.000Z'),
      }),
    );

    expect(viola(error, 'reservas_rango_valido')).toBe(true);
  });

  it('acepta el caso normal sin buffer: fin con buffer igual al fin visible', async () => {
    await expect(
      insertar({
        inicioEn: new Date('2026-06-16T10:00:00.000Z'),
        finEn: new Date('2026-06-16T11:00:00.000Z'),
        finConBufferEn: new Date('2026-06-16T11:00:00.000Z'),
      }),
    ).resolves.toBeTruthy();
  });
});

// ============================================================================
//  COHERENCIA DE IMPORTES
// ============================================================================

describe('reservas_importes_no_negativos', () => {
  it.each([
    [
      'subtotal',
      {
        subtotal: new Prisma.Decimal(-1),
        descuento: new Prisma.Decimal(0),
        total: new Prisma.Decimal(0),
      },
    ],
    [
      'descuento',
      {
        subtotal: new Prisma.Decimal(30000),
        descuento: new Prisma.Decimal(-1),
        total: new Prisma.Decimal(30000),
      },
    ],
    [
      'total',
      {
        subtotal: new Prisma.Decimal(30000),
        descuento: new Prisma.Decimal(0),
        total: new Prisma.Decimal(-1),
      },
    ],
  ])('rechaza un %s negativo', async (_campo, importes) => {
    const error = await capturar(() => insertar(importes));

    expect(viola(error, 'reservas_importes_no_negativos')).toBe(true);
  });

  it('acepta una cita gratis: todo en cero', async () => {
    // Es el caso del premio de fidelidad que cubre el único servicio.
    await expect(
      insertar({
        subtotal: new Prisma.Decimal(0),
        descuento: new Prisma.Decimal(0),
        total: new Prisma.Decimal(0),
      }),
    ).resolves.toBeTruthy();
  });

  /**
   * Esta es la restricción que destapó el bug del descuento.
   *
   * Hasta que se arregló, ni `insertarReserva` ni `completar` imponían
   * `descuento <= subtotal`: los dos guardaban el `descuento` tal cual y
   * acotaban **solo el total** con `Decimal.max(0, …)`. Un descuento de 90 000
   * sobre un subtotal de 30 000 producía exactamente esta fila, Postgres la
   * rechazaba, el filtro global no sabía traducir un CHECK y la recepción veía
   * "Ocurrió un error inesperado" con la cita sin cobrar. La suite unitaria
   * daba verde porque con dobles la restricción no existe.
   *
   * Ahora `ReservasService.verificarDescuento` lo rechaza antes de escribir,
   * con el error en el campo `descuento`, y el filtro global traduce este CHECK
   * por si alguna ruta futura se salta esa validación. La restricción sigue
   * siendo la última palabra, y esta prueba la vigila: si alguien la relajara
   * en una migración, la red de seguridad desaparecería sin aviso.
   */
  it('rechaza un descuento mayor que el subtotal', async () => {
    const error = await capturar(() =>
      insertar({
        subtotal: new Prisma.Decimal(30000),
        descuento: new Prisma.Decimal(90000),
        total: new Prisma.Decimal(0),
      }),
    );

    expect(viola(error, 'reservas_importes_no_negativos')).toBe(true);
  });

  it('acepta el descuento que iguala al subtotal', async () => {
    await expect(
      insertar({
        subtotal: new Prisma.Decimal(30000),
        descuento: new Prisma.Decimal(30000),
        total: new Prisma.Decimal(0),
      }),
    ).resolves.toBeTruthy();
  });

  it('una violación de CHECK no se confunde con el solape', async () => {
    const error = await capturar(() =>
      insertar({
        subtotal: new Prisma.Decimal(30000),
        descuento: new Prisma.Decimal(90000),
        total: new Prisma.Decimal(0),
      }),
    );

    // Importa porque el filtro global decide por nombre de restricción: si
    // `esViolacionDe` diera un falso positivo, un bug de importes se le
    // mostraría al usuario como "ese horario acaba de ocuparse".
    expect(viola(error, 'reservas_sin_solape_barbero')).toBe(false);
  });
});

// ============================================================================
//  UN SOLO CLIENTE GENÉRICO
// ============================================================================

// ============================================================================
//  DEL ERROR DEL MOTOR AL CUERPO QUE RECIBE EL PANEL
// ============================================================================

describe('El filtro global traduce el CHECK de importes', () => {
  /** Mínimo imprescindible para ejecutar el filtro fuera de una petición real. */
  function montarFiltro() {
    const registro = { registrar: vi.fn(async () => undefined) };
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({
          method: 'PATCH',
          originalUrl: '/api/v1/reservas/x/completar',
          path: '/reservas/x/completar',
          headers: {},
          body: {},
          query: {},
          params: {},
        }),
      }),
    };

    return {
      filtro: new FiltroGlobalExcepciones(registro as never),
      host: host as never,
      status,
      json,
      registro,
    };
  }

  it('devuelve 422 con el error en el campo descuento, no un 500 genérico', async () => {
    const errorCrudo = await capturar(() =>
      insertar({
        subtotal: new Prisma.Decimal(30000),
        descuento: new Prisma.Decimal(90000),
        total: new Prisma.Decimal(0),
      }),
    );

    const { filtro, host, status, json, registro } = montarFiltro();
    await filtro.catch(errorCrudo, host);

    // Se parte del error real del motor, no de uno inventado: es la única forma
    // de saber que `esViolacionDe` sigue reconociendo lo que Prisma entrega.
    expect(status).toHaveBeenCalledWith(422);
    const cuerpo = json.mock.calls[0]![0] as RespuestaError;
    expect(cuerpo.codigo).toBe('VALIDACION');
    expect(cuerpo.campos?.['descuento']).toBeDefined();
    expect(cuerpo.mensaje).not.toContain('reservas_importes_no_negativos');
    // Llegar hasta aquí significa que una ruta se saltó la validación de la
    // API: queda registrado para poder encontrarla.
    expect(registro.registrar).toHaveBeenCalledTimes(1);
  });

  it('el solape sigue traduciéndose a su propio código', async () => {
    await insertar({});
    const errorCrudo = await capturar(() => insertar({}));

    const { filtro, host, status, json, registro } = montarFiltro();
    await filtro.catch(errorCrudo, host);

    expect(status).toHaveBeenCalledWith(409);
    expect((json.mock.calls[0]![0] as RespuestaError).codigo).toBe('RESERVA_SOLAPADA');
    // Un hueco que se ocupó es un conflicto legítimo, no una incidencia.
    expect(registro.registrar).not.toHaveBeenCalled();
  });
});

describe('clientes_unico_generico_idx', () => {
  const generico = {
    nombreCompleto: 'Consumidor final (duplicado)',
    telefono: '+573000000001',
    esGenerico: true,
  };

  afterAll(async () => {
    await prisma().cliente.deleteMany({ where: { esGenerico: true } });
  });

  it('permite un único cliente genérico', async () => {
    await prisma().cliente.deleteMany({ where: { esGenerico: true } });

    await expect(prisma().cliente.create({ data: generico })).resolves.toBeTruthy();

    // Si hubiera dos "Consumidor final", los walk-ins sin ficha se repartirían
    // entre ambos y el recuento de visitas anónimas dejaría de cuadrar.
    const error = await capturar(() =>
      prisma().cliente.create({ data: { ...generico, telefono: '+573000000002' } }),
    );

    expect(PrismaService.esDuplicado(error)).toBe(true);
  });

  it('no limita los clientes normales', async () => {
    await expect(
      prisma().cliente.create({
        data: { nombreCompleto: 'Cliente normal', telefono: '+573000000003' },
      }),
    ).resolves.toBeTruthy();

    await prisma().cliente.delete({ where: { telefono: '+573000000003' } });
  });
});
