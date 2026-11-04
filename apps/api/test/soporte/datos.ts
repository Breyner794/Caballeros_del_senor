import { Prisma } from '@prisma/client';
import type { UsuarioAutenticado } from '../../src/comun/autenticacion/tipos.js';

/**
 * Datos de referencia para la suite.
 *
 * Todo gira alrededor de un día fijo: **martes 10 de marzo de 2026**, a las
 * 08:00 de Bogotá. Las reglas que se prueban (antelación mínima, "no se puede
 * reservar en el pasado", plazos de cancelación, el turno del walk-in del día)
 * dependen de la hora actual, así que la suite congela el reloj en vez de
 * calcular desplazamientos sobre `Date.now()` — un caso que depende de la hora
 * a la que corre el CI es un caso que un día falla sin que nadie haya tocado
 * nada.
 */

export const ZONA = 'America/Bogota';

/** Martes. Importa: la agenda semanal se indexa por día (0 = domingo). */
export const FECHA = '2026-03-10';
export const DIA_SEMANA_MARTES = 2;

/** 08:00 en Bogotá (UTC-5). */
export const AHORA = new Date('2026-03-10T13:00:00.000Z');

/** Minutos desde medianoche → instante UTC de ese momento en Bogotá. */
export const horaLocal = (minutos: number, fecha = FECHA): Date =>
  new Date(
    `${fecha}T${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}:00.000-05:00`,
  );

export const ID = {
  sede: '11111111-1111-4111-8111-111111111111',
  sedeAlterna: '11111111-1111-4111-8111-222222222222',
  barbero: '22222222-2222-4222-8222-111111111111',
  barberoAjeno: '22222222-2222-4222-8222-222222222222',
  cliente: '33333333-3333-4333-8333-111111111111',
  clienteGenerico: '33333333-3333-4333-8333-999999999999',
  servicioCorte: '44444444-4444-4444-8444-111111111111',
  servicioBarba: '44444444-4444-4444-8444-222222222222',
  servicioInactivo: '44444444-4444-4444-8444-333333333333',
  reserva: '55555555-5555-4555-8555-111111111111',
  actor: '66666666-6666-4666-8666-111111111111',
  producto: '77777777-7777-4777-8777-111111111111',
} as const;

export const configuracion = (cambios: Record<string, unknown> = {}) => ({
  id: 1,
  nombreNegocio: 'Caballeros del Señor',
  zonaHoraria: ZONA,
  moneda: 'COP',
  slotMinutosDefault: 30,
  bufferMinutosDefault: 0,
  minAntelacionMinutos: 60,
  maxDiasAnticipacion: 45,
  horasLimiteCancelacion: 4,
  horasLimiteReprogramacion: 4,
  permiteElegirBarbero: true,
  requiereConfirmacion: false,
  maxReservasActivasCliente: 2,
  ...cambios,
});

export const programaFidelidad = (cambios: Record<string, unknown> = {}) => ({
  id: 1,
  activo: true,
  sellosRequeridos: 7,
  diasValidezSello: null,
  diasValidezPremio: null,
  canjeGeneraSello: false,
  acumulaPorSede: false,
  ...cambios,
});

/** Recepcionista: ve y toca todas las agendas. */
export const actorRecepcion = (cambios: Partial<UsuarioAutenticado> = {}): UsuarioAutenticado =>
  ({
    id: ID.actor,
    nombre: 'Marta',
    apellido: 'Ruiz',
    email: 'marta@cds.test',
    rol: 'RECEPCIONISTA',
    sedeId: ID.sede,
    sedesPermitidas: [ID.sede],
    permisos: [
      'reservas:ver',
      'reservas:ver_todas',
      'reservas:crear',
      'reservas:editar',
      'reservas:cancelar',
      'reservas:completar',
    ],
    debeCambiarPassword: false,
    ...cambios,
  }) as UsuarioAutenticado;

/** Barbero: solo su propia agenda. Es el caso que hay que vigilar. */
export const actorBarbero = (cambios: Partial<UsuarioAutenticado> = {}): UsuarioAutenticado =>
  ({
    id: ID.barbero,
    nombre: 'Andrés',
    apellido: null,
    email: 'andres@cds.test',
    rol: 'BARBERO',
    sedeId: ID.sede,
    sedesPermitidas: [ID.sede],
    permisos: ['reservas:ver', 'reservas:editar'],
    debeCambiarPassword: false,
    ...cambios,
  }) as UsuarioAutenticado;

