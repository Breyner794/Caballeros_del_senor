import { describe, expect, it, vi } from 'vitest';
import {
  cancelarReservaSchema,
  completarReservaSchema,
  crearReservaSchema,
  crearWalkInSchema,
  listarReservasSchema,
  reprogramarReservaSchema,
} from '@cds/shared';
import type { ZodSchema, ZodTypeAny, output } from 'zod';
import { CODIGOS_ERROR } from '@cds/shared';
import { ErrorNegocio } from '../../comun/excepciones/error-negocio.js';
import { validar } from '../../comun/validacion/zod.pipe.js';
import { ReservasController } from './reservas.controller.js';
import { ID, actorRecepcion, horaLocal, reserva } from '../../../test/soporte/datos.js';

/**
 * Suite de `ReservasController`.
 *
 * El controlador tiene dos responsabilidades y aquí se prueban las dos por
 * separado:
 *
 *  1. **Delegar** — pasar al servicio lo que llega, con el usuario autenticado
 *     y, en el caso de cancelar, el origen correcto. Un `origen` equivocado no
 *     da error: simplemente aplica (o se salta) el plazo de cancelación del
 *     cliente, y eso solo se nota semanas después en una reclamación.
 *  2. **Validar** — los esquemas de Zod que declara en cada parámetro. Se
 *     ejercitan a través del mismo pipe `validar()` que usa en producción, de
 *     modo que lo que se comprueba es el contrato real de la API, incluidos los
 *     valores por defecto y las transformaciones (el teléfono que entra como
 *     "300 123 4567" y se guarda en E.164).
 *
 * Los permisos (`@RequierePermisos`) son metadatos que resuelve el guard, no el
 * controlador. Lo que sí se prueba, en la suite del servicio, es que el filtro
 * por barbero se aplique en la consulta y no solo en la interfaz.
 */

function montar() {
  const servicio = {
    listar: vi.fn(async () => ({ datos: [], meta: {} })),
    agendaDelDia: vi.fn(async () => ({ fecha: '2026-03-10', reservas: [], resumen: {} })),
    porCodigo: vi.fn(async () => reserva()),
    obtener: vi.fn(async () => reserva()),
    crear: vi.fn(async () => reserva()),
    crearWalkIn: vi.fn(async () => reserva()),
    reprogramar: vi.fn(async () => reserva()),
    cancelar: vi.fn(async () => reserva()),
    iniciar: vi.fn(async () => reserva()),
    marcarNoAsistio: vi.fn(async () => reserva()),
    completar: vi.fn(async () => ({ reserva: reserva() })),
  };
  return { controlador: new ReservasController(servicio as never), servicio };
}

/**
 * Pasa el valor por el mismo pipe que usa el controlador.
 *
 * El tipo devuelto es el de SALIDA del esquema, no el de entrada: en estos
 * esquemas no coinciden (hay `default()` y transformaciones), y es justamente
 * la salida lo que recibe el servicio.
 */
const validarCon = <E extends ZodTypeAny>(esquema: E, valor: unknown): output<E> =>
  validar(esquema as unknown as ZodSchema<output<E>>).transform(valor, { type: 'body' });

/** Ejecuta el pipe y devuelve el error de validación que produjo. */
function capturarValidacion(esquema: ZodTypeAny, valor: unknown): ErrorNegocio {
  try {
    validarCon(esquema, valor);
  } catch (error) {
    if (error instanceof ErrorNegocio) return error;
    throw error;
  }
  throw new Error('Se esperaba un error de validación, pero el valor se aceptó');
}

const cuerpoCrear = (cambios: Record<string, unknown> = {}) => ({
  sedeId: ID.sede,
  barberoId: ID.barbero,
  clienteId: ID.cliente,
  servicioIds: [ID.servicioCorte],
  inicioEn: horaLocal(600, '2026-03-11').toISOString(),
  ...cambios,
});

// ============================================================================
//  DELEGACIÓN
// ============================================================================

