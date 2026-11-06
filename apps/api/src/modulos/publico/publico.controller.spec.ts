import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import {
  cancelarReservaPublicaSchema,
  consultarCalendarioPublicoSchema,
  consultarDisponibilidadPublicaSchema,
  crearReservaPublicaSchema,
  reprogramarReservaPublicaSchema,
} from '@cds/shared';
import type { ZodSchema, ZodTypeAny, output } from 'zod';
import { CLAVE_PUBLICO } from '../../comun/autenticacion/decoradores.js';
import { ErrorNegocio } from '../../comun/excepciones/error-negocio.js';
import { validar } from '../../comun/validacion/zod.pipe.js';
import { ID } from '../../../test/soporte/datos.js';
import { GuardTokenGestion } from './guard-token-gestion.js';
import { GuardTurnstile } from './guard-turnstile.js';
import { PublicoController } from './publico.controller.js';

/**
 * Suite de `PublicoController`.
 *
 * El controlador no decide nada: delega y declara metadatos (público, límite de
 * peticiones, captcha). Los metadatos se leen con `Reflect` porque son lo que
 * el framework ejecuta de verdad; el cuerpo se pasa por el mismo pipe
 * `validar()` que usa en producción.
 */

function montar() {
  const servicio = {
    opciones: vi.fn(),
    disponibilidad: vi.fn(),
    calendario: vi.fn(),
  };
  const reservas = {
    crearReserva: vi.fn(async () => ({ codigo: 'CDS-A1B2' })),
    miReserva: vi.fn(async () => ({ codigo: 'CDS-A1B2' })),
    cancelarPropia: vi.fn(async () => ({ codigo: 'CDS-A1B2' })),
    reprogramarPropia: vi.fn(async () => ({ codigo: 'CDS-A1B2' })),
  };
  return { controlador: new PublicoController(servicio as never, reservas as never), servicio, reservas };
}

const validarCon = <E extends ZodTypeAny>(esquema: E, valor: unknown): output<E> =>
  validar(esquema as unknown as ZodSchema<output<E>>).transform(valor, { type: 'body' });

const cuerpoCrear = (cambios: Record<string, unknown> = {}) => ({
  sedeId: ID.sede,
  servicioIds: [ID.servicioCorte],
  inicioEn: '2026-11-05T15:00:00.000Z',
  cliente: { nombreCompleto: 'Juan Pérez', telefono: '3001234567' },
  tokenTurnstile: 'token-del-widget',
  ...cambios,
});

/** Los métodos que Nest registra como ruta: los que llevan metadato `path`. */
const rutasDelControlador = () =>
  Object.getOwnPropertyNames(PublicoController.prototype)
    .filter((nombre) => nombre !== 'constructor')
    .filter((nombre) => {
      const metodo = (PublicoController.prototype as unknown as Record<string, unknown>)[nombre];
      return typeof metodo === 'function' && Reflect.getMetadata('path', metodo) !== undefined;
    });

describe('PublicoController: metadatos de todas las rutas', () => {
  it('encuentra las rutas del controlador (si no, la prueba de abajo no comprobaría nada)', () => {
    expect(rutasDelControlador()).toEqual(
      expect.arrayContaining(['opciones', 'disponibilidad', 'calendario', 'crearReserva']),
    );
  });

  it('toda ruta lleva @Publico(): un olvido daría un 401 en un endpoint público', () => {
    // Recorre las rutas en lugar de listarlas: la ruta que se añada mañana
    // queda cubierta sin tocar esta prueba.
    for (const nombre of rutasDelControlador()) {
      const metodo = (PublicoController.prototype as unknown as Record<string, unknown>)[nombre];
      expect(Reflect.getMetadata(CLAVE_PUBLICO, metodo as object), `la ruta ${nombre}`).toBe(true);
    }
  });
});

