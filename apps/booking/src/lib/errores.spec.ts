import { describe, expect, it } from 'vitest';
import { CODIGOS_ERROR, MENSAJES_ERROR } from '@cds/shared';
import { ErrorApi } from './api';
import { ERRORES_DE_HORARIO, mensajeDeError } from './errores';

const error = (codigo: string, mensaje = 'texto del servidor') => new ErrorApi(codigo, mensaje, 400);

describe('mensajeDeError', () => {
  it('toma el texto del catálogo por código, no el del servidor', () => {
    expect(mensajeDeError(error(CODIGOS_ERROR.RESERVA_SOLAPADA))).toBe(MENSAJES_ERROR.RESERVA_SOLAPADA);
  });

  it('usa el texto propio del canal público donde el del catálogo es del panel', () => {
    const texto = mensajeDeError(error(CODIGOS_ERROR.LIMITE_RESERVAS_ACTIVAS));
    expect(texto).not.toBe(MENSAJES_ERROR.LIMITE_RESERVAS_ACTIVAS);
    expect(texto).toMatch(/Ya tienes/);
  });

  it('un código desconocido cae al genérico, nunca al texto crudo del servidor', () => {
    expect(mensajeDeError(error('CODIGO_NUEVO'))).toBe(MENSAJES_ERROR.ERROR_INTERNO);
  });

  it('lo que no es un ErrorApi cae al genérico', () => {
    expect(mensajeDeError(new Error('boom'))).toBe(MENSAJES_ERROR.ERROR_INTERNO);
  });
});

describe('ERRORES_DE_HORARIO', () => {
  it('son los errores que se arreglan eligiendo otra hora, y solo esos', () => {
    expect([...ERRORES_DE_HORARIO].sort()).toEqual(
      [
        CODIGOS_ERROR.RESERVA_SOLAPADA,
        CODIGOS_ERROR.ANTELACION_INSUFICIENTE,
        CODIGOS_ERROR.HORARIO_FUERA_DE_JORNADA,
        CODIGOS_ERROR.BARBERO_NO_TRABAJA_ESE_DIA,
        CODIGOS_ERROR.SEDE_CERRADA,
        CODIGOS_ERROR.DIA_NO_LABORABLE,
        CODIGOS_ERROR.RESERVA_EN_EL_PASADO,
        CODIGOS_ERROR.FECHA_DEMASIADO_LEJANA,
      ].sort(),
    );
  });
});