describe('ReservasController: delegación al servicio', () => {
  const usuario = actorRecepcion();

  it('listar pasa los filtros y el usuario', async () => {
    const { controlador, servicio } = montar();
    const filtros = { pagina: 1, limite: 20, orden: 'desc' as const };

    await controlador.listar(filtros as never, usuario);

    expect(servicio.listar).toHaveBeenCalledWith(filtros, usuario);
  });

  it('agendaDelDia pasa los filtros y el usuario', async () => {
    const { controlador, servicio } = montar();

    await controlador.agendaDelDia({ fecha: '2026-03-10' }, usuario);

    expect(servicio.agendaDelDia).toHaveBeenCalledWith({ fecha: '2026-03-10' }, usuario);
  });

  it('porCodigo y obtener delegan el identificador tal cual', async () => {
    const { controlador, servicio } = montar();

    await controlador.porCodigo('cds-a1b2');
    await controlador.obtener(ID.reserva);

    expect(servicio.porCodigo).toHaveBeenCalledWith('cds-a1b2');
    expect(servicio.obtener).toHaveBeenCalledWith(ID.reserva);
  });

  it('crear delega los datos validados y el actor', async () => {
    const { controlador, servicio } = montar();
    const datos = validarCon(crearReservaSchema, cuerpoCrear());

    await controlador.crear(datos, usuario);

    expect(servicio.crear).toHaveBeenCalledWith(datos, usuario);
  });

  it('walkIn delega en crearWalkIn', async () => {
    const { controlador, servicio } = montar();
    const datos = validarCon(crearWalkInSchema, cuerpoCrear({ inicioEn: undefined }));

    await controlador.walkIn(datos, usuario);

    expect(servicio.crearWalkIn).toHaveBeenCalledWith(datos, usuario);
  });

  it('reprogramar pasa el id de la reserva por separado', async () => {
    const { controlador, servicio } = montar();
    const datos = validarCon(reprogramarReservaSchema, {
      inicioEn: horaLocal(660, '2026-03-12').toISOString(),
    });

    await controlador.reprogramar(ID.reserva, datos, usuario);

    expect(servicio.reprogramar).toHaveBeenCalledWith(ID.reserva, datos, usuario);
  });

  it('cancelar marca el origen PANEL', async () => {
    const { controlador, servicio } = montar();
    const datos = validarCon(cancelarReservaSchema, { motivo: 'El cliente avisó' });

    await controlador.cancelar(ID.reserva, datos, usuario);

    // El origen decide si se aplica el plazo límite de cancelación: desde el
    // panel nunca, porque la recepción está hablando con el cliente.
    expect(servicio.cancelar).toHaveBeenCalledWith(ID.reserva, datos, usuario, 'PANEL');
  });

  it('iniciar y no-asistio delegan id y actor', async () => {
    const { controlador, servicio } = montar();

    await controlador.iniciar(ID.reserva, usuario);
    await controlador.noAsistio(ID.reserva, usuario);

    expect(servicio.iniciar).toHaveBeenCalledWith(ID.reserva, usuario);
    expect(servicio.marcarNoAsistio).toHaveBeenCalledWith(ID.reserva, usuario);
  });

  it('completar delega los datos de cobro', async () => {
    const { controlador, servicio } = montar();
    const datos = validarCon(completarReservaSchema, { metodoPago: 'TARJETA' });

    await controlador.completar(ID.reserva, datos, usuario);

    expect(servicio.completar).toHaveBeenCalledWith(ID.reserva, datos, usuario);
  });
});

// ============================================================================
//  VALIDACIÓN: CREAR
// ============================================================================

