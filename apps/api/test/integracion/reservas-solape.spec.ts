import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { CODIGOS_ERROR } from '@cds/shared';
import { PrismaService } from '../../src/comun/prisma/prisma.service.js';
import { cerrarConexion, prisma } from './soporte/conexion.js';
import {
  IDS,
  crearReserva,
  datosReserva,
  espera,
  limpiarReservas,
  sembrar,
} from './soporte/semilla.js';

/**
 * Restricción `reservas_sin_solape_barbero`, contra Postgres real.
 *
 * Es la única regla del sistema que la API no puede garantizar por sí sola. La
 * validación en código tiene una ventana de carrera: dos recepcionistas que
 * pulsan "Guardar" en el mismo milisegundo pasan las dos la comprobación "¿está
 * libre este hueco?" y escriben encima. Quien cierra esa puerta es el motor:
 *
 *   EXCLUDE USING gist (
 *     "barberoId" WITH =,
 *     tsrange("inicioEn", "finConBufferEn", '[)') WITH &&
 *   ) WHERE (estado IN ('PENDIENTE', 'CONFIRMADA', 'EN_CURSO'))
 *
 * Tres detalles de esa definición son los que estructuran la suite, y cada uno
 * es una decisión de negocio que podría romperse sin que nadie lo note:
 *
 *   · El rango llega hasta `finConBufferEn`, no hasta `finEn`: el tiempo de
 *     limpieza también ocupa la silla.
 *   · El rango es `[)`: dos citas pegadas (una acaba a las 10:00, la siguiente
 *     empieza a las 10:00) son legales. Si fuera `[]`, media agenda sería
 *     inválida.
 *   · El `WHERE` parcial: cancelar o marcar no-asistió libera el hueco al
 *     instante, sin borrar la fila ni perder el historial.
 *
 * Al final se cierra el círculo: el error crudo de Postgres tiene que ser
 * reconocible por `PrismaService.esViolacionDe`, que es lo que el filtro global
 * usa para traducirlo a "ese horario acaba de ocuparse" en lugar de un 500.
 *
 * Nota de lectura: los minutos son UTC puro, no la hora de Bogotá. Aquí no se
 * prueban conversiones de zona — eso es trabajo del motor de disponibilidad y
 * ya está cubierto en su suite unitaria. Lo que se prueba es la aritmética de
 * rangos del motor de base de datos.
 */

/** Reserva de referencia: de 10:00 a 11:00, sin buffer. */
const DIEZ_A_ONCE = { desde: 600, hasta: 660 };

/** Captura el error de una escritura que debe fallar. */
async function capturar(accion: () => Promise<unknown>): Promise<unknown> {
  try {
    await accion();
  } catch (error) {
    return error;
  }
  throw new Error('Se esperaba que la base de datos rechazara la escritura, y la aceptó');
}

const esSolape = (error: unknown): boolean =>
  PrismaService.esViolacionDe(error, 'reservas_sin_solape_barbero');

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
//  SOLAPES QUE LA BASE DEBE RECHAZAR
// ============================================================================

