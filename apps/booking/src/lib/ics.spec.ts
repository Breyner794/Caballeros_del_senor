import { describe, expect, it } from 'vitest';
import type { ReservaPublica } from '@cds/shared';
import { generarIcs, plegar } from './ics';

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
  servicios: [{ servicioId: 's1', nombre: 'Corte', precio: 25000, duracionMinutos: 30 }],
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

const octetos = (texto: string) => new TextEncoder().encode(texto).length;

describe('plegado de líneas (RFC 5545)', () => {
  it('no toca una línea corta', () => {
    expect(plegar('SUMMARY:Cita')).toBe('SUMMARY:Cita');
  });

  it('parte las líneas largas en tramos de 75 octetos como máximo y se pueden desplegar', () => {
    const larga = `DESCRIPTION:${'Corte clásico, barba y arreglo de cejas. '.repeat(6)}`;
    const plegada = plegar(larga);
    const lineas = plegada.split('\r\n');
    expect(lineas.length).toBeGreaterThan(1);
    for (const linea of lineas) expect(octetos(linea)).toBeLessThanOrEqual(75);
    for (const continuacion of lineas.slice(1)) expect(continuacion.startsWith(' ')).toBe(true);
    // Desplegar (quitar CRLF + espacio) devuelve la línea original.
    expect(plegada.replace(/\r\n /g, '')).toBe(larga);
  });

  it('cuenta octetos y no parte un carácter de varios octetos', () => {
    const acentos = `DESCRIPTION:${'ñ'.repeat(80)}`;
    const lineas = plegar(acentos).split('\r\n');
    for (const linea of lineas) expect(octetos(linea)).toBeLessThanOrEqual(75);
    expect(plegar(acentos).replace(/\r\n /g, '')).toBe(acentos);
  });

  it('el archivo completo con varios servicios no tiene líneas de más de 75 octetos', () => {
    const varios: ReservaPublica = {
      ...reserva,
      servicios: ['Corte clásico', 'Barba con toalla caliente', 'Arreglo de cejas', 'Limpieza facial'].map(
        (nombre, i) => ({ servicioId: `s${i}`, nombre, precio: 10000, duracionMinutos: 20 }),
      ),
    };
    for (const linea of generarIcs(varios).split('\r\n')) expect(octetos(linea)).toBeLessThanOrEqual(75);
  });
});
