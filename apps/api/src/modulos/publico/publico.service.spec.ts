import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  crearConfiguracionDoble,
  crearDisponibilidadDoble,
  crearPrismaDoble,
} from '../../../test/soporte/dobles.js';
import { Prisma } from '@prisma/client';
import { ID, configuracion } from '../../../test/soporte/datos.js';
import { CODIGOS_ERROR, ESTADOS_QUE_OCUPAN } from '@cds/shared';
import { ErrorNegocio } from '../../comun/excepciones/error-negocio.js';
import { PublicoService } from './publico.service.js';

const SEDE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SEDE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SEDE_VACIA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const sede = (id: string, nombre: string) => ({
  id,
  nombre,
  direccion: 'Calle 1',
  ciudad: 'Bogotá',
  telefono: '3000000000',
  mapsUrl: 'https://maps.example/x',
});

const barbero = (id: string, sedeId: string | null, otras: string[] = []) => ({
  id,
  nombre: `Barbero ${id}`,
  alias: null,
  bio: 'Cortes clásicos',
  fotoUrl: null,
  sedeId,
  sedesPermitidas: otras.map((s) => ({ sedeId: s })),
});

describe('PublicoService.opciones', () => {
  let prisma: ReturnType<typeof crearPrismaDoble>;
  let servicio: PublicoService;

  beforeEach(() => {
    prisma = crearPrismaDoble();
    prisma.sede.findMany.mockResolvedValue([sede(SEDE_A, 'Norte'), sede(SEDE_B, 'Sur')]);
    prisma.servicio.findMany.mockResolvedValue([]);
    prisma.usuario.findMany.mockResolvedValue([]);
    const config = crearConfiguracionDoble(configuracion());
    servicio = new PublicoService(prisma as never, config as never, crearDisponibilidadDoble() as never, {} as never);
  });

  it('solo ofrece sedes activas y no eliminadas', async () => {
    await servicio.opciones();
    expect(prisma.sede.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { activa: true, eliminadoEn: null } }),
    );
  });

  it('solo ofrece servicios activos y visibles en web', async () => {
    await servicio.opciones();
    expect(prisma.servicio.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ activo: true, visibleWeb: true, eliminadoEn: null }),
      }),
    );
  });

  it('solo ofrece barberos visibles con rol BARBERO', async () => {
    await servicio.opciones();
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

  it('pide a Prisma las columnas que el mapeador emite y ninguna sensible', async () => {
    await servicio.opciones();
    expect(prisma.sede.findMany.mock.calls[0]![0].select).toEqual({
      id: true,
      nombre: true,
      direccion: true,
      ciudad: true,
      telefono: true,
      mapsUrl: true,
    });
    expect(prisma.servicio.findMany.mock.calls[0]![0].select).toEqual({
      id: true,
      nombre: true,
      descripcion: true,
      incluye: true,
      precio: true,
      duracionMinutos: true,
    });
    expect(prisma.usuario.findMany.mock.calls[0]![0].select).toEqual({
      id: true,
      nombre: true,
      alias: true,
      bio: true,
      fotoUrl: true,
      sedeId: true,
      sedesPermitidas: { select: { sedeId: true } },
    });
  });

  it('agrupa los barberos por sede: uno habilitado en dos sedes aparece en las dos', async () => {
    prisma.usuario.findMany.mockResolvedValue([
      barbero('b1', SEDE_A, [SEDE_B]),
      barbero('b2', SEDE_B),
    ]);
    const { sedes } = await servicio.opciones();
    const idsDe = (id: string) => sedes.find((s) => s.id === id)!.barberos.map((b) => b.id);
    expect(idsDe(SEDE_A)).toEqual(['b1']);
    expect(idsDe(SEDE_B)).toEqual(['b1', 'b2']);
  });

  it('no repite un barbero cuya sede principal también está en sus sedes permitidas', async () => {
    prisma.usuario.findMany.mockResolvedValue([barbero('b1', SEDE_A, [SEDE_A])]);
    const { sedes } = await servicio.opciones();
    expect(sedes[0]!.barberos).toHaveLength(1);
  });

  it('no emite el barbero en sedes que no están en la respuesta', async () => {
    prisma.usuario.findMany.mockResolvedValue([barbero('b1', 'otra-sede-inactiva')]);
    const { sedes } = await servicio.opciones();
    expect(sedes.every((s) => s.barberos.length === 0)).toBe(true);
  });

  it('devuelve la configuración que el frontend necesita para comportarse igual que la API', async () => {
    const { config } = await servicio.opciones();
    expect(config).toEqual({
      permiteElegirBarbero: true,
      maxDiasAnticipacion: 45,
      minAntelacionMinutos: 60,
      zonaHoraria: 'America/Bogota',
      moneda: 'COP',
      nombreNegocio: 'Caballeros del Señor',
    });
  });

  it('no revienta con una sede sin barberos visibles', async () => {
    prisma.sede.findMany.mockResolvedValue([sede(SEDE_VACIA, 'Centro')]);
    const { sedes } = await servicio.opciones();
    expect(sedes).toHaveLength(1);
    expect(sedes[0]!.barberos).toEqual([]);
  });

  it('traduce con los mapeadores: alias en lugar de nombre y precio numérico', async () => {
    prisma.usuario.findMany.mockResolvedValue([{ ...barbero('b1', SEDE_A), alias: 'El Rey' }]);
    prisma.servicio.findMany.mockResolvedValue([
      {
        id: 's1',
        nombre: 'Corte',
        descripcion: null,
        incluye: [],
        precio: { toNumber: () => 25000 },
        duracionMinutos: 30,
      },
    ]);
    const { sedes, servicios } = await servicio.opciones();
    expect(sedes[0]!.barberos[0]).toEqual({
      id: 'b1',
      nombre: 'El Rey',
      bio: 'Cortes clásicos',
      fotoUrl: null,
    });
    expect(servicios[0]!.precio).toBe(25000);
  });
});