describe('Validación de crearReservaSchema', () => {
  it('acepta un cuerpo mínimo y rellena los valores por defecto', () => {
    const datos = validarCon(crearReservaSchema, cuerpoCrear());

    expect(datos).toMatchObject({
      descuento: 0,
      confirmar: true,
      aplicarPremioFidelidad: false,
    });
  });

  it('exige al menos un servicio', () => {
    const error = capturarValidacion(crearReservaSchema, cuerpoCrear({ servicioIds: [] }));

    expect(error.codigo).toBe(CODIGOS_ERROR.VALIDACION);
    expect(error.getStatus()).toBe(422);
    expect(error.campos?.['servicioIds']).toEqual(['Elige al menos un servicio']);
  });

  it('no admite más de seis servicios en una cita', () => {
    const error = capturarValidacion(
      crearReservaSchema,
      cuerpoCrear({ servicioIds: Array.from({ length: 7 }, () => ID.servicioCorte) }),
    );

    expect(error.campos?.['servicioIds']).toEqual(['Demasiados servicios en una sola cita']);
  });

  it('rechaza identificadores que no son UUID', () => {
    const error = capturarValidacion(crearReservaSchema, cuerpoCrear({ barberoId: '42' }));

    expect(error.campos?.['barberoId']).toEqual(['Identificador no válido']);
  });

  it('exige fecha y hora en ISO 8601 con zona', () => {
    const error = capturarValidacion(
      crearReservaSchema,
      cuerpoCrear({ inicioEn: '2026-03-11 10:00' }),
    );

    expect(error.campos?.['inicioEn']).toEqual(['La fecha y hora deben venir en formato ISO 8601']);
  });

  it('rechaza un descuento negativo', () => {
    const error = capturarValidacion(crearReservaSchema, cuerpoCrear({ descuento: -1000 }));

    expect(error.campos?.['descuento']).toEqual(['No puede ser negativo']);
  });

  it('no permite elegir cliente existente y crear uno nuevo a la vez', () => {
    const error = capturarValidacion(
      crearReservaSchema,
      cuerpoCrear({
        clienteNuevo: { nombreCompleto: 'Juan', telefono: '3001234567' },
      }),
    );

    expect(error.campos?.['clienteNuevo']).toEqual([
      'Elige un cliente existente o crea uno nuevo, no las dos cosas',
    ]);
  });

  it('normaliza el teléfono del cliente nuevo a E.164', () => {
    const datos = validarCon(
      crearReservaSchema,
      cuerpoCrear({
        clienteId: undefined,
        clienteNuevo: { nombreCompleto: '  Juan Pérez  ', telefono: '300 123 4567' },
      }),
    );

    // Guardar el teléfono tal cual lo escriben es cómo el mismo cliente acaba
    // tres veces en la base de datos.
    expect(datos.clienteNuevo).toEqual({
      nombreCompleto: 'Juan Pérez',
      telefono: '+573001234567',
      notas: undefined,
    });
  });

  it('rechaza un teléfono que no es un celular colombiano', () => {
    const error = capturarValidacion(
      crearReservaSchema,
      cuerpoCrear({
        clienteId: undefined,
        clienteNuevo: { nombreCompleto: 'Juan', telefono: '6015551234' },
      }),
    );

    expect(error.campos?.['clienteNuevo.telefono']).toEqual([
      'Un celular colombiano empieza por 3',
    ]);
  });

  it('exige el nombre del cliente nuevo', () => {
    const error = capturarValidacion(
      crearReservaSchema,
      cuerpoCrear({
        clienteId: undefined,
        clienteNuevo: { nombreCompleto: '   ', telefono: '3001234567' },
      }),
    );

    expect(error.campos?.['clienteNuevo.nombreCompleto']).toEqual([
      'El nombre del cliente es obligatorio',
    ]);
  });

  it('recorta las notas vacías a undefined en lugar de guardar cadenas vacías', () => {
    const datos = validarCon(crearReservaSchema, cuerpoCrear({ notaInterna: '   ' }));

    expect(datos.notaInterna).toBeUndefined();
  });

  it('acumula todos los errores del formulario en una sola respuesta', () => {
    const error = capturarValidacion(
      crearReservaSchema,
      cuerpoCrear({ barberoId: 'x', sedeId: 'y', servicioIds: [] }),
    );

    expect(Object.keys(error.campos ?? {}).sort()).toEqual(['barberoId', 'sedeId', 'servicioIds']);
  });
});

// ============================================================================
//  VALIDACIÓN: WALK-IN
// ============================================================================

