import { describe, expect, it } from 'vitest';
import { CODIGOS_ERROR } from '@cds/shared';
import { ErrorApi } from '@/lib/api';
import { esCaptchaRechazado } from './captcha';

describe('esCaptchaRechazado', () => {
  it('es VALIDACION con un fallo en tokenTurnstile', () => {
    expect(esCaptchaRechazado(new ErrorApi(CODIGOS_ERROR.VALIDACION, 'x', 400, { tokenTurnstile: ['inválido'] }))).toBe(true);
  });

  it('una validación de otros campos no es el captcha', () => {
    expect(esCaptchaRechazado(new ErrorApi(CODIGOS_ERROR.VALIDACION, 'x', 400, { nombre: ['corto'] }))).toBe(false);
    expect(esCaptchaRechazado(new ErrorApi(CODIGOS_ERROR.VALIDACION, 'x', 400))).toBe(false);
  });

  it('otro código con ese campo, o algo que no es un ErrorApi, tampoco', () => {
    expect(esCaptchaRechazado(new ErrorApi(CODIGOS_ERROR.CONFLICTO, 'x', 409, { tokenTurnstile: ['x'] }))).toBe(false);
    expect(esCaptchaRechazado(new Error('boom'))).toBe(false);
  });
});
