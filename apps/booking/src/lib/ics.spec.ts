import { describe, expect, it } from 'vitest';
import type { ReservaPublica } from '@cds/shared';
import { generarIcs } from './ics';

const reserva: ReservaPublica = {
  codigo: 'CDS-7F3K2M',
  estado: 'PENDIENTE',
  inicioEn: '2026-11-10T14:30:00.000Z',
  finEn: '2026-11-10T15:00:00.000Z',
  sede: {
    id: 's1',
    nombre: 'Sede Centro',
    direccion: 'Calle 10 #5-20, con coma',
    ciudad: 'Medellín',
    telefono: null,
    mapsUrl: null,
  },
  barbero: { id: 'b1', nombre: 'Andrés', bio: null, fotoUrl: null },
  servicios: [{ nombre: 'Corte', precio: 25000, duracionMinutos: 30 }],
  total: 25000,
};

describe('generarIcs', () => {
  const ics = generarIcs(reserva);

  it('es un calendario válido con un evento y finales de línea CRLF', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VEVENT');
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('pone inicio y fin en UTC', () => {
    expect(ics).toContain('DTSTART:20261110T143000Z');
    expect(ics).toContain('DTEND:20261110T150000Z');
  });

  it('usa el código como identificador estable del evento', () => {
    expect(ics).toContain('UID:CDS-7F3K2M@caballerosdelsenor');
  });

  it('escapa las comas del lugar', () => {
    expect(ics).toContain('LOCATION:Sede Centro\\, Calle 10 #5-20\\, con coma');
  });

  it('lista los servicios en la descripción', () => {
    expect(ics).toContain('Corte');
    expect(ics).toContain('CDS-7F3K2M');
  });
});
