/**
 * Fixtures compartidos por las pruebas del canal público: la agenda de un día
 * tal como la devuelve el motor de disponibilidad.
 */

export const SEDE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

export const sede = (id: string, nombre: string) => ({
  id,
  nombre,
  direccion: 'Calle 1',
  ciudad: 'Bogotá',
  telefono: '3000000000',
  mapsUrl: 'https://maps.example/x',
});

export type MotivoInterno = 'OCUPADO' | 'ALMUERZO' | 'DESCANSO' | 'PASADO' | 'ANTELACION' | 'NO_CABE';

export const FECHA = '2026-11-10';
export const SERVICIO = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/** Huecos libres por hora, más un mapa hora → motivo para los no disponibles. */
export const huecosDe = (libres: string[], noDisponibles: Record<string, MotivoInterno> = {}) => [
  ...libres.map((hora) => ({ inicioEn: `${FECHA}T${hora}:00.000Z`, hora, disponible: true })),
  ...Object.entries(noDisponibles).map(([hora, motivo]) => ({
    inicioEn: `${FECHA}T${hora}:00.000Z`,
    hora,
    disponible: false,
    motivo,
  })),
];

export const agenda = (barberoId: string, huecos: ReturnType<typeof huecosDe>, trabaja = true) => ({
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

export const respuestaDelDia = (barberos: ReturnType<typeof agenda>[], laborable = true) => ({
  fecha: FECHA,
  laborable,
  duracionNecesaria: 30,
  barberos,
});
