import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { CODIGOS_ERROR, type CrearReservaPublicaDto } from '@cds/shared';
import { ErrorNegocio } from '../../src/comun/excepciones/error-negocio.js';
import { DisponibilidadService } from '../../src/modulos/disponibilidad/disponibilidad.service.js';
import { GuardTokenGestion } from '../../src/modulos/publico/guard-token-gestion.js';
import { PublicoReservasService } from '../../src/modulos/publico/publico-reservas.service.js';
import { PublicoService } from '../../src/modulos/publico/publico.service.js';
import { ReservasService } from '../../src/modulos/reservas/reservas.service.js';
import { arrancarAplicacion, type AplicacionDePruebas } from './soporte/aplicacion.js';
import { cerrarConexion, prisma } from './soporte/conexion.js';
import { datosReserva, limpiarReservas, sembrar } from './soporte/semilla.js';
import {
  IDS_PUBLICO,
  PRECIO_SERVICIO,
  PREFIJO_TELEFONO,
  fechaEnDias,
  horaDeBogota,
  limpiarClientesPublicos,
  sembrarCanalPublico,
} from './soporte/semilla-publica.js';

/**
 * Canal público contra Postgres real y con el cableado real de Nest.
 *
 * Las unitarias del canal usan dobles de Prisma, y un doble no filtra, no tiene
 * restricciones, no devuelve los valores por defecto de las columnas y no
 * compite con nadie. Aquí los servicios son los que construye el contenedor, la
 * base es la de verdad, y lo que se comprueba es justo lo que un doble no puede
 * decir: el filtro `visibleWeb` aplicado por el motor, la restricción de
 * exclusión cuando dos clientes pulsan el mismo hueco, el token que deja de
 * existir al cancelar y la ventana entre «leer el estado» y «escribirlo» cuando
 * dos peticiones cancelan a la vez.
 *
 * Para las carreras no se confía en la suerte del calendario de Node: una
 * barrera obliga a que las dos peticiones hayan terminado de LEER antes de que
 * ninguna escriba. Así el resultado depende solo de lo que haga el motor (o el
 * código) en la escritura, y la prueba falla siempre —no «a veces»— si esa
 * garantía desaparece.
 *
 * Los teléfonos de la suite empiezan por `+57300555` para poder borrar solo sus
 * fichas. Se usa el reloj real, con citas a una semana vista.
 */

let aplicacion: AplicacionDePruebas;
let publico: PublicoReservasService;
let lecturas: PublicoService;
let dominio: ReservasService;
let motor: DisponibilidadService;
let guard: GuardTokenGestion;

/** Día de las citas de esta suite: lejos de la antelación mínima y del límite de 45 días. */
const DIA = fechaEnDias(7);
const DIEZ = horaDeBogota(DIA, '10:00');

/** Veces que se repite la carrera por el mismo hueco (ver el caso). */
const RONDAS_DE_CARRERA = 8;

const telefono = (n: number) => `${PREFIJO_TELEFONO}${String(n).padStart(4, '0')}`;

/** Cuerpo de una reserva web válido, con lo mínimo y un teléfono distinto por llamada. */
function cuerpo(n: number, extra: Partial<CrearReservaPublicaDto> = {}): CrearReservaPublicaDto {
  return {
    sedeId: IDS_PUBLICO.sede,
    servicioIds: [IDS_PUBLICO.servicio],
    inicioEn: DIEZ,
    cliente: { nombreCompleto: `Cliente ${n}`, telefono: telefono(n) },
    tokenTurnstile: 'token-de-pruebas',
    ...extra,
  };
}

/** Lo que haría `GuardTokenGestion` con la cabecera: devuelve la reserva o lanza. */
async function resolverToken(token: string) {
  const peticion: { headers: Record<string, string>; reservaPublica?: unknown } = {
    headers: { 'x-token-gestion': token },
  };
  const contexto = {
    switchToHttp: () => ({ getRequest: () => peticion }),
  } as unknown as ExecutionContext;
  await guard.canActivate(contexto);
  return peticion.reservaPublica as NonNullable<Awaited<ReturnType<typeof prisma.prototype.reserva.findUnique>>>;
}