/** Fila de `Servicio` tal como la devuelve Prisma. */
export const servicio = (cambios: Record<string, unknown> = {}) => ({
  id: ID.servicioCorte,
  nombre: 'Corte clásico',
  precio: new Prisma.Decimal(30000),
  duracionMinutos: 30,
  bufferMinutos: null as number | null,
  canjeableFidelidad: true,
  cuentaFidelidad: true,
  activo: true,
  eliminadoEn: null,
  ...cambios,
});

/** Línea de servicio congelada dentro de la reserva. */
export const lineaServicio = (cambios: Record<string, unknown> = {}) => ({
  id: 'linea-1',
  reservaId: ID.reserva,
  servicioId: ID.servicioCorte,
  nombreSnapshot: 'Corte clásico',
  precioSnapshot: new Prisma.Decimal(30000),
  duracionSnapshot: 30,
  cubiertoPorCanje: false,
  orden: 0,
  ...cambios,
});

/**
 * Reserva completa, con la forma exacta que devuelve `obtener()`.
 *
 * Por defecto: confirmada, mañana a las 10:00, un corte de 30 000.
 */
export const reserva = (cambios: Record<string, unknown> = {}) => ({
  id: ID.reserva,
  codigo: 'CDS-A1B2',
  tokenGestion: 'tok_123',
  clienteId: ID.cliente,
  sedeId: ID.sede,
  barberoId: ID.barbero,
  creadoPorId: ID.actor,
  estado: 'CONFIRMADA',
  canal: 'PANEL',
  inicioEn: horaLocal(600, '2026-03-11'),
  finEn: horaLocal(630, '2026-03-11'),
  finConBufferEn: horaLocal(630, '2026-03-11'),
  duracionMinutos: 30,
  bufferMinutos: 0,
  subtotal: new Prisma.Decimal(30000),
  descuento: new Prisma.Decimal(0),
  total: new Prisma.Decimal(30000),
  turnoWalkIn: null,
  notaCliente: null,
  notaInterna: null,
  canceladaEn: null,
  canceladaPor: null,
  motivoCancelacion: null,
  iniciadaEn: null,
  completadaEn: null,
  cliente: {
    id: ID.cliente,
    nombreCompleto: 'Juan Pérez',
    telefono: '+573001234567',
    esGenerico: false,
    notas: null,
  },
  barbero: {
    id: ID.barbero,
    nombre: 'Andrés',
    apellido: null,
    alias: 'Andy',
    fotoUrl: null,
  },
  sede: { id: ID.sede, nombre: 'Sede Centro', direccion: 'Calle 1' },
  creadoPor: { id: ID.actor, nombre: 'Marta', rol: 'RECEPCIONISTA' },
  servicios: [lineaServicio()],
  canje: null,
  venta: null,
  ...cambios,
});

/** Venta devuelta por `ventas.registrarDesdeReserva`. */
export const venta = (cambios: Record<string, unknown> = {}) => ({
  id: '88888888-8888-4888-8888-111111111111',
  numero: 'V-0001',
  total: new Prisma.Decimal(30000),
  metodoPago: 'EFECTIVO',
  ...cambios,
});

/** Fila de `AgendaDia` con su barbero y bloques, como la lee disponibilidad. */
export const agendaDia = (cambios: Record<string, unknown> = {}) => ({
  id: 'agenda-1',
  usuarioId: ID.barbero,
  sedeId: ID.sede,
  diaSemana: DIA_SEMANA_MARTES,
  trabaja: true,
  horaInicio: 480, // 08:00
  horaFin: 1080, // 18:00
  slotMinutos: null as number | null,
  bloques: [] as { horaInicio: number; horaFin: number; tipo: string }[],
  usuario: {
    id: ID.barbero,
    nombre: 'Andrés',
    apellido: null,
    alias: 'Andy',
    fotoUrl: null,
    slotMinutos: null as number | null,
  },
  ...cambios,
});

export const horarioSede = (cambios: Record<string, unknown> = {}) => ({
  sedeId: ID.sede,
  diaSemana: DIA_SEMANA_MARTES,
  cerrado: false,
  horaInicio: 480,
  horaFin: 1080,
  ...cambios,
});
