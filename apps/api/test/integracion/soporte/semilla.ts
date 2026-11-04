import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from './conexion.js';

/**
 * Semilla mínima para las pruebas de integración.
 *
 * Solo lo que exigen las claves ajenas de `reservas`: una sede, dos barberos y
 * un cliente. Nada de agenda, horarios ni servicios — estas pruebas no pasan
 * por el motor de disponibilidad, van directas contra las restricciones de la
 * base, que es justo lo que no se puede verificar con dobles.
 */

export const IDS = {
  sede: '11111111-1111-4111-8111-aaaaaaaaaaaa',
  sedeAlterna: '11111111-1111-4111-8111-bbbbbbbbbbbb',
  barbero: '22222222-2222-4222-8222-aaaaaaaaaaaa',
  barberoAjeno: '22222222-2222-4222-8222-bbbbbbbbbbbb',
  cliente: '33333333-3333-4333-8333-aaaaaaaaaaaa',
} as const;

/** Tablas que se vacían entre casos, en orden de dependencia. */
const TABLAS_VOLATILES = ['reserva_servicios', 'reservas'] as const;

export async function sembrar(): Promise<void> {
  const db = prisma();

  await db.sede.upsert({
    where: { id: IDS.sede },
    update: {},
    create: {
      id: IDS.sede,
      nombre: 'Sede Centro',
      slug: 'sede-centro-pruebas',
      direccion: 'Calle 1 #2-3',
    },
  });

  await db.sede.upsert({
    where: { id: IDS.sedeAlterna },
    update: {},
    create: {
      id: IDS.sedeAlterna,
      nombre: 'Sede Norte',
      slug: 'sede-norte-pruebas',
      direccion: 'Carrera 4 #5-6',
    },
  });

  for (const [id, nombre, email] of [
    [IDS.barbero, 'Andrés', 'andres.pruebas@cds.test'],
    [IDS.barberoAjeno, 'Luis', 'luis.pruebas@cds.test'],
  ] as const) {
    await db.usuario.upsert({
      where: { id },
      update: {},
      create: {
        id,
        nombre,
        email,
        telefono: '+573001112233',
        passwordHash: 'hash-de-pruebas',
        rol: 'BARBERO',
        sedeId: IDS.sede,
      },
    });
  }

  await db.cliente.upsert({
    where: { id: IDS.cliente },
    update: {},
    create: {
      id: IDS.cliente,
      nombreCompleto: 'Juan Pérez',
      telefono: '+573009998877',
    },
  });
}

/** Deja la tabla de reservas vacía sin tocar la semilla. */
export async function limpiarReservas(): Promise<void> {
  const db = prisma();
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLAS_VOLATILES.map((t) => `"${t}"`).join(', ')} CASCADE`,
  );
}

let secuenciaCodigo = 0;

export interface DatosReserva {
  /** Inicio en minutos desde la medianoche del día de referencia. */
  desde: number;
  /** Fin, buffer incluido, en minutos. Es el que mira la restricción. */
  hasta: number;
  barberoId?: string;
  sedeId?: string;
  estado?: 'PENDIENTE' | 'CONFIRMADA' | 'EN_CURSO' | 'COMPLETADA' | 'CANCELADA' | 'NO_ASISTIO';
  /** Fin visible para el cliente, si debe diferir de `hasta`. */
  finEn?: number;
  subtotal?: number;
  descuento?: number;
  total?: number;
  id?: string;
}

/** Día de referencia: todas las pruebas trabajan sobre el mismo. */
export const DIA = '2026-06-16';

export const instante = (minutos: number, dia = DIA): Date =>
  new Date(
    `${dia}T${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}:00.000Z`,
  );

/**
 * Construye el `data` de una reserva válida frente a los CHECK de la tabla.
 *
 * Se expone aparte del `create` para poder reutilizarlo dentro de una
 * transacción interactiva en la prueba de concurrencia.
 */
export function datosReserva(datos: DatosReserva): Prisma.ReservaUncheckedCreateInput {
  secuenciaCodigo += 1;
  const subtotal = datos.subtotal ?? 30000;
  const descuento = datos.descuento ?? 0;

  return {
    ...(datos.id ? { id: datos.id } : {}),
    codigo: `CDS-T${String(secuenciaCodigo).padStart(5, '0')}`,
    tokenGestion: `tok-pruebas-${secuenciaCodigo}`,
    clienteId: IDS.cliente,
    sedeId: datos.sedeId ?? IDS.sede,
    barberoId: datos.barberoId ?? IDS.barbero,
    estado: datos.estado ?? 'CONFIRMADA',
    inicioEn: instante(datos.desde),
    finEn: instante(datos.finEn ?? datos.hasta),
    finConBufferEn: instante(datos.hasta),
    duracionMinutos: (datos.finEn ?? datos.hasta) - datos.desde,
    bufferMinutos: datos.hasta - (datos.finEn ?? datos.hasta),
    subtotal: new Prisma.Decimal(subtotal),
    descuento: new Prisma.Decimal(descuento),
    total: new Prisma.Decimal(datos.total ?? subtotal - descuento),
  };
}

export const crearReserva = (
  datos: DatosReserva,
  db: PrismaClient | Prisma.TransactionClient = prisma(),
) => db.reserva.create({ data: datosReserva(datos) });

/** Pausa real: la prueba de concurrencia necesita solapar dos transacciones. */
export const espera = (ms: number): Promise<void> =>
  new Promise((resolver) => setTimeout(resolver, ms));