/** Cita insertada directamente en la base, sin pasar por las reglas del canal. */
async function insertarCita(datos: {
  barberoId: string;
  inicioEn: string;
  minutos?: number;
  tokenGestion?: string;
}) {
  const inicio = new Date(datos.inicioEn);
  const fin = new Date(inicio.getTime() + (datos.minutos ?? 30) * 60_000);
  return prisma().reserva.create({
    data: {
      ...datosReserva({ desde: 0, hasta: 30 }),
      sedeId: IDS_PUBLICO.sede,
      barberoId: datos.barberoId,
      inicioEn: inicio,
      finEn: fin,
      finConBufferEn: fin,
      duracionMinutos: datos.minutos ?? 30,
      bufferMinutos: 0,
      ...(datos.tokenGestion ? { tokenGestion: datos.tokenGestion } : {}),
    },
  });
}

/**
 * Barrera de `n` participantes: nadie pasa hasta que todos han llegado. Si
 * alguno no llega en 5 s se suelta igual, y `llegados` deja constancia de que la
 * carrera no se montó como se pretendía.
 */
function barrera(n: number) {
  let llegados = 0;
  let abrir!: () => void;
  const puerta = new Promise<void>((resolver) => (abrir = resolver));
  return {
    get llegados() {
      return llegados;
    },
    async esperar(): Promise<void> {
      llegados += 1;
      if (llegados >= n) abrir();
      await Promise.race([puerta, new Promise<void>((r) => setTimeout(r, 5_000))]);
    },
  };
}

/** Captura el error de lo que debe fallar con un error de negocio. */
async function errorDe(accion: () => Promise<unknown>): Promise<ErrorNegocio> {
  try {
    await accion();
  } catch (error) {
    expect(error).toBeInstanceOf(ErrorNegocio);
    return error as ErrorNegocio;
  }
  throw new Error('Se esperaba un error de negocio y la operación se completó');
}

beforeAll(async () => {
  await sembrar();
  await sembrarCanalPublico();
  aplicacion = await arrancarAplicacion();
  const { app } = aplicacion;
  publico = app.get(PublicoReservasService);
  lecturas = app.get(PublicoService);
  dominio = app.get(ReservasService);
  motor = app.get(DisponibilidadService);
  guard = app.get(GuardTokenGestion, { strict: false });
});

beforeEach(async () => {
  await limpiarReservas();
  await limpiarClientesPublicos();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await limpiarReservas();
  await limpiarClientesPublicos();
  await aplicacion?.app.close();
  await cerrarConexion();
});

// ======================== Reglas que dependen del reloj ======================