// ============================ Disponibilidad ================================

type MotivoInterno = 'OCUPADO' | 'ALMUERZO' | 'DESCANSO' | 'PASADO' | 'ANTELACION' | 'NO_CABE';

const FECHA = '2026-11-10';
const SERVICIO = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/** Huecos libres por hora, más un mapa hora → motivo para los no disponibles. */
const huecosDe = (libres: string[], noDisponibles: Record<string, MotivoInterno> = {}) => [
  ...libres.map((hora) => ({ inicioEn: `${FECHA}T${hora}:00.000Z`, hora, disponible: true })),
  ...Object.entries(noDisponibles).map(([hora, motivo]) => ({
    inicioEn: `${FECHA}T${hora}:00.000Z`,
    hora,
    disponible: false,
    motivo,
  })),
];

const agenda = (barberoId: string, huecos: ReturnType<typeof huecosDe>, trabaja = true) => ({
  barberoId,
  barberoNombre: `Nombre interno ${barberoId}`,
  alias: null,
  fotoUrl: null,
  trabaja,
  jornada: { horaInicio: 540, horaFin: 1080 },
  slotMinutos: 30,
  huecos,
  librestotal: huecos.filter((h) => h.disponible).length,
  ocupadosTotal: 0,
});

const respuestaDelDia = (barberos: ReturnType<typeof agenda>[], laborable = true) => ({
  fecha: FECHA,
  laborable,
  duracionNecesaria: 30,
  barberos,
});