describe('PublicoController.crearReserva', () => {
  const manejador = PublicoController.prototype.crearReserva;

  it('delega en el servicio con el cuerpo ya validado', async () => {
    const { controlador, reservas } = montar();
    const datos = validarCon(crearReservaPublicaSchema, cuerpoCrear());

    await controlador.crearReserva(datos);

    expect(reservas.crearReserva).toHaveBeenCalledWith(datos);
  });

  it('declara el límite estricto de peticiones en crear: 5 por hora', () => {
    // Las claves `THROTTLER:LIMITdefault` y `THROTTLER:TTLdefault` son un detalle
    // interno de `@nestjs/throttler`: un salto de versión mayor puede renombrarlas
    // y entonces esta prueba fallaría sin que el límite haya cambiado. Es el precio
    // de comprobar lo que el framework lee de verdad; si falla tras actualizar,
    // revisa primero esos nombres.
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', manejador)).toBe(5);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', manejador)).toBe(60 * 60 * 1000);
  });

  it('declara el guard de Turnstile en crear', () => {
    expect(Reflect.getMetadata('__guards__', manejador)).toContain(GuardTurnstile);
  });

  it('es una ruta POST en /publico/reservas', () => {
    // RequestMethod.POST === 1
    expect(Reflect.getMetadata('method', manejador)).toBe(1);
    expect(Reflect.getMetadata('path', manejador)).toBe('reservas');
    expect(Reflect.getMetadata('path', PublicoController)).toBe('publico');
  });

  it('el pipe descarta lo que el canal público no admite', () => {
    const datos = validarCon(
      crearReservaPublicaSchema,
      cuerpoCrear({
        clienteId: ID.cliente,
        descuento: 50000,
        notaInterna: 'x',
        confirmar: false,
        aplicarPremioFidelidad: true,
        creadoPorId: ID.actor,
        canal: 'PANEL',
        estado: 'COMPLETADA',
      }),
    );
    expect(Object.keys(datos).sort()).toEqual(
      ['cliente', 'inicioEn', 'sedeId', 'servicioIds', 'tokenTurnstile'].sort(),
    );
  });

  it('el pipe exige el token de Turnstile y al menos un servicio', () => {
    for (const cuerpo of [
      cuerpoCrear({ tokenTurnstile: undefined }),
      cuerpoCrear({ servicioIds: [] }),
      cuerpoCrear({ cliente: undefined }),
    ]) {
      expect(() => validarCon(crearReservaPublicaSchema, cuerpo)).toThrow(ErrorNegocio);
    }
  });
});