describe('reglas de la reserva web con la base real', () => {
  it('crea la cita con los valores que pone el motor y los importes en Decimal', async () => {
    const creada = await publico.crearReserva(cuerpo(1));

    const fila = await prisma().reserva.findUniqueOrThrow({
      where: { id: (await resolverToken(creada.tokenGestion)).id },
      include: { servicios: true, cliente: true },
    });

    // Valores por defecto de columna y reglas del dominio, leídos de la tabla.
    expect(fila.canal).toBe('WEB');
    expect(fila.estado).toBe('CONFIRMADA'); // `requiereConfirmacion` es false por defecto
    expect(fila.confirmadaEn).not.toBeNull();
    expect(fila.finEn.getTime() - fila.inicioEn.getTime()).toBe(30 * 60_000);
    // Los importes viajan como Decimal de extremo a extremo.
    expect(fila.subtotal.toNumber()).toBe(PRECIO_SERVICIO);
    expect(fila.total.toNumber()).toBe(PRECIO_SERVICIO);
    expect(fila.descuento.toNumber()).toBe(0);
    // El servicio se congela en la cita.
    expect(fila.servicios).toHaveLength(1);
    expect(fila.servicios[0]!.precioSnapshot.toNumber()).toBe(PRECIO_SERVICIO);
    // Sin correo no hay consentimiento de correo; el de WhatsApp rige por defecto de columna.
    expect(fila.cliente?.aceptaEmail).toBe(false);
    expect(fila.cliente?.aceptaWhatsapp).toBe(true);
    // El barbero lo eligió el servidor entre los visibles.
    expect([IDS_PUBLICO.barberoA, IDS_PUBLICO.barberoB]).toContain(fila.barberoId);
  });

  it('rechaza una reserva web por debajo de la antelación mínima', async () => {
    // El próximo inicio de rejilla (cada 30 min): existe como hueco, pero queda
    // a menos de 60 minutos, la antelación mínima por defecto. Sin barbero
    // elegido, es el camino de `elegirBarbero`.
    const MEDIA_HORA = 30 * 60_000;
    const proximoHueco = new Date(Math.ceil((Date.now() + 60_000) / MEDIA_HORA) * MEDIA_HORA);

    const error = await errorDe(() =>
      publico.crearReserva(cuerpo(2, { inicioEn: proximoHueco.toISOString() })),
    );

    expect(error.codigo).toBe(CODIGOS_ERROR.ANTELACION_INSUFICIENTE);
    expect(await prisma().reserva.count()).toBe(0);
  });

  it('rechaza una hora que ya pasó, sin barbero elegido, como RESERVA_EN_EL_PASADO y no como «ocupado»', async () => {
    // Inicio de rejilla ya transcurrido: existe como hueco, con motivo PASADO.
    const MEDIA_HORA = 30 * 60_000;
    const yaPaso = new Date(Math.floor((Date.now() - 60_000) / MEDIA_HORA) * MEDIA_HORA);

    const error = await errorDe(() =>
      publico.crearReserva(cuerpo(30, { inicioEn: yaPaso.toISOString() })),
    );

    expect(error.codigo).toBe(CODIGOS_ERROR.RESERVA_EN_EL_PASADO);
    expect(await prisma().reserva.count()).toBe(0);
  });

  it('rechaza una fecha más allá de maxDiasAnticipacion', async () => {
    const dentroDeSesentaDias = horaDeBogota(fechaEnDias(60), '10:00');

    const error = await errorDe(() =>
      publico.crearReserva(cuerpo(3, { inicioEn: dentroDeSesentaDias })),
    );

    expect(error.codigo).toBe(CODIGOS_ERROR.FECHA_DEMASIADO_LEJANA);
    expect(await prisma().reserva.count()).toBe(0);
  });

  it('aplica el tope de reservas activas por teléfono: la tercera se rechaza', async () => {
    const mismoCliente = (hora: string) =>
      cuerpo(4, { inicioEn: horaDeBogota(DIA, hora) });

    await publico.crearReserva(mismoCliente('10:00'));
    await publico.crearReserva(mismoCliente('11:00'));
    const error = await errorDe(() => publico.crearReserva(mismoCliente('12:00')));

    expect(error.codigo).toBe(CODIGOS_ERROR.LIMITE_RESERVAS_ACTIVAS);
    expect(await prisma().reserva.count()).toBe(2);
  });

  it('reutiliza la ficha del mismo teléfono en dos reservas', async () => {
    await publico.crearReserva(cuerpo(5, { inicioEn: horaDeBogota(DIA, '10:00') }));
    await publico.crearReserva(cuerpo(5, { inicioEn: horaDeBogota(DIA, '11:00') }));

    const fichas = await prisma().cliente.findMany({ where: { telefono: telefono(5) } });
    expect(fichas).toHaveLength(1);

    const reservas = await prisma().reserva.findMany({ where: { clienteId: fichas[0]!.id } });
    expect(reservas).toHaveLength(2);
  });

  it('rechaza cancelar fuera de plazo y la cita sigue en pie con su token', async () => {
    // Dentro del plazo de 4 horas: se inserta directo porque la web no deja
    // reservar con tan poca antelación, pero la cita ya existe y el cliente
    // tiene su enlace.
    const dentroDeDosHoras = new Date(Date.now() + 2 * 3_600_000).toISOString();
    const cita = await insertarCita({
      barberoId: IDS_PUBLICO.barberoA,
      inicioEn: dentroDeDosHoras,
      tokenGestion: 'token-fuera-de-plazo',
    });
    const resuelta = await resolverToken('token-fuera-de-plazo');

    const error = await errorDe(() =>
      publico.cancelarPropia(resuelta, { tokenTurnstile: 'token-de-pruebas' }),
    );

    expect(error.codigo).toBe(CODIGOS_ERROR.FUERA_DE_PLAZO_CANCELACION);
    const despues = await prisma().reserva.findUniqueOrThrow({ where: { id: cita.id } });
    expect(despues.estado).toBe('CONFIRMADA');
    expect(despues.tokenGestion).toBe('token-fuera-de-plazo');
  });
});