describe('Validación de crearWalkInSchema', () => {
  it('acepta el walk-in sin hora: la API busca el hueco', () => {
    const datos = validarCon(crearWalkInSchema, cuerpoCrear({ inicioEn: undefined }));

    expect(datos.inicioEn).toBeUndefined();
    expect(datos).toMatchObject({ completarYCobrar: false, metodoPago: 'EFECTIVO' });
  });

  it('acepta forzar una hora concreta', () => {
    const inicio = horaLocal(660).toISOString();
    const datos = validarCon(crearWalkInSchema, cuerpoCrear({ inicioEn: inicio }));

    expect(datos.inicioEn).toBe(inicio);
  });

  it('rechaza un método de pago desconocido', () => {
    const error = capturarValidacion(
      crearWalkInSchema,
      cuerpoCrear({ inicioEn: undefined, metodoPago: 'BITCOIN' }),
    );

    expect(error.campos?.['metodoPago']).toBeDefined();
  });

  it('acepta CORTESIA como método de pago', () => {
    const datos = validarCon(
      crearWalkInSchema,
      cuerpoCrear({ inicioEn: undefined, metodoPago: 'CORTESIA' }),
    );

    expect(datos.metodoPago).toBe('CORTESIA');
  });
});

// ============================================================================
//  VALIDACIÓN: CAMBIOS DE ESTADO
// ============================================================================

describe('Validación de reprogramarReservaSchema', () => {
  it('exige la nueva hora y avisa al cliente por defecto', () => {
    const inicio = horaLocal(660, '2026-03-12').toISOString();
    const datos = validarCon(reprogramarReservaSchema, { inicioEn: inicio });

    expect(datos).toEqual({ inicioEn: inicio, notificar: true, motivo: undefined });
  });

  it('falla si no se envía la nueva hora', () => {
    const error = capturarValidacion(reprogramarReservaSchema, { motivo: 'cambio' });

    expect(error.campos?.['inicioEn']).toBeDefined();
  });

  it('acepta cambiar de sede y de barbero en el mismo gesto', () => {
    const datos = validarCon(reprogramarReservaSchema, {
      inicioEn: horaLocal(660, '2026-03-12').toISOString(),
      sedeId: ID.sedeAlterna,
      barberoId: ID.barberoAjeno,
    });

    expect(datos.sedeId).toBe(ID.sedeAlterna);
    expect(datos.barberoId).toBe(ID.barberoAjeno);
  });

  it('limita la longitud del motivo', () => {
    const error = capturarValidacion(reprogramarReservaSchema, {
      inicioEn: horaLocal(660, '2026-03-12').toISOString(),
      motivo: 'x'.repeat(501),
    });

    expect(error.campos?.['motivo']).toEqual(['No puede pasar de 500 caracteres']);
  });
});

describe('Validación de cancelarReservaSchema', () => {
  it('el motivo es opcional y se notifica por defecto', () => {
    expect(validarCon(cancelarReservaSchema, {})).toEqual({
      notificar: true,
      motivo: undefined,
    });
  });

  it('permite cancelar sin avisar al cliente', () => {
    expect(validarCon(cancelarReservaSchema, { notificar: false }).notificar).toBe(false);
  });
});

// ============================================================================
//  VALIDACIÓN: COBRO
// ============================================================================

describe('Validación de completarReservaSchema', () => {
  it('cobra en efectivo y sin productos si no se indica nada', () => {
    expect(validarCon(completarReservaSchema, {})).toMatchObject({
      metodoPago: 'EFECTIVO',
      productos: [],
      aplicarPremioFidelidad: false,
    });
  });

  it('acepta productos vendidos con la cita', () => {
    const datos = validarCon(completarReservaSchema, {
      productos: [{ productoId: ID.producto, cantidad: '2', precioUnitario: '12000' }],
    });

    // Vienen como texto desde el formulario y salen tipados.
    expect(datos.productos).toEqual([
      { productoId: ID.producto, cantidad: 2, precioUnitario: 12000 },
    ]);
  });

  it('rechaza cantidad cero', () => {
    const error = capturarValidacion(completarReservaSchema, {
      productos: [{ productoId: ID.producto, cantidad: 0 }],
    });

    expect(error.campos?.['productos.0.cantidad']).toBeDefined();
  });

  it('rechaza cantidades fraccionarias de producto', () => {
    const error = capturarValidacion(completarReservaSchema, {
      productos: [{ productoId: ID.producto, cantidad: 1.5 }],
    });

    expect(error.campos?.['productos.0.cantidad']).toBeDefined();
  });

  it('redondea el dinero a dos decimales', () => {
    const datos = validarCon(completarReservaSchema, { descuento: 1000.456 });

    expect(datos.descuento).toBe(1000.46);
  });
});

