import { Prisma } from '@prisma/client';
import { prisma } from './conexion.js';

/**
 * Semilla del canal público: lo que el motor de disponibilidad necesita para
 * ofrecer huecos de verdad (horario de la sede, agenda de cada barbero y un
 * servicio visible en la web).
 *
 * Tiene su propia sede y sus propios barberos, distintos de los de `semilla.ts`:
 * así los demás archivos de integración no ven agendas que no esperan, y esta
 * suite puede ocultar a un barbero sin tocar los de nadie más.
 */

export const IDS_PUBLICO = {
  sede: '44444444-4444-4444-8444-aaaaaaaaaaaa',
  servicio: '55555555-5555-4555-8555-aaaaaaaaaaaa',
  barberoA: '66666666-6666-4666-8666-aaaaaaaaaaaa',
  barberoB: '66666666-6666-4666-8666-bbbbbbbbbbbb',
  /** Activo pero con `visibleWeb: false`: la web no debe mostrarlo ni asignarlo. */
  barberoOculto: '66666666-6666-4666-8666-cccccccccccc',
} as const;

/**
 * Jornada de la sede y de los tres barberos: las 24 horas, todos los días.
 *
 * Es deliberado: las pruebas del canal público corren con el reloj real y
 * necesitan un hueco libre «dentro de la antelación mínima» a cualquier hora a
 * la que alguien lance la suite. Con una jornada de oficina fallarían de noche.
 */
const APERTURA = 0;
const CIERRE = 24 * 60;

/** Prefijo de los teléfonos de esta suite, para poder borrar solo sus fichas. */
export const PREFIJO_TELEFONO = '+57300555';

export const PRECIO_SERVICIO = 25000;

export async function sembrarCanalPublico(): Promise<void> {
  const db = prisma();

  await db.sede.upsert({
    where: { id: IDS_PUBLICO.sede },
    update: {},
    create: {
      id: IDS_PUBLICO.sede,
      nombre: 'Sede Pública',
      slug: 'sede-publica-pruebas',
      direccion: 'Calle 9 #8-7',
    },
  });

  await db.servicio.upsert({
    where: { id: IDS_PUBLICO.servicio },
    update: {},
    create: {
      id: IDS_PUBLICO.servicio,
      nombre: 'Corte clásico',
      slug: 'corte-clasico-pruebas',
      precio: new Prisma.Decimal(PRECIO_SERVICIO),
      duracionMinutos: 30,
      visibleWeb: true,
    },
  });

  const barberos = [
    [IDS_PUBLICO.barberoA, 'Andrés', true],
    [IDS_PUBLICO.barberoB, 'Beto', true],
    [IDS_PUBLICO.barberoOculto, 'Camilo', false],
  ] as const;

  for (const [id, nombre, visibleWeb] of barberos) {
    await db.usuario.upsert({
      where: { id },
      update: { visibleWeb, activo: true, eliminadoEn: null },
      create: {
        id,
        nombre,
        email: `${nombre.toLowerCase()}.publico@cds.test`,
        telefono: '+573001112233',
        passwordHash: 'hash-de-pruebas',
        rol: 'BARBERO',
        sedeId: IDS_PUBLICO.sede,
        visibleWeb,
      },
    });
  }

  for (let diaSemana = 0; diaSemana < 7; diaSemana++) {
    await db.sedeHorario.upsert({
      where: { sedeId_diaSemana: { sedeId: IDS_PUBLICO.sede, diaSemana } },
      update: { horaInicio: APERTURA, horaFin: CIERRE, cerrado: false },
      create: { sedeId: IDS_PUBLICO.sede, diaSemana, horaInicio: APERTURA, horaFin: CIERRE },
    });

    for (const [usuarioId] of barberos) {
      await db.agendaDia.upsert({
        where: { usuarioId_sedeId_diaSemana: { usuarioId, sedeId: IDS_PUBLICO.sede, diaSemana } },
        update: { horaInicio: APERTURA, horaFin: CIERRE, trabaja: true },
        create: {
          usuarioId,
          sedeId: IDS_PUBLICO.sede,
          diaSemana,
          horaInicio: APERTURA,
          horaFin: CIERRE,
        },
      });
    }
  }
}

/** Borra las fichas de cliente que crearon las pruebas de esta suite. */
export async function limpiarClientesPublicos(): Promise<void> {
  await prisma().cliente.deleteMany({ where: { telefono: { startsWith: PREFIJO_TELEFONO } } });
}

// ------------------------------------------------------------------ Fechas

/**
 * Fecha civil de Bogotá (`YYYY-MM-DD`) dentro de `dias` días.
 *
 * Las pruebas del canal público usan el reloj real: la antelación mínima, la
 * ventana de reserva y el plazo de cancelación se miden contra "ahora", así que
 * no hay un día fijo que valga para siempre.
 */
export function fechaEnDias(dias: number): string {
  const futuro = new Date(Date.now() + dias * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(futuro);
}

/** Instante ISO de una hora de reloj de Bogotá (UTC-5, sin horario de verano). */
export function horaDeBogota(fecha: string, hora: string): string {
  return new Date(`${fecha}T${hora}:00.000-05:00`).toISOString();
}