// ================================ El token ===================================

describe('token de gestión', () => {
  it('deja el token inservible tras cancelar: ninguna reserva lo resuelve y la fila no lo conserva', async () => {
    const creada = await publico.crearReserva(cuerpo(6));
    const resuelta = await resolverToken(creada.tokenGestion);

    const cancelada = await publico.cancelarPropia(resuelta, { tokenTurnstile: 'token-de-pruebas' });

    expect(cancelada.estado).toBe('CANCELADA');
    const error = await errorDe(() => resolverToken(creada.tokenGestion));
    expect(error.codigo).toBe(CODIGOS_ERROR.TOKEN_INVALIDO);
    // No es que el guard mire el estado: la columna quedó a NULL.
    const fila = await prisma().reserva.findUniqueOrThrow({ where: { id: resuelta.id } });
    expect(fila.tokenGestion).toBeNull();
    expect(await prisma().reserva.count({ where: { tokenGestion: creada.tokenGestion } })).toBe(0);
  });
});

// ===================== reprogramar: la rejilla de la propia cita ==============

describe('disponibilidad de quien reprograma', () => {
  it('la cita devuelve el id del servicio reservado, para pedir la agenda sin emparejar por nombre', async () => {
    const creada = await publico.crearReserva(cuerpo(30));
    expect(creada.servicios.map((s) => s.servicioId)).toEqual([IDS_PUBLICO.servicio]);
    const relectura = await publico.miReserva(await resolverToken(creada.tokenGestion));
    expect(relectura.servicios.map((s) => s.servicioId)).toEqual([IDS_PUBLICO.servicio]);
  });

  it('su propia hora aparece ocupada para el público, pero libre al excluir la cita', async () => {
    const creada = await publico.crearReserva(cuerpo(31, { barberoId: IDS_PUBLICO.barberoA }));
    const resuelta = await resolverToken(creada.tokenGestion);
    const consulta = { sedeId: IDS_PUBLICO.sede, fecha: DIA, servicioIds: [IDS_PUBLICO.servicio], barberoId: resuelta.barberoId };

    const comoPublico = await lecturas.disponibilidad(consulta);
    expect(comoPublico.huecos.find((h) => h.inicioEn === DIEZ)?.disponible).toBe(false);

    const comoDuenio = await lecturas.disponibilidad(consulta, resuelta.id);
    expect(comoDuenio.huecos.find((h) => h.inicioEn === DIEZ)?.disponible).toBe(true);
  });

  it('excluir la propia cita no libera las de otros', async () => {
    const creada = await publico.crearReserva(cuerpo(32, { barberoId: IDS_PUBLICO.barberoA }));
    const resuelta = await resolverToken(creada.tokenGestion);
    await insertarCita({ barberoId: IDS_PUBLICO.barberoA, inicioEn: horaDeBogota(DIA, '11:00') });

    const { huecos } = await lecturas.disponibilidad(
      { sedeId: IDS_PUBLICO.sede, fecha: DIA, servicioIds: [IDS_PUBLICO.servicio], barberoId: resuelta.barberoId },
      resuelta.id,
    );
    expect(huecos.find((h) => h.inicioEn === horaDeBogota(DIA, '11:00'))?.disponible).toBe(false);
  });
});

// ============================= visibleWeb ====================================

