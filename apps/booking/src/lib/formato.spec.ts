import { describe, expect, it } from 'vitest';
import {
  etiquetaFecha,
  etiquetaHora,
  fechaDeHoy,
  formatearDuracion,
  formatearPrecio,
  sumarDias,
} from './formato';

describe('formato', () => {
  it('formatea el precio en pesos sin decimales', () => {
    expect(formatearPrecio(35000, 'COP')).toMatch(/35\.000/);
    expect(formatearPrecio(35000, 'COP')).not.toMatch(/,00/);
  });

  it('formatea la duración en minutos y horas', () => {
    expect(formatearDuracion(30)).toBe('30 min');
    expect(formatearDuracion(60)).toBe('1 h');
    expect(formatearDuracion(75)).toBe('1 h 15 min');
  });

  it('calcula «hoy» en la zona del negocio, no en la del navegador', () => {
    // 02:00 UTC del día 7 son las 21:00 del día 6 en Bogotá.
    const ahora = new Date('2026-11-07T02:00:00Z');
    expect(fechaDeHoy('America/Bogota', ahora)).toBe('2026-11-06');
  });

  it('suma días cruzando el fin de mes', () => {
    expect(sumarDias('2026-11-28', 5)).toBe('2026-12-03');
  });

  it('escribe la fecha completa en español', () => {
    expect(etiquetaFecha('2026-11-06')).toBe('viernes, 6 de noviembre');
  });

  it('escribe la hora de 24 h en formato de 12 h', () => {
    expect(etiquetaHora('09:30')).toBe('9:30 a. m.');
    expect(etiquetaHora('12:00')).toBe('12:00 p. m.');
    expect(etiquetaHora('00:15')).toBe('12:15 a. m.');
    expect(etiquetaHora('17:45')).toBe('5:45 p. m.');
  });
});
