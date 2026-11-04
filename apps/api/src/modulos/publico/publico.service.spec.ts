import { beforeEach, describe, expect, it } from 'vitest';
import { crearConfiguracionDoble, crearPrismaDoble } from '../../../test/soporte/dobles.js';
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
    servicio = new PublicoService(prisma as never, config as never);
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
