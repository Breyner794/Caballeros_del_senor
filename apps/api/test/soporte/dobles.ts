import { vi, type Mock } from 'vitest';

/**
 * Dobles de las dependencias de los servicios.
 *
 * Los servicios se construyen a mano (`new ReservasService(...)`) en lugar de
 * levantar el contenedor de Nest. Es a propósito: lo que se quiere probar son
 * las reglas de negocio, y pasar por el módulo obligaría a declarar media
 * aplicación — con Prisma intentando conectarse — para comprobar que una cita
 * cancelada no se puede reprogramar.
 */

type ModeloDoble = {
  findUnique: Mock;
  findFirst: Mock;
  findMany: Mock;
  create: Mock;
  update: Mock;
  updateMany: Mock;
  upsert: Mock;
  delete: Mock;
  count: Mock;
  aggregate: Mock;
};

const modelo = (): ModeloDoble => ({
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  upsert: vi.fn(),
  delete: vi.fn(),
  count: vi.fn(),
  aggregate: vi.fn(),
});

const MODELOS = [
  'reserva',
  'reservaServicio',
  'cliente',
  'servicio',
  'usuario',
  'sede',
  'sedeHorario',
  'agendaDia',
  'agendaExcepcion',
  'diaEspecial',
  'selloFidelidad',
  'canjeFidelidad',
  'configuracionGlobal',
  'programaFidelidad',
  'notificacion',
  'plantillaNotificacion',
] as const;

export type PrismaDoble = Record<(typeof MODELOS)[number], ModeloDoble> & {
  $transaction: Mock;
  /** El cliente transaccional que recibe el callback: comparte los mismos dobles. */
  tx: Record<(typeof MODELOS)[number], ModeloDoble>;
};

/**
 * Doble de `PrismaService`.
 *
 * `$transaction` ejecuta el callback de verdad, pasándole los **mismos** dobles
 * que el cliente de fuera. Así una aserción sobre `prisma.reserva.update` vale
 * igual si la escritura ocurrió dentro o fuera de la transacción, y a cambio se
 * puede comprobar lo que de verdad importa: que la operación de cobro lo haga
 * todo en un solo `$transaction` y que, si algo revienta dentro, nada de lo que
 * va después (auditoría incluida) llegue a ejecutarse.
 *
 * También acepta la forma de arreglo (`$transaction([a, b])`) que usan los
 * listados para traer página y total de una vez.
 */
export function crearPrismaDoble(): PrismaDoble {
  const modelos = Object.fromEntries(MODELOS.map((nombre) => [nombre, modelo()])) as Record<
    (typeof MODELOS)[number],
    ModeloDoble
  >;

  const prisma = {
    ...modelos,
    tx: modelos,
    $transaction: vi.fn(async (arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      return (arg as (tx: unknown) => Promise<unknown>)(modelos);
    }),
  } as PrismaDoble;

  return prisma;
}

export interface ConfiguracionDoble {
  obtener: Mock;
  obtenerFidelidad: Mock;
  zonaHoraria: Mock;
  slotEfectivo: Mock;
  bufferEfectivo: Mock;
  invalidar: Mock;
}

/**
 * Doble de `ConfiguracionNegocioService`.
 *
 * `slotEfectivo` replica la cadena de herencia real (día → usuario → global)
 * en lugar de devolver un número fijo: esa herencia decide la rejilla de
 * horarios, y falsearla haría que las pruebas de disponibilidad comprobaran
 * una cuadrícula que no existe en producción.
 */
export function crearConfiguracionDoble(
  config: Record<string, unknown>,
  fidelidad: Record<string, unknown> = {},
): ConfiguracionDoble {
  const doble: ConfiguracionDoble = {
    obtener: vi.fn(async () => config),
    obtenerFidelidad: vi.fn(async () => fidelidad),
    zonaHoraria: vi.fn(async () => config['zonaHoraria'] as string),
    slotEfectivo: vi.fn(
      async (opciones: { slotDelDia?: number | null; slotDelUsuario?: number | null }) =>
        opciones.slotDelDia ?? opciones.slotDelUsuario ?? (config['slotMinutosDefault'] as number),
    ),
    bufferEfectivo: vi.fn(
      async (buffer?: number | null) => buffer ?? (config['bufferMinutosDefault'] as number),
    ),
    invalidar: vi.fn(),
  };
  return doble;
}

export function crearAuditoriaDoble() {
  return { registrar: vi.fn(async (_datos: unknown) => undefined) };
}

export function crearDisponibilidadDoble() {
  return {
    delDia: vi.fn(),
    validarHueco: vi.fn(async (_opciones?: unknown) => undefined),
    primerHuecoLibre: vi.fn(),
    calendario: vi.fn(),
  };
}

export function crearClientesDoble() {
  return {
    crear: vi.fn(),
    clienteGenerico: vi.fn(),
    recalcularMetricas: vi.fn(async (_clienteId?: unknown, _tx?: unknown) => undefined),
  };
}

export function crearFidelidadDoble() {
  return {
    canjear: vi.fn(),
    generarSello: vi.fn(async (_tx?: unknown, _datos?: unknown) => true),
    estado: vi.fn(async (_clienteId?: unknown) => ({ sellos: 0, premiosDisponibles: 0 })),
  };
}

export function crearVentasDoble() {
  return { registrarDesdeReserva: vi.fn() };
}