describe('barbero oculto en la web, con el filtro aplicado por la base', () => {
  it('no aporta huecos: si los visibles están ocupados, el hueco no se ofrece aunque el oculto esté libre', async () => {
    // A y B ocupados a las 10:00; C (oculto) libre a esa hora.
    await insertarCita({ barberoId: IDS_PUBLICO.barberoA, inicioEn: DIEZ });
    await insertarCita({ barberoId: IDS_PUBLICO.barberoB, inicioEn: DIEZ });

    const { huecos, laborable } = await lecturas.disponibilidad({
      sedeId: IDS_PUBLICO.sede,
      fecha: DIA,
      servicioIds: [IDS_PUBLICO.servicio],
    });

    expect(laborable).toBe(true);
    expect(huecos.find((h) => h.inicioEn === DIEZ)?.disponible).toBe(false);
    // Control: otra hora sí se ofrece, así que la lista no está vacía por otra causa.
    expect(huecos.find((h) => h.inicioEn === horaDeBogota(DIA, '11:00'))?.disponible).toBe(true);
  });

  it('no se le asigna una cita aunque sea el único libre', async () => {
    await insertarCita({ barberoId: IDS_PUBLICO.barberoA, inicioEn: DIEZ });
    await insertarCita({ barberoId: IDS_PUBLICO.barberoB, inicioEn: DIEZ });

    const error = await errorDe(() => publico.crearReserva(cuerpo(7)));

    expect(error.codigo).toBe(CODIGOS_ERROR.RESERVA_SOLAPADA);
    // Solo existen las dos citas insertadas a mano: al oculto no se le asignó nada.
    expect(await prisma().reserva.count({ where: { barberoId: IDS_PUBLICO.barberoOculto } })).toBe(0);
  });

  it('no se puede reservar con él por su id, y no se distingue de uno que no existe', async () => {
    const error = await errorDe(() =>
      publico.crearReserva(cuerpo(8, { barberoId: IDS_PUBLICO.barberoOculto })),
    );

    expect(error.codigo).toBe(CODIGOS_ERROR.RECURSO_NO_ENCONTRADO);
    expect(error.getStatus()).toBe(404);
  });

  it('no aparece en las opciones del asistente', async () => {
    const opciones = await lecturas.opciones();
    const barberos = opciones.sedes.find((s) => s.id === IDS_PUBLICO.sede)?.barberos ?? [];

    expect(barberos.map((b) => b.id).sort()).toEqual(
      [IDS_PUBLICO.barberoA, IDS_PUBLICO.barberoB].sort(),
    );
  });
});

// ============================== Las carreras =================================

