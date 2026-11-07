import { describe, expect, it } from 'vitest';
import { crearUsuarioSchema } from '@cds/shared';

/**
 * Reglas de `crearUsuarioSchema`, con foco en la sede.
 *
 * El formulario del panel manda `sedeId: null` explícito cuando el rol no
 * necesita sede (`sedeId: necesitaSede ? sedeId : null`). Un `.optional()` a
 * secas rechaza `null` y solo acepta la ausencia del campo, así que crear un
 * administrador devolvía 422 con "Expected string, received null" mientras
 * editarlo funcionaba: `actualizarUsuarioSchema` sí era `.nullable()`.
 */

const SEDE = '3f1b7c1e-6d2a-4a3e-9f0b-2c8d1e5a7b94';

const base = {
  nombre: 'Ana',
  apellido: 'Pérez',
  email: 'ana@ejemplo.com',
  telefono: '+573001234567',
  password: 'EjemploSeguro1',
};

describe('crearUsuarioSchema · sede', () => {
  it('acepta sedeId null en los roles que no la necesitan', () => {
    for (const rol of ['ADMIN', 'CONTADOR'] as const) {
      const resultado = crearUsuarioSchema.safeParse({ ...base, rol, sedeId: null });
      expect(resultado.success, `${rol} con sedeId null`).toBe(true);
    }
  });

  it('acepta que sedeId venga ausente', () => {
    const resultado = crearUsuarioSchema.safeParse({ ...base, rol: 'ADMIN' });
    expect(resultado.success).toBe(true);
  });

  it('sigue exigiendo sede a barberos y recepcionistas, también con null', () => {
    for (const rol of ['BARBERO', 'RECEPCIONISTA'] as const) {
      const conNull = crearUsuarioSchema.safeParse({ ...base, rol, sedeId: null });
      expect(conNull.success, `${rol} con sedeId null`).toBe(false);
      if (!conNull.success) {
        expect(conNull.error.issues[0]?.path).toEqual(['sedeId']);
        expect(conNull.error.issues[0]?.message).toMatch(/necesita una sede/i);
      }

      const ausente = crearUsuarioSchema.safeParse({ ...base, rol });
      expect(ausente.success, `${rol} sin sedeId`).toBe(false);
    }
  });

  it('acepta barbero con una sede válida', () => {
    const resultado = crearUsuarioSchema.safeParse({ ...base, rol: 'BARBERO', sedeId: SEDE });
    expect(resultado.success).toBe(true);
  });

  it('rechaza un sedeId que no es uuid', () => {
    const resultado = crearUsuarioSchema.safeParse({ ...base, rol: 'BARBERO', sedeId: 'sede-1' });
    expect(resultado.success).toBe(false);
  });

  it('normaliza el celular colombiano a E.164', () => {
    const resultado = crearUsuarioSchema.safeParse({
      ...base,
      rol: 'ADMIN',
      sedeId: null,
      telefono: '300 123 4567',
    });
    expect(resultado.success).toBe(true);
    if (resultado.success) expect(resultado.data.telefono).toBe('+573001234567');
  });
});