describe('PublicoController: mi-reserva', () => {
  const proto = PublicoController.prototype;
  const GET = 0;
  const POST = 1;
  const reservaDelGuard = { id: ID.reserva } as never;

  it('las tres rutas cuelgan de mi-reserva con el verbo correcto', () => {
    expect(Reflect.getMetadata('method', proto.miReserva)).toBe(GET);
    expect(Reflect.getMetadata('path', proto.miReserva)).toBe('mi-reserva');
    expect(Reflect.getMetadata('method', proto.cancelarMiReserva)).toBe(POST);
    expect(Reflect.getMetadata('path', proto.cancelarMiReserva)).toBe('mi-reserva/cancelar');
    expect(Reflect.getMetadata('method', proto.reprogramarMiReserva)).toBe(POST);
    expect(Reflect.getMetadata('path', proto.reprogramarMiReserva)).toBe('mi-reserva/reprogramar');
  });

  it('las tres autentican con el token de gestión', () => {
    for (const ruta of [proto.miReserva, proto.cancelarMiReserva, proto.reprogramarMiReserva]) {
      expect(Reflect.getMetadata('__guards__', ruta)).toContain(GuardTokenGestion);
    }
  });

  it('la disponibilidad de la propia cita es un GET bajo mi-reserva, con token y sin captcha', () => {
    expect(Reflect.getMetadata('method', proto.miDisponibilidad)).toBe(GET);
    expect(Reflect.getMetadata('path', proto.miDisponibilidad)).toBe('mi-reserva/disponibilidad');
    expect(Reflect.getMetadata(CLAVE_PUBLICO, proto.miDisponibilidad)).toBe(true);
    expect(Reflect.getMetadata('__guards__', proto.miDisponibilidad)).toContain(GuardTokenGestion);
    expect(Reflect.getMetadata('__guards__', proto.miDisponibilidad)).not.toContain(GuardTurnstile);
  });

  it('la disponibilidad pública NO excluye ninguna reserva, mande lo que mande el cliente', async () => {
    const { controlador, servicio } = montar();
    const filtros = validarCon(consultarDisponibilidadPublicaSchema, {
      sedeId: ID.sede,
      fecha: '2026-11-09',
      servicioIds: ID.servicioCorte,
      excluirReservaId: ID.reserva,
    });
    await controlador.disponibilidad(filtros);
    expect(servicio.disponibilidad.mock.calls[0]).toHaveLength(1);
    expect(filtros).not.toHaveProperty('excluirReservaId');
  });

  it('miDisponibilidad excluye la cita que resolvió el token', async () => {
    const { controlador, servicio } = montar();
    const filtros = validarCon(consultarDisponibilidadPublicaSchema, {
      sedeId: ID.sede,
      fecha: '2026-11-09',
      servicioIds: ID.servicioCorte,
    });
    await controlador.miDisponibilidad(reservaDelGuard, filtros);
    expect(servicio.disponibilidad).toHaveBeenCalledWith(filtros, ID.reserva);
  });

  it('el calendario de la propia cita es un GET bajo mi-reserva, con token y sin captcha', () => {
    expect(Reflect.getMetadata('method', proto.miCalendario)).toBe(GET);
    expect(Reflect.getMetadata('path', proto.miCalendario)).toBe('mi-reserva/calendario');
    expect(Reflect.getMetadata(CLAVE_PUBLICO, proto.miCalendario)).toBe(true);
    expect(Reflect.getMetadata('__guards__', proto.miCalendario)).toContain(GuardTokenGestion);
    expect(Reflect.getMetadata('__guards__', proto.miCalendario)).not.toContain(GuardTurnstile);
  });

  it('el calendario público NO excluye ninguna reserva, mande lo que mande el cliente', async () => {
    const { controlador, servicio } = montar();
    const filtros = validarCon(consultarCalendarioPublicoSchema, {
      sedeId: ID.sede,
      desde: '2026-11-09',
      hasta: '2026-11-20',
      servicioIds: ID.servicioCorte,
      excluirReservaId: ID.reserva,
    });
    await controlador.calendario(filtros);
    expect(servicio.calendario.mock.calls[0]).toHaveLength(1);
    expect(filtros).not.toHaveProperty('excluirReservaId');
  });

  it('miCalendario excluye la cita que resolvió el token', async () => {
    const { controlador, servicio } = montar();
    const filtros = validarCon(consultarCalendarioPublicoSchema, {
      sedeId: ID.sede,
      desde: '2026-11-09',
      hasta: '2026-11-20',
      servicioIds: ID.servicioCorte,
    });
    await controlador.miCalendario(reservaDelGuard, filtros);
    expect(servicio.calendario).toHaveBeenCalledWith(filtros, ID.reserva);
  });

  it('Turnstile solo en los POST', () => {
    expect(Reflect.getMetadata('__guards__', proto.miReserva)).not.toContain(GuardTurnstile);
    expect(Reflect.getMetadata('__guards__', proto.cancelarMiReserva)).toContain(GuardTurnstile);
    expect(Reflect.getMetadata('__guards__', proto.reprogramarMiReserva)).toContain(GuardTurnstile);
  });

  it('delegan en el servicio con la reserva del guard y el cuerpo validado', async () => {
    const { controlador, reservas } = montar();
    const cancelar = validarCon(cancelarReservaPublicaSchema, { tokenTurnstile: 't' });
    const mover = validarCon(reprogramarReservaPublicaSchema, {
      inicioEn: '2026-11-07T15:00:00.000Z',
      tokenTurnstile: 't',
    });

    await controlador.miReserva(reservaDelGuard);
    await controlador.cancelarMiReserva(reservaDelGuard, cancelar);
    await controlador.reprogramarMiReserva(reservaDelGuard, mover);

    expect(reservas.miReserva).toHaveBeenCalledWith(reservaDelGuard);
    expect(reservas.cancelarPropia).toHaveBeenCalledWith(reservaDelGuard, cancelar);
    expect(reservas.reprogramarPropia).toHaveBeenCalledWith(reservaDelGuard, mover);
  });

  it('los esquemas exigen el token de Turnstile', () => {
    expect(() => validarCon(cancelarReservaPublicaSchema, {})).toThrow(ErrorNegocio);
    expect(() =>
      validarCon(reprogramarReservaPublicaSchema, { inicioEn: '2026-11-07T15:00:00.000Z' }),
    ).toThrow(ErrorNegocio);
  });
});