describe('reservas_sin_solape_barbero: solapes rechazados', () => {
  it('rechaza dos citas idénticas del mismo barbero', async () => {
    await crearReserva(DIEZ_A_ONCE);

    const error = await capturar(() => crearReserva(DIEZ_A_ONCE));

    expect(esSolape(error)).toBe(true);
    expect(await prisma().reserva.count()).toBe(1);
  });

  it.each([
    ['empieza dentro de la anterior', { desde: 630, hasta: 690 }],
    ['acaba dentro de la anterior', { desde: 570, hasta: 630 }],
    ['engloba por completo a la anterior', { desde: 540, hasta: 720 }],
    ['queda contenida dentro de la anterior', { desde: 615, hasta: 645 }],
    ['comparte un solo minuto por el final', { desde: 659, hasta: 700 }],
    ['comparte un solo minuto por el principio', { desde: 560, hasta: 601 }],
  ])('rechaza la cita que %s', async (_caso, rango) => {
    await crearReserva(DIEZ_A_ONCE);

    const error = await capturar(() => crearReserva(rango));

    expect(esSolape(error)).toBe(true);
  });

  it('rechaza la cita que solo pisa el tiempo de limpieza', async () => {
    // Corte de 10:00 a 11:00 más 15 minutos de buffer: la silla queda ocupada
    // hasta las 11:15 aunque el cliente ya se haya ido.
    await crearReserva({ desde: 600, hasta: 675, finEn: 660 });

    const error = await capturar(() => crearReserva({ desde: 665, hasta: 725 }));

    expect(esSolape(error)).toBe(true);
  });

  it('cuenta el buffer de la cita nueva, no solo el de la existente', async () => {
    await crearReserva({ desde: 660, hasta: 720 });

    // Acaba a las 10:50, pero con 15 minutos de limpieza llega hasta las 11:05.
    const error = await capturar(() => crearReserva({ desde: 600, hasta: 665, finEn: 650 }));

    expect(esSolape(error)).toBe(true);
  });

  it.each(['PENDIENTE', 'CONFIRMADA', 'EN_CURSO'] as const)(
    'una cita en estado %s bloquea el hueco',
    async (estado) => {
      await crearReserva({ ...DIEZ_A_ONCE, estado });

      const error = await capturar(() => crearReserva({ desde: 630, hasta: 690 }));

      expect(esSolape(error)).toBe(true);
    },
  );

  it.each(['PENDIENTE', 'EN_CURSO'] as const)(
    'la cita nueva en estado %s también queda sujeta a la restricción',
    async (estado) => {
      await crearReserva(DIEZ_A_ONCE);

      const error = await capturar(() => crearReserva({ desde: 630, hasta: 690, estado }));

      expect(esSolape(error)).toBe(true);
    },
  );

  it('rechaza mover una cita encima de otra con UPDATE', async () => {
    await crearReserva(DIEZ_A_ONCE);
    const tarde = await crearReserva({ desde: 900, hasta: 960 });

    // Reprogramar es un UPDATE: la restricción tiene que valer igual que en el
    // INSERT, o el agujero se abre por la puerta de atrás.
    const error = await capturar(() =>
      prisma().reserva.update({
        where: { id: tarde.id },
        data: {
          inicioEn: new Date('2026-06-16T10:30:00.000Z'),
          finEn: new Date('2026-06-16T11:30:00.000Z'),
          finConBufferEn: new Date('2026-06-16T11:30:00.000Z'),
        },
      }),
    );

    expect(esSolape(error)).toBe(true);
  });

  it('rechaza reactivar una cita cancelada cuyo hueco ya se reocupó', async () => {
    const cancelada = await crearReserva({ ...DIEZ_A_ONCE, estado: 'CANCELADA' });
    await crearReserva(DIEZ_A_ONCE);

    // El cliente llama para "deshacer" la cancelación, pero el hueco ya se dio.
    const error = await capturar(() =>
      prisma().reserva.update({
        where: { id: cancelada.id },
        data: { estado: 'CONFIRMADA' },
      }),
    );

    expect(esSolape(error)).toBe(true);
  });
});

// ============================================================================
//  LO QUE LA BASE DEBE PERMITIR
// ============================================================================

