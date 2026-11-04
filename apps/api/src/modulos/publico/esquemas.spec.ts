import { describe, expect, it } from 'vitest';
import {
  cancelarReservaPublicaSchema,
  clienteNuevoEnReservaSchema,
  consultarCalendarioPublicoSchema,
  consultarDisponibilidadPublicaSchema,
  crearReservaPublicaSchema,
  reprogramarReservaPublicaSchema,
} from '@cds/shared';
import { ID } from '../../../test/soporte/datos.js';

const base = {
  sedeId: ID.sede,
  servicioIds: [ID.servicioCorte],
  inicioEn: '2026-11-10T15:00:00.000Z',
  cliente: { nombreCompleto: 'Juan Pérez', telefono: '3001234567' },
  tokenTurnstile: 'token-de-prueba',
};

describe('crearReservaPublicaSchema', () => {
  it('rechaza los campos que solo puede usar el panel', () => {
    // clienteId, descuento, notaInterna, confirmar, aplicarPremioFidelidad
    // no existen en el esquema: el parseo los descarta en vez de aceptarlos.
    const salida = crearReservaPublicaSchema.parse({
      ...base,
      clienteId: ID.cliente,
      descuento: 5000,
      notaInterna: 'x',
      confirmar: false,
      aplicarPremioFidelidad: true,
    });
    expect(salida).not.toHaveProperty('clienteId');
    expect(salida).not.toHaveProperty('descuento');
    expect(salida).not.toHaveProperty('notaInterna');
    expect(salida).not.toHaveProperty('confirmar');
    expect(salida).not.toHaveProperty('aplicarPremioFidelidad');
  });

  it('normaliza el teléfono a E.164', () => {
    expect(
      crearReservaPublicaSchema.parse({
        ...base,
        cliente: { nombreCompleto: 'Juan Pérez', telefono: '300 123 4567' },
      }).cliente.telefono,
    ).toBe('+573001234567');
  });

  it('exige el token de Turnstile', () => {
    expect(crearReservaPublicaSchema.safeParse({ ...base, tokenTurnstile: undefined }).success).toBe(false);
  });

  it('acepta el correo como opcional y lo omite si no viene', () => {
    const sin = crearReservaPublicaSchema.parse(base);
    expect(sin.cliente.email).toBeUndefined();
    const con = crearReservaPublicaSchema.parse({
      ...base,
      cliente: { ...base.cliente, email: ' Juan@Correo.com ' },
    });
    expect(con.cliente.email).toBe('juan@correo.com');
    expect(
      crearReservaPublicaSchema.safeParse({ ...base, cliente: { ...base.cliente, email: 'no-es-correo' } }).success,
    ).toBe(false);
  });

  it('exige entre 1 y 6 servicios', () => {
    expect(crearReservaPublicaSchema.safeParse({ ...base, servicioIds: [] }).success).toBe(false);
    const siete = Array.from({ length: 7 }, () => ID.servicioCorte);
    expect(crearReservaPublicaSchema.safeParse({ ...base, servicioIds: siete }).success).toBe(false);
    const seis = Array.from({ length: 6 }, () => ID.servicioCorte);
    expect(crearReservaPublicaSchema.safeParse({ ...base, servicioIds: seis }).success).toBe(true);
  });

  it('el barbero es opcional', () => {
    expect(crearReservaPublicaSchema.parse(base).barberoId).toBeUndefined();
    expect(crearReservaPublicaSchema.parse({ ...base, barberoId: ID.barbero }).barberoId).toBe(ID.barbero);
  });
});

describe('clienteNuevoEnReservaSchema', () => {
  it('acepta el correo opcional del cliente creado al vuelo', () => {
    const salida = clienteNuevoEnReservaSchema.parse({
      nombreCompleto: 'Ana',
      telefono: '3001234567',
      email: 'ANA@correo.com',
    });
    expect(salida.email).toBe('ana@correo.com');
  });
});

describe('consultas públicas', () => {
  it('disponibilidad: acepta servicios como lista separada por comas', () => {
    const salida = consultarDisponibilidadPublicaSchema.parse({
      sedeId: ID.sede,
      fecha: '2026-11-10',
      servicioIds: `${ID.servicioCorte},${ID.servicioBarba}`,
    });
    expect(salida.servicioIds).toEqual([ID.servicioCorte, ID.servicioBarba]);
  });

  it('disponibilidad: exige al menos un servicio', () => {
    expect(
      consultarDisponibilidadPublicaSchema.safeParse({ sedeId: ID.sede, fecha: '2026-11-10' }).success,
    ).toBe(false);
  });

  it('calendario: rechaza un rango invertido', () => {
    expect(
      consultarCalendarioPublicoSchema.safeParse({
        sedeId: ID.sede,
        desde: '2026-11-20',
        hasta: '2026-11-10',
        servicioIds: ID.servicioCorte,
      }).success,
    ).toBe(false);
  });
});

describe('cancelar y reprogramar', () => {
  it('cancelar exige el token y deja el motivo opcional', () => {
    expect(cancelarReservaPublicaSchema.safeParse({}).success).toBe(false);
    expect(cancelarReservaPublicaSchema.safeParse({ tokenTurnstile: 't' }).success).toBe(true);
  });

  it('reprogramar exige hora y token', () => {
    expect(reprogramarReservaPublicaSchema.safeParse({ inicioEn: base.inicioEn }).success).toBe(false);
    expect(
      reprogramarReservaPublicaSchema.safeParse({ inicioEn: base.inicioEn, tokenTurnstile: 't' }).success,
    ).toBe(true);
  });
});