// ============================================================================
//  VALIDACIÓN: LISTADO (query string)
// ============================================================================

describe('Validación de listarReservasSchema', () => {
  it('aplica la paginación por defecto', () => {
    expect(validarCon(listarReservasSchema, {})).toMatchObject({
      pagina: 1,
      limite: 20,
      orden: 'desc',
    });
  });

  it('convierte los números que llegan como texto en la URL', () => {
    const datos = validarCon(listarReservasSchema, { pagina: '3', limite: '50' });

    expect(datos).toMatchObject({ pagina: 3, limite: 50 });
  });

  it('acota el límite máximo de página', () => {
    const error = capturarValidacion(listarReservasSchema, { limite: '500' });

    expect(error.campos?.['limite']).toBeDefined();
  });

  it('interpreta soloHoy=false como falso y no como verdadero', () => {
    // `z.coerce.boolean()` haría `Boolean('false') === true` y el filtro
    // devolvería justo lo contrario de lo pedido, sin error que lo delate.
    expect(validarCon(listarReservasSchema, { soloHoy: 'false' }).soloHoy).toBe(false);
    expect(validarCon(listarReservasSchema, { soloHoy: 'true' }).soloHoy).toBe(true);
    expect(validarCon(listarReservasSchema, { soloHoy: '0' }).soloHoy).toBe(false);
    expect(validarCon(listarReservasSchema, { soloHoy: 'si' }).soloHoy).toBe(true);
  });

  it('rechaza un soloHoy que no es booleano reconocible', () => {
    const error = capturarValidacion(listarReservasSchema, { soloHoy: 'quizá' });

    expect(error.campos?.['soloHoy']).toBeDefined();
  });

  it('normaliza la lista de estados venga suelta, repetida o separada por comas', () => {
    expect(validarCon(listarReservasSchema, { estados: 'PENDIENTE' }).estados).toEqual([
      'PENDIENTE',
    ]);
    expect(validarCon(listarReservasSchema, { estados: 'PENDIENTE,CONFIRMADA' }).estados).toEqual([
      'PENDIENTE',
      'CONFIRMADA',
    ]);
    expect(
      validarCon(listarReservasSchema, { estados: ['PENDIENTE', 'EN_CURSO'] }).estados,
    ).toEqual(['PENDIENTE', 'EN_CURSO']);
  });

  it('rechaza un estado que no existe', () => {
    const error = capturarValidacion(listarReservasSchema, { estado: 'ARCHIVADA' });

    expect(error.campos?.['estado']).toBeDefined();
  });

  it('exige el formato AAAA-MM-DD en el rango de fechas', () => {
    const error = capturarValidacion(listarReservasSchema, { desde: '10/03/2026' });

    expect(error.campos?.['desde']).toContain('La fecha debe venir como AAAA-MM-DD');
  });

  /**
   * HUECO CONOCIDO, no comportamiento deseado.
   *
   * `fechaSchema` comprueba el formato con una expresión regular y luego que
   * `Date.parse` no devuelva NaN. V8 no rechaza un día fuera de rango: lo
   * desborda al mes siguiente, así que "2026-02-30" pasa la validación y más
   * adelante se interpreta como el 2 de marzo. Un filtro de listado devuelve
   * días que nadie pidió sin que salte ningún error.
   *
   * Este caso queda escrito para que el hueco sea visible y para que, cuando
   * se arregle `fechaSchema`, la suite avise de que hay que invertirlo.
   */
  it('hoy acepta un 30 de febrero: el día inexistente se cuela', () => {
    expect(validarCon(listarReservasSchema, { desde: '2026-02-30' }).desde).toBe('2026-02-30');
  });

  it('sí rechaza un mes fuera de rango', () => {
    const error = capturarValidacion(listarReservasSchema, { desde: '2026-13-01' });

    expect(error.campos?.['desde']).toContain('Fecha no válida');
  });

  it('acepta un rango de fechas válido', () => {
    const datos = validarCon(listarReservasSchema, {
      desde: '2026-03-01',
      hasta: '2026-03-31',
    });

    expect(datos).toMatchObject({ desde: '2026-03-01', hasta: '2026-03-31' });
  });
});