describe('carreras entre dos peticiones simultáneas', () => {
  it('dos reservas web en el mismo hueco: solo una entra, la otra recibe los huecos recalculados', async () => {
    // Las dos peticiones piden al MISMO barbero la misma hora. Se las obliga a
    // terminar de validar («¿está libre?») antes de que ninguna escriba: las dos
    // ven el hueco libre, las dos intentan insertar, y quien decide es la
    // restricción de exclusión de Postgres.
    //
    // Se repite varias veces porque el motor resuelve esta carrera por DOS
    // caminos según quién llegue al índice primero: la perdedora recibe 23P01
    // (violación de la exclusión) o, si las dos ya habían escrito su fila,
    // 40P01 (interbloqueo y una de las dos se aborta). El cliente debe ver lo
    // mismo en ambos casos.
    for (let ronda = 0; ronda < RONDAS_DE_CARRERA; ronda++) {
      await limpiarReservas();
      await limpiarClientesPublicos();

      const puerta = barrera(2);
      const original = motor.validarHueco.bind(motor);
      const espia = vi.spyOn(motor, 'validarHueco').mockImplementation(async (...argumentos) => {
        await original(...argumentos);
        await puerta.esperar();
      });

      const pedir = (n: number) =>
        publico.crearReserva(cuerpo(10 + n, { barberoId: IDS_PUBLICO.barberoA }));
      const resultados = await Promise.allSettled([pedir(1), pedir(2)]);
      espia.mockRestore();

      // Condición de la prueba: las dos validaron con el hueco libre.
      expect(puerta.llegados).toBe(2);

      const aceptadas = resultados.filter((r) => r.status === 'fulfilled');
      const rechazadas = resultados.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(aceptadas).toHaveLength(1);
      expect(rechazadas).toHaveLength(1);

      // La perdedora recibe un 409 de negocio (no un 500) con la rejilla repintable.
      const perdedora = rechazadas[0]!.reason as ErrorNegocio;
      expect(perdedora).toBeInstanceOf(ErrorNegocio);
      expect(perdedora.codigo).toBe(CODIGOS_ERROR.RESERVA_SOLAPADA);
      expect(perdedora.getStatus()).toBe(409);
      const { huecos } = perdedora.detalle as { huecos: { inicioEn: string; disponible: boolean }[] };
      expect(huecos.find((h) => h.inicioEn === DIEZ)?.disponible).toBe(false);

      // Y en la tabla hay una sola cita en ese hueco.
      expect(await prisma().reserva.count({ where: { barberoId: IDS_PUBLICO.barberoA } })).toBe(1);
    }
  });

  it('dos cancelaciones simultáneas con el mismo token: una cancela y la otra recibe ESTADO_RESERVA_INVALIDO', async () => {
    const creada = await publico.crearReserva(cuerpo(20));
    const resuelta = await resolverToken(creada.tokenGestion);

    // Las dos leen el estado (CONFIRMADA) antes de que ninguna escriba: es la
    // ventana entre el `obtener` y el `update` de `ReservasService.cancelar`.
    const puerta = barrera(2);
    const original = dominio.obtener.bind(dominio);
    vi.spyOn(dominio, 'obtener').mockImplementation(async (id) => {
      const leida = await original(id);
      await puerta.esperar();
      return leida;
    });

    const cancelar = () => publico.cancelarPropia(resuelta, { tokenTurnstile: 'token-de-pruebas' });
    const resultados = await Promise.allSettled([cancelar(), cancelar()]);

    expect(puerta.llegados).toBe(2);

    const aceptadas = resultados.filter((r) => r.status === 'fulfilled');
    const rechazadas = resultados.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(aceptadas).toHaveLength(1);
    expect(rechazadas).toHaveLength(1);
    expect((rechazadas[0]!.reason as ErrorNegocio).codigo).toBe(CODIGOS_ERROR.ESTADO_RESERVA_INVALIDO);

    // La cancelación ocurrió una sola vez: un solo asiento de auditoría.
    const asientos = await prisma().auditoria.count({
      where: { accion: 'CANCELAR_RESERVA', entidadId: resuelta.id },
    });
    expect(asientos).toBe(1);
  });

  it('dos reprogramaciones simultáneas con el mismo token: una mueve la cita y la otra recibe CONFLICTO, y el token devuelto es el que guarda la base', async () => {
    const creada = await publico.crearReserva(cuerpo(40));
    const resuelta = await resolverToken(creada.tokenGestion);

    // Las dos leen la cita antes de que ninguna escriba. Sin la escritura
    // condicional, las dos rotan el token: la respuesta de una lleva uno que la
    // base ya no tiene y el cliente pierde el acceso a su cita sin ver un error.
    const puerta = barrera(2);
    const original = dominio.obtener.bind(dominio);
    vi.spyOn(dominio, 'obtener').mockImplementation(async (id) => {
      const leida = await original(id);
      await puerta.esperar();
      return leida;
    });

    const mover = (hora: string) =>
      publico.reprogramarPropia(resuelta, {
        inicioEn: horaDeBogota(DIA, hora),
        tokenTurnstile: 'token-de-pruebas',
      });
    const resultados = await Promise.allSettled([mover('11:00'), mover('12:00')]);

    expect(puerta.llegados).toBe(2);

    const aceptadas = resultados.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof mover>>> => r.status === 'fulfilled',
    );
    const rechazadas = resultados.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(aceptadas).toHaveLength(1);
    expect(rechazadas).toHaveLength(1);
    expect((rechazadas[0]!.reason as ErrorNegocio).codigo).toBe(CODIGOS_ERROR.CONFLICTO);

    // El token que recibió el cliente es el que hay en la base.
    const fila = await prisma().reserva.findUniqueOrThrow({ where: { id: resuelta.id } });
    expect(fila.tokenGestion).toBe(aceptadas[0]!.value.tokenGestion);
    expect(fila.tokenGestion).not.toBe(creada.tokenGestion);
  });
});