describe('reservas_sin_solape_barbero: casos legítimos', () => {
  it('permite dos citas pegadas: una acaba donde empieza la otra', async () => {
    await crearReserva(DIEZ_A_ONCE);

    // El rango es `[)`. Si fuera cerrado por los dos lados, una agenda normal
    // de citas consecutivas sería imposible de guardar.
    await expect(crearReserva({ desde: 660, hasta: 720 })).resolves.toBeTruthy();
    expect(await prisma().reserva.count()).toBe(2);
  });

  it('permite la cita inmediatamente anterior', async () => {
    await crearReserva(DIEZ_A_ONCE);

    await expect(crearReserva({ desde: 540, hasta: 600 })).resolves.toBeTruthy();
  });

  /**
   * DIVERGENCIA entre la base de datos y el motor de disponibilidad.
   *
   * El `WHERE` de la restricción solo cubre PENDIENTE, CONFIRMADA y EN_CURSO,
   * así que para Postgres una cita COMPLETADA no ocupa nada. Pero
   * `DisponibilidadService.reservasDelDia` sí la cuenta como ocupación, con un
   * comentario que lo justifica: "esa silla estuvo usada a esa hora".
   *
   * Resultado: el panel no ofrece ese hueco, pero si algo escribe la reserva
   * sin pasar por el motor (una corrección a mano, un script de migración, un
   * endpoint futuro), la base la acepta sin protestar. No corrompe datos, pero
   * la red de seguridad tiene un agujero exactamente donde el código cree que
   * está cubierto.
   *
   * Decidir cuál de las dos lecturas es la correcta es cosa del negocio; hasta
   * entonces, esta prueba deja la diferencia por escrito.
   */
  it('la base acepta una cita encima de una COMPLETADA, aunque el motor la oculte', async () => {
    await crearReserva({ ...DIEZ_A_ONCE, estado: 'COMPLETADA' });

    await expect(crearReserva(DIEZ_A_ONCE)).resolves.toBeTruthy();
    expect(await prisma().reserva.count()).toBe(2);
  });

  it('permite la misma hora a dos barberos distintos', async () => {
    await crearReserva(DIEZ_A_ONCE);

    // Dos sillas, dos clientes a la vez: es el caso normal de la barbería.
    await expect(
      crearReserva({ ...DIEZ_A_ONCE, barberoId: IDS.barberoAjeno }),
    ).resolves.toBeTruthy();
  });

  it('permite la misma hora en otro día', async () => {
    await crearReserva(DIEZ_A_ONCE);

    await expect(
      prisma().reserva.create({
        data: {
          ...datosReserva(DIEZ_A_ONCE),
          inicioEn: new Date('2026-06-17T10:00:00.000Z'),
          finEn: new Date('2026-06-17T11:00:00.000Z'),
          finConBufferEn: new Date('2026-06-17T11:00:00.000Z'),
        },
      }),
    ).resolves.toBeTruthy();
  });

  it.each(['CANCELADA', 'NO_ASISTIO'] as const)(
    'una cita en estado %s libera el hueco sin borrar la fila',
    async (estado) => {
      await crearReserva({ ...DIEZ_A_ONCE, estado });

      await expect(crearReserva(DIEZ_A_ONCE)).resolves.toBeTruthy();
      // La cancelada sigue ahí: el historial del cliente no se pierde.
      expect(await prisma().reserva.count()).toBe(2);
    },
  );

  it('cancelar una cita libera el hueco de inmediato', async () => {
    const original = await crearReserva(DIEZ_A_ONCE);

    await prisma().reserva.update({
      where: { id: original.id },
      data: { estado: 'CANCELADA', canceladaEn: new Date(), canceladaPor: 'PANEL' },
    });

    await expect(crearReserva(DIEZ_A_ONCE)).resolves.toBeTruthy();
  });

  it('permite varias canceladas solapadas entre sí', async () => {
    // El `WHERE` parcial las deja fuera del índice por completo: un cliente que
    // reserva y cancela cinco veces la misma hora no rompe nada.
    await crearReserva({ ...DIEZ_A_ONCE, estado: 'CANCELADA' });
    await crearReserva({ ...DIEZ_A_ONCE, estado: 'CANCELADA' });
    await crearReserva({ ...DIEZ_A_ONCE, estado: 'NO_ASISTIO' });

    expect(await prisma().reserva.count()).toBe(3);
  });

  it('la restricción mira al barbero, no a la sede', async () => {
    await crearReserva(DIEZ_A_ONCE);

    // Un barbero no puede estar en dos locales a la vez: cambiar de sede no
    // debe abrir un hueco que no existe.
    const error = await capturar(() => crearReserva({ ...DIEZ_A_ONCE, sedeId: IDS.sedeAlterna }));

    expect(esSolape(error)).toBe(true);
  });
});

// ============================================================================
//  CONCURRENCIA: LA RAZÓN DE SER DE LA RESTRICCIÓN
// ============================================================================