describe('PublicoService.disponibilidad', () => {
  let prisma: ReturnType<typeof crearPrismaDoble>;
  let disponibilidad: ReturnType<typeof crearDisponibilidadDoble>;
  let servicio: PublicoService;

  const consultar = (barberoId?: string) =>
    servicio.disponibilidad({
      sedeId: SEDE_A,
      fecha: FECHA,
      servicioIds: [SERVICIO],
      ...(barberoId ? { barberoId } : {}),
    });

  beforeEach(() => {
    // Hoy es 2026-11-04 en Bogotá; con 45 días de anticipación el tope es 2026-12-19.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T15:00:00Z'));
    prisma = crearPrismaDoble();
    prisma.usuario.findMany.mockResolvedValue([{ id: 'bA' }, { id: 'bB' }]);
    disponibilidad = crearDisponibilidadDoble();
    disponibilidad.delDia.mockResolvedValue(
      respuestaDelDia([agenda('bA', huecosDe(['09:00'])), agenda('bB', huecosDe(['10:00']))]),
    );
    servicio = new PublicoService(
      prisma as never,
      crearConfiguracionDoble(configuracion()) as never,
      disponibilidad as never,
      {} as never,
    );
  });

  afterEach(() => vi.useRealTimers());

  it('una fecha pasada responde laborable false y huecos vacíos sin consultar al motor', async () => {
    const respuesta = await servicio.disponibilidad({
      sedeId: SEDE_A,
      fecha: '2020-01-01',
      servicioIds: [SERVICIO],
    });
    expect(respuesta).toEqual({ fecha: '2020-01-01', laborable: false, huecos: [] });
    expect(disponibilidad.delDia).not.toHaveBeenCalled();
  });

  it('una fecha más allá de maxDiasAnticipacion responde vacío sin consultar al motor', async () => {
    const respuesta = await servicio.disponibilidad({
      sedeId: SEDE_A,
      fecha: '2026-12-20',
      servicioIds: [SERVICIO],
    });
    expect(respuesta).toEqual({ fecha: '2026-12-20', laborable: false, huecos: [] });
    expect(disponibilidad.delDia).not.toHaveBeenCalled();
  });

  it('hoy y el último día permitido sí consultan al motor', async () => {
    for (const fecha of ['2026-11-04', '2026-12-19']) {
      await servicio.disponibilidad({ sedeId: SEDE_A, fecha, servicioIds: [SERVICIO] });
    }
    expect(disponibilidad.delDia).toHaveBeenCalledTimes(2);
  });

  it('pide la disponibilidad con las reglas del cliente activadas', async () => {
    await consultar();
    expect(disponibilidad.delDia).toHaveBeenCalledWith(
      expect.objectContaining({ aplicarReglasCliente: true, sedeId: SEDE_A, fecha: FECHA }),
    );
  });

  it('sin barbero elegido devuelve la unión de huecos libres de la sede', async () => {
    const { huecos } = await consultar();
    expect(huecos.map((h) => [h.hora, h.disponible])).toEqual([
      ['09:00', true],
      ['10:00', true],
    ]);
  });

  it('ordena la unión por hora, no por barbero', async () => {
    disponibilidad.delDia.mockResolvedValue(
      respuestaDelDia([agenda('bA', huecosDe(['11:00', '09:00'])), agenda('bB', huecosDe(['10:00']))]),
    );
    const { huecos } = await consultar();
    expect(huecos.map((h) => h.hora)).toEqual(['09:00', '10:00', '11:00']);
  });

  it('un instante libre en dos barberos aparece una sola vez', async () => {
    disponibilidad.delDia.mockResolvedValue(
      respuestaDelDia([agenda('bA', huecosDe(['09:00'])), agenda('bB', huecosDe(['09:00']))]),
    );
    const { huecos } = await consultar();
    expect(huecos).toHaveLength(1);
  });

  it('un hueco ocupado en todos los barberos sale como no disponible y sin motivo', async () => {
    disponibilidad.delDia.mockResolvedValue(
      respuestaDelDia([
        agenda('bA', huecosDe([], { '09:00': 'OCUPADO' })),
        agenda('bB', huecosDe([], { '09:00': 'OCUPADO' })),
      ]),
    );
    const { huecos } = await consultar();
    expect(huecos).toEqual([{ inicioEn: `${FECHA}T09:00:00.000Z`, hora: '09:00', disponible: false }]);
  });

  it('libre para un barbero y ocupado para otro sale disponible y sin motivo', async () => {
    disponibilidad.delDia.mockResolvedValue(
      respuestaDelDia([
        agenda('bA', huecosDe(['09:00'])),
        agenda('bB', huecosDe([], { '09:00': 'ALMUERZO' })),
      ]),
    );
    const { huecos } = await consultar();
    expect(huecos).toEqual([{ inicioEn: `${FECHA}T09:00:00.000Z`, hora: '09:00', disponible: true }]);
  });

  it('conserva el motivo solo si todos los barberos coinciden en ANTELACION o NO_CABE', async () => {
    disponibilidad.delDia.mockResolvedValue(
      respuestaDelDia([
        agenda('bA', huecosDe([], { '09:00': 'ANTELACION', '10:00': 'NO_CABE', '11:00': 'ANTELACION', '12:00': 'OCUPADO' })),
        agenda('bB', huecosDe([], { '09:00': 'ANTELACION', '10:00': 'NO_CABE', '11:00': 'NO_CABE', '12:00': 'OCUPADO' })),
      ]),
    );
    const { huecos } = await consultar();
    const motivoDe = (hora: string) => huecos.find((h) => h.hora === hora)!.motivo;
    expect(motivoDe('09:00')).toBe('ANTELACION');
    expect(motivoDe('10:00')).toBe('NO_CABE');
    expect(motivoDe('11:00')).toBeUndefined(); // motivos mezclados: pista sobre las agendas
    expect(motivoDe('12:00')).toBeUndefined();
    expect(huecos.find((h) => h.hora === '11:00')).not.toHaveProperty('motivo');
  });

  it('con barbero elegido devuelve solo los huecos de ese barbero', async () => {
    const { huecos } = await consultar('bB');
    expect(disponibilidad.delDia).toHaveBeenCalledWith(expect.objectContaining({ barberoId: 'bB' }));
    expect(huecos.map((h) => h.hora)).toEqual(['10:00']);
  });

  it('ignora a los barberos que no son visibles en la web', async () => {
    disponibilidad.delDia.mockResolvedValue(
      respuestaDelDia([agenda('bA', huecosDe(['09:00'])), agenda('oculto', huecosDe(['15:00']))]),
    );
    const { huecos } = await consultar();
    expect(huecos.map((h) => h.hora)).toEqual(['09:00']);
  });

  it('pide solo barberos activos, visibles y de la sede (principal o permitida)', async () => {
    await consultar();
    expect(prisma.usuario.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          rol: 'BARBERO',
          activo: true,
          visibleWeb: true,
          eliminadoEn: null,
          OR: [{ sedeId: SEDE_A }, { sedesPermitidas: { some: { sedeId: SEDE_A } } }],
        }),
        select: { id: true },
      }),
    );
  });

  it('un barbero elegido que no es visible no devuelve huecos', async () => {
    disponibilidad.delDia.mockResolvedValue(respuestaDelDia([agenda('oculto', huecosDe(['15:00']))]));
    const { huecos, laborable } = await consultar('oculto');
    expect(huecos).toEqual([]);
    expect(laborable).toBe(false);
  });

  it('no revela de quién es cada hueco en la unión', async () => {
    const respuesta = await consultar();
    for (const hueco of respuesta.huecos) {
      expect(Object.keys(hueco).join()).not.toMatch(/barbero/i);
    }
    expect(Object.keys(respuesta).sort()).toEqual(['fecha', 'huecos', 'laborable']);
    expect(JSON.stringify(respuesta)).not.toMatch(/barbero|bA|bB|Nombre interno/);
  });

  it('con una sede sin barberos visibles responde laborable false y huecos vacíos', async () => {
    prisma.usuario.findMany.mockResolvedValue([]);
    disponibilidad.delDia.mockResolvedValue(respuestaDelDia([]));
    const respuesta = await consultar();
    expect(respuesta).toEqual({ fecha: FECHA, laborable: false, huecos: [] });
  });

  it('un día que la sede no abre responde laborable false y huecos vacíos', async () => {
    disponibilidad.delDia.mockResolvedValue({ ...respuestaDelDia([], false), motivo: 'Festivo interno' });
    const respuesta = await consultar();
    expect(respuesta).toEqual({ fecha: FECHA, laborable: false, huecos: [] });
  });

  it('si ningún barbero visible trabaja ese día responde laborable false', async () => {
    disponibilidad.delDia.mockResolvedValue(
      respuestaDelDia([agenda('bA', [], false), agenda('bB', [], false)]),
    );
    const respuesta = await consultar();
    expect(respuesta.laborable).toBe(false);
    expect(respuesta.huecos).toEqual([]);
  });
});

