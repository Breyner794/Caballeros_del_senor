import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { CODIGOS_ERROR, restarBloques } from '@cds/shared';
import { ReservasService } from '../../src/modulos/reservas/reservas.service.js';
import { DisponibilidadService } from '../../src/modulos/disponibilidad/disponibilidad.service.js';

describe('humo: el entorno de pruebas carga', () => {
  it('resuelve @cds/shared desde el fuente', () => {
    expect(CODIGOS_ERROR.RESERVA_SOLAPADA).toBe('RESERVA_SOLAPADA');
    expect(restarBloques({ horaInicio: 0, horaFin: 60 }, [])).toEqual([
      { horaInicio: 0, horaFin: 60 },
    ]);
  });

  it('carga el cliente de Prisma y sus decimales', () => {
    expect(new Prisma.Decimal('10.5').plus(1).toString()).toBe('11.5');
  });

  it('importa los servicios decorados con @Injectable', () => {
    expect(typeof ReservasService).toBe('function');
    expect(typeof DisponibilidadService).toBe('function');
  });
});