describe('reservas_sin_solape_barbero: la carrera real', () => {
  it('con dos transacciones simultáneas, solo una cita sobrevive', async () => {
    const db = prisma();

    // Las dos transacciones se solapan en el tiempo a propósito: la primera
    // inserta y se queda abierta; la segunda intenta insertar el mismo hueco y
    // queda bloqueada hasta que la primera confirma. Es exactamente lo que
    // ocurre con dos recepcionistas pulsando "Guardar" a la vez, y lo que
    // ninguna validación en código puede evitar.
    const primera = db.$transaction(async (tx) => {
      await tx.reserva.create({ data: datosReserva(DIEZ_A_ONCE) });
      await espera(600);
      return 'primera';
    });

    const segunda = db.$transaction(async (tx) => {
      await espera(150);
      await tx.reserva.create({ data: datosReserva({ desde: 630, hasta: 690 }) });
      return 'segunda';
    });

    const resultados = await Promise.allSettled([primera, segunda]);

    const cumplidas = resultados.filter((r) => r.status === 'fulfilled');
    const rechazadas = resultados.filter((r) => r.status === 'rejected');

    expect(cumplidas).toHaveLength(1);
    expect(rechazadas).toHaveLength(1);
    expect(esSolape((rechazadas[0] as PromiseRejectedResult).reason)).toBe(true);

    // Y lo que de verdad importa: en la agenda queda una sola cita.
    expect(await db.reserva.count()).toBe(1);
  });

  it('la transacción que falla no deja rastro de su reserva', async () => {
    const db = prisma();
    await crearReserva(DIEZ_A_ONCE);

    const error = await capturar(() =>
      db.$transaction(async (tx) => {
        await tx.reserva.create({ data: datosReserva({ desde: 900, hasta: 960 }) });
        // Esta choca: tiene que arrastrar consigo la anterior.
        await tx.reserva.create({ data: datosReserva({ desde: 630, hasta: 690 }) });
      }),
    );

    expect(esSolape(error)).toBe(true);
    // Solo la original: la cita de las 15:00 se fue con el rollback.
    expect(await db.reserva.count()).toBe(1);
  });
});

// ============================================================================
//  TRADUCCIÓN DEL ERROR CRUDO
// ============================================================================

describe('reservas_sin_solape_barbero: el error llega traducible', () => {
  it('Prisma lo entrega como error desconocido con el nombre de la restricción', async () => {
    await crearReserva(DIEZ_A_ONCE);

    const error = await capturar(() => crearReserva(DIEZ_A_ONCE));

    // Las restricciones de exclusión no tienen código propio en Prisma: llegan
    // envueltas, con el error de Postgres dentro del mensaje. Si algún día
    // Prisma las tipara mejor, esta prueba avisaría de que `esViolacionDe`
    // puede simplificarse.
    const esDePrisma =
      error instanceof Prisma.PrismaClientKnownRequestError ||
      error instanceof Prisma.PrismaClientUnknownRequestError;
    expect(esDePrisma).toBe(true);
    expect((error as Error).message).toContain('reservas_sin_solape_barbero');
  });

  it('esViolacionDe lo reconoce y no lo confunde con otras restricciones', async () => {
    await crearReserva(DIEZ_A_ONCE);

    const error = await capturar(() => crearReserva(DIEZ_A_ONCE));

    // Este reconocimiento es el que el filtro global convierte en
    // RESERVA_SOLAPADA → "Ese horario acaba de ocuparse", en lugar de un 500.
    expect(PrismaService.esViolacionDe(error, 'reservas_sin_solape_barbero')).toBe(true);
    expect(PrismaService.esViolacionDe(error, 'agenda_bloques_sin_solape')).toBe(false);
    expect(PrismaService.esDuplicado(error)).toBe(false);
    expect(CODIGOS_ERROR.RESERVA_SOLAPADA).toBe('RESERVA_SOLAPADA');
  });

  it('un código duplicado sí se reconoce como duplicado y no como solape', async () => {
    const primera = await crearReserva(DIEZ_A_ONCE);

    const error = await capturar(() =>
      prisma().reserva.create({
        data: { ...datosReserva({ desde: 900, hasta: 960 }), codigo: primera.codigo },
      }),
    );

    expect(PrismaService.esDuplicado(error)).toBe(true);
    expect(esSolape(error)).toBe(false);
  });
});