// ============================== Calendario ==================================

describe('PublicoService.calendario', () => {
  let disponibilidad: ReturnType<typeof crearDisponibilidadDoble>;
  let servicio: PublicoService;

  const dia = (fecha: string, huecosLibres: number) => ({
    fecha,
    laborable: huecosLibres > 0,
    estado: 'libre' as const,
    totalHuecos: 10,
    huecosLibres,
    reservas: 3,
    etiqueta: 'Festivo interno',
  });

  beforeEach(() => {
    // Hoy es 2026-11-04 en Bogotá; con 45 días de anticipación el tope es 2026-12-19.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T15:00:00Z'));
    disponibilidad = crearDisponibilidadDoble();
    disponibilidad.calendario.mockResolvedValue([dia('2026-11-10', 4), dia('2026-11-11', 0)]);
    servicio = new PublicoService(
      crearPrismaDoble() as never,
      crearConfiguracionDoble(configuracion()) as never,
      disponibilidad as never,
      {} as never,
    );
  });

  afterEach(() => vi.useRealTimers());

  const consultar = (desde: string, hasta: string) =>
    servicio.calendario({ sedeId: SEDE_A, desde, hasta, servicioIds: [SERVICIO] });

  it('reduce cada día a fecha y si hay hueco', async () => {
    const dias = await consultar('2026-11-10', '2026-11-11');
    expect(dias).toEqual([
      { fecha: '2026-11-10', hayHueco: true },
      { fecha: '2026-11-11', hayHueco: false },
    ]);
    expect(Object.keys(dias[0]!).sort()).toEqual(['fecha', 'hayHueco']);
  });

  it('recorta el rango del calendario a maxDiasAnticipacion', async () => {
    await consultar('2026-11-10', '2027-03-01');
    expect(disponibilidad.calendario).toHaveBeenCalledWith(
      expect.objectContaining({ sedeId: SEDE_A, desde: '2026-11-10', hasta: '2026-12-19' }),
    );
  });

  it('pide el calendario con la duración elegida, las reglas del cliente y solo barberos visibles', async () => {
    await consultar('2026-11-10', '2026-11-11');
    expect(disponibilidad.calendario).toHaveBeenCalledWith(
      expect.objectContaining({
        servicioIds: [SERVICIO],
        aplicarReglasCliente: true,
        soloVisiblesWeb: true,
      }),
    );
  });

  it('recorta desde a hoy: no ofrece días pasados', async () => {
    await consultar('2026-10-01', '2026-11-11');
    expect(disponibilidad.calendario).toHaveBeenCalledWith(
      expect.objectContaining({ desde: '2026-11-04', hasta: '2026-11-11' }),
    );
  });

  it('un rango entero en el pasado devuelve vacío sin consultar', async () => {
    const dias = await consultar('2026-10-01', '2026-10-31');
    expect(dias).toEqual([]);
    expect(disponibilidad.calendario).not.toHaveBeenCalled();
  });

  it('no recorta un rango que ya cabe dentro del tope', async () => {
    await consultar('2026-11-10', '2026-11-20');
    expect(disponibilidad.calendario).toHaveBeenCalledWith(
      expect.objectContaining({ hasta: '2026-11-20' }),
    );
  });

  it('un rango entero más allá del tope devuelve vacío sin consultar', async () => {
    const dias = await consultar('2027-01-10', '2027-01-20');
    expect(dias).toEqual([]);
    expect(disponibilidad.calendario).not.toHaveBeenCalled();
  });
});

// ======================== Asignación automática ==============================

describe('PublicoService.elegirBarbero', () => {
  // 10:00 en Bogotá del 10 de noviembre de 2026.
  const INICIO = new Date('2026-11-10T15:00:00.000Z');
  const B1 = '00000000-0000-4000-8000-000000000001';
  const B2 = '00000000-0000-4000-8000-000000000002';
  const B3 = '00000000-0000-4000-8000-000000000003';

  let prisma: ReturnType<typeof crearPrismaDoble>;
  let disponibilidad: ReturnType<typeof crearDisponibilidadDoble>;
  let servicio: PublicoService;

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
    servicio = new PublicoService(
      prisma as never,
      crearConfiguracionDoble(configuracion()) as never,
      disponibilidad as never,
      {} as never,
    );
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

describe('PublicoService.crearReserva', () => {
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
  let servicio: PublicoService;

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
    servicio = new PublicoService(
      prisma as never,
      crearConfiguracionDoble(configuracion()) as never,
      disponibilidad as never,
      reservas as never,
    );
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
