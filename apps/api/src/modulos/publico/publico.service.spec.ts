import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  crearConfiguracionDoble,
  crearDisponibilidadDoble,
  crearPrismaDoble,
} from '../../../test/soporte/dobles.js';
import { configuracion } from '../../../test/soporte/datos.js';
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
    servicio = new PublicoService(prisma as never, config as never, crearDisponibilidadDoble() as never);
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
    );
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
