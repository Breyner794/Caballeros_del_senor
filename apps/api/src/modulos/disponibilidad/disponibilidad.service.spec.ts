import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { CODIGOS_ERROR } from '@cds/shared';
import { ErrorNegocio } from '../../comun/excepciones/error-negocio.js';
import { DisponibilidadService } from './disponibilidad.service.js';
import {
  AHORA,
  DIA_SEMANA_MARTES,
  FECHA,
  ID,
  agendaDia,
  configuracion,
  horaLocal,
  horarioSede,
  servicio,
} from '../../../test/soporte/datos.js';
import {
  crearConfiguracionDoble,
  crearPrismaDoble,
  type PrismaDoble,
} from '../../../test/soporte/dobles.js';

/**
 * Suite de `DisponibilidadService`.
 *
 * Este servicio es el que decide qué horas se ofrecen, y las mismas cuentas
 * alimentan tres sitios a la vez: la rejilla del panel, el calendario del
 * cliente en la web y la validación al guardar una cita. Un error aquí no se
 * ve como un error — se ve como dos clientes citados a la misma hora, o como
 * una agenda que parece llena cuando está vacía.
 *
 * Las pruebas atacan las siete capas del cálculo por separado y luego juntas:
 *
 *   1. festivos y días especiales      5. almuerzos y descansos
 *   2. horario de la sede              6. citas ya existentes (con su buffer)
 *   3. plantilla semanal del barbero   7. generación de inicios por slot
 *   4. excepciones de fecha concreta
 *
 * El motor de horarios de `@cds/shared` (`restarBloques`, `generarInicios`,
 * `seSolapan`) se usa **real**, no simulado: es la aritmética que se quiere
 * verificar. Lo único que se sustituye es Prisma y la configuración.
 *
 * Escenario base: martes 10/03/2026, sede abierta de 08:00 a 18:00, un barbero
 * con la misma jornada, slot de 30 minutos y un corte de 30 minutos sin buffer
 * → 20 inicios, de 08:00 a 17:30. Reloj congelado a las 08:00 de Bogotá para
 * que ninguna hora caiga "en el pasado" por accidente.
 */

interface Entorno {
  servicio: DisponibilidadService;
  prisma: PrismaDoble;
  configuracion: ReturnType<typeof crearConfiguracionDoble>;
}

function montar(cambiosConfig: Record<string, unknown> = {}): Entorno {
  const prisma = crearPrismaDoble();
  const config = crearConfiguracionDoble(configuracion(cambiosConfig));
  return {
    servicio: new DisponibilidadService(prisma as never, config as never),
    prisma,
    configuracion: config,
  };
}

/** Escenario base: sede abierta, un barbero de 8 a 18, un corte de 30 min. */
function escenarioBase(
  entorno: Entorno,
  opciones: {
    agendas?: Record<string, unknown>[];
    sede?: Record<string, unknown> | null;
    diaEspecial?: Record<string, unknown> | null;
    excepciones?: Record<string, unknown>[];
    reservas?: Record<string, unknown>[];
    servicios?: Record<string, unknown>[];
  } = {},
): void {
  entorno.prisma.diaEspecial.findFirst.mockResolvedValue(opciones.diaEspecial ?? null);
  entorno.prisma.sedeHorario.findUnique.mockResolvedValue(
    opciones.sede === undefined ? horarioSede() : opciones.sede,
  );
  entorno.prisma.agendaDia.findMany.mockResolvedValue(opciones.agendas ?? [agendaDia()]);
  entorno.prisma.agendaExcepcion.findMany.mockResolvedValue(opciones.excepciones ?? []);
  entorno.prisma.reserva.findMany.mockResolvedValue(opciones.reservas ?? []);
  entorno.prisma.servicio.findMany.mockResolvedValue(
    opciones.servicios ?? [{ id: ID.servicioCorte, duracionMinutos: 30, bufferMinutos: null }],
  );
}

const consulta = (cambios: Record<string, unknown> = {}) => ({
  sedeId: ID.sede,
  barberoId: ID.barbero,
  fecha: FECHA,
  servicioIds: [ID.servicioCorte],
  ...cambios,
});

/** Cita ya existente, en la forma reducida que lee el motor. */
const ocupacion = (inicioMin: number, finConBufferMin: number, fecha = FECHA) => ({
  barberoId: ID.barbero,
  inicioEn: horaLocal(inicioMin, fecha),
  finConBufferEn: horaLocal(finConBufferMin, fecha),
});

async function capturar(accion: () => Promise<unknown>): Promise<ErrorNegocio> {
  try {
    await accion();
  } catch (error) {
    if (error instanceof ErrorNegocio) return error;
    throw error;
  }
  throw new Error('Se esperaba un ErrorNegocio, pero la operación terminó sin fallar');
}

/** Minutos del día de cada hueco devuelto, para comparar sin arrastrar ISO. */
const minutosDe = (huecos: { inicioEn: string }[]): number[] =>
  huecos.map((h) => {
    const fecha = new Date(h.inicioEn);
    const local = new Date(fecha.getTime() - 5 * 3_600_000);
    return local.getUTCHours() * 60 + local.getUTCMinutes();
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================================
//  CAPA 1 Y 2: FESTIVOS, DÍAS ESPECIALES Y HORARIO DE LA SEDE
// ============================================================================

describe('DisponibilidadService.delDia: la barbería abre o no', () => {
  it('devuelve el día como no laborable en un festivo cerrado', async () => {
    const entorno = montar();
    escenarioBase(entorno, {
      diaEspecial: {
        tipo: 'FESTIVO_CERRADO',
        nombre: 'Día de San José',
        horaInicio: null,
        horaFin: null,
      },
    });

    const resultado = await entorno.servicio.delDia(consulta());

    expect(resultado).toMatchObject({
      fecha: FECHA,
      laborable: false,
      motivo: 'Día de San José',
      barberos: [],
    });
  });

  it('da prioridad al día especial de la sede sobre la regla global', async () => {
    const entorno = montar();
    escenarioBase(entorno);

    await entorno.servicio.delDia(consulta());

    // `orderBy: { sedeId: 'desc' }` pone primero la fila con sede concreta: es
    // lo que hace que una sede pueda abrir un festivo en que las demás cierran.
    expect(entorno.prisma.diaEspecial.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { sedeId: 'desc' },
        where: expect.objectContaining({ OR: [{ sedeId: null }, { sedeId: ID.sede }] }),
      }),
    );
  });

  it('el horario especial del día pisa el horario normal de la sede', async () => {
    const entorno = montar();
    escenarioBase(entorno, {
      diaEspecial: {
        tipo: 'HORARIO_ESPECIAL',
        nombre: '24 de diciembre',
        horaInicio: 600,
        horaFin: 720,
      },
    });

    const resultado = await entorno.servicio.delDia(consulta());

    // La rejilla se genera sobre la ventana especial: de 10:00 a 12:00 caben
    // cuatro inicios de media hora, el último a las 11:30.
    expect(minutosDe(resultado.barberos[0]!.huecos)).toEqual([600, 630, 660, 690]);
    expect(resultado.barberos[0]!.jornada).toEqual({ horaInicio: 600, horaFin: 720 });
  });

  it('marca el día como no laborable si la sede no abre', async () => {
    const entorno = montar();
    escenarioBase(entorno, { sede: horarioSede({ cerrado: true }) });

    const resultado = await entorno.servicio.delDia(consulta());

    expect(resultado).toMatchObject({ laborable: false, motivo: 'La sede no abre ese día' });
  });

  it('marca el día como no laborable si no hay horario configurado para ese día', async () => {
    const entorno = montar();
    escenarioBase(entorno, { sede: null });

    const resultado = await entorno.servicio.delDia(consulta());

    expect(resultado.laborable).toBe(false);
    expect(resultado.barberos).toEqual([]);
  });

  it('consulta el horario del día de la semana correcto', async () => {
    const entorno = montar();
    escenarioBase(entorno);

    await entorno.servicio.delDia(consulta());

    expect(entorno.prisma.sedeHorario.findUnique).toHaveBeenCalledWith({
      where: { sedeId_diaSemana: { sedeId: ID.sede, diaSemana: DIA_SEMANA_MARTES } },
    });
  });
});

// ============================================================================
//  CAPAS 3 Y 4: AGENDA DEL BARBERO Y EXCEPCIONES DE FECHA
// ============================================================================

describe('DisponibilidadService.delDia: agenda del barbero', () => {
  it('distingue "no hay cronograma" de "no hay huecos"', async () => {
    const entorno = montar();
    escenarioBase(entorno, { agendas: [] });

    const resultado = await entorno.servicio.delDia(consulta());

    // El día sí es laborable: el problema se arregla configurando la agenda,
    // no buscando otra hora.
    expect(resultado.laborable).toBe(true);
    expect(resultado.motivo).toBe('El barbero no tiene agenda configurada en esa sede');
    expect(resultado.barberos).toEqual([]);
  });

  it('cambia el mensaje cuando se consultan todos los barberos', async () => {
    const entorno = montar();
    escenarioBase(entorno, { agendas: [] });

    const resultado = await entorno.servicio.delDia(consulta({ barberoId: undefined }));

    expect(resultado.motivo).toBe('Ningún barbero tiene agenda configurada en esa sede');
  });

  it('solo considera barberos activos y no eliminados', async () => {
    const entorno = montar();
    escenarioBase(entorno);

    await entorno.servicio.delDia(consulta());

    expect(entorno.prisma.agendaDia.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          usuario: { activo: true, eliminadoEn: null, rol: 'BARBERO' },
        }),
      }),
    );
  });

  it('devuelve la rejilla completa del día cuando todo está libre', async () => {
    const entorno = montar();
    escenarioBase(entorno);

    const resultado = await entorno.servicio.delDia(consulta());

    expect(resultado.duracionNecesaria).toBe(30);
    const barbero = resultado.barberos[0]!;
    expect(barbero).toMatchObject({
      barberoId: ID.barbero,
      barberoNombre: 'Andrés',
      alias: 'Andy',
      trabaja: true,
      jornada: { horaInicio: 480, horaFin: 1080 },
      slotMinutos: 30,
      librestotal: 20,
      ocupadosTotal: 0,
    });
    expect(barbero.huecos).toHaveLength(20);
    expect(barbero.huecos[0]).toMatchObject({ hora: '08:00', disponible: true });
    expect(barbero.huecos[19]).toMatchObject({ hora: '17:30', disponible: true });
  });

  it('la excepción CERRADO del día manda sobre la plantilla semanal', async () => {
    const entorno = montar();
    escenarioBase(entorno, {
      excepciones: [
        {
          usuarioId: ID.barbero,
          tipo: 'CERRADO',
          motivo: 'Cita médica',
          horaInicio: null,
          horaFin: null,
        },
      ],
    });

    const resultado = await entorno.servicio.delDia(consulta());

    expect(resultado.barberos[0]).toMatchObject({
      trabaja: false,
      motivoNoTrabaja: 'Cita médica',
      huecos: [],
      librestotal: 0,
    });
  });

  it('usa un motivo genérico si la excepción no trae uno', async () => {
    const entorno = montar();
    escenarioBase(entorno, {
      excepciones: [{ usuarioId: ID.barbero, tipo: 'CERRADO', motivo: null }],
    });

    const resultado = await entorno.servicio.delDia(consulta());

    expect(resultado.barberos[0]!.motivoNoTrabaja).toBe('No disponible ese día');
  });

  it('respeta que el barbero no atienda ese día de la semana', async () => {
    const entorno = montar();
    escenarioBase(entorno, { agendas: [agendaDia({ trabaja: false })] });

    const resultado = await entorno.servicio.delDia(consulta());

    expect(resultado.barberos[0]).toMatchObject({
      trabaja: false,
      motivoNoTrabaja: 'No atiende ese día',
    });
  });

  it('un HORARIO_ESPECIAL hace trabajar al barbero en su día libre', async () => {
    const entorno = montar();
    escenarioBase(entorno, {
      agendas: [agendaDia({ trabaja: false })],
      excepciones: [
        {
          usuarioId: ID.barbero,
          tipo: 'HORARIO_ESPECIAL',
          horaInicio: 600,
          horaFin: 720,
          motivo: null,
        },
      ],
    });

    const resultado = await entorno.servicio.delDia(consulta());

    expect(resultado.barberos[0]!.trabaja).toBe(true);
    expect(resultado.barberos[0]!.jornada).toEqual({ horaInicio: 600, horaFin: 720 });
  });

  it('recorta la jornada del barbero al horario de la sede', async () => {
    const entorno = montar();
    escenarioBase(entorno, {
      // Quiere empezar a las 7 y acabar a las 20; la sede abre de 8 a 18.
      agendas: [agendaDia({ horaInicio: 420, horaFin: 1200 })],
    });

    const resultado = await entorno.servicio.delDia(consulta());

    expect(resultado.barberos[0]!.jornada).toEqual({ horaInicio: 480, horaFin: 1080 });
  });

  it('marca que no trabaja si su jornada queda fuera del horario de la sede', async () => {
    const entorno = montar();
    escenarioBase(entorno, {
      agendas: [agendaDia({ horaInicio: 1140, horaFin: 1260 })], // 19:00 a 21:00
    });

    const resultado = await entorno.servicio.delDia(consulta());

    expect(resultado.barberos[0]).toMatchObject({
      trabaja: false,
      motivoNoTrabaja: 'Su horario queda fuera del horario de la sede',
    });
  });

  it('devuelve a todos los barberos de la sede cuando no se filtra', async () => {
    const entorno = montar();
    escenarioBase(entorno, {
      agendas: [
        agendaDia(),
        agendaDia({
          usuarioId: ID.barberoAjeno,
          usuario: {
            id: ID.barberoAjeno,
            nombre: 'Luis',
            apellido: 'Gil',
            alias: null,
            fotoUrl: null,
            slotMinutos: null,
          },
        }),
      ],
    });

    const resultado = await entorno.servicio.delDia(consulta({ barberoId: undefined }));

    expect(resultado.barberos.map((b) => b.barberoNombre)).toEqual(['Andrés', 'Luis Gil']);
  });

  describe('slot efectivo', () => {
    it('toma el del día concreto si está definido', async () => {
      const entorno = montar();
      escenarioBase(entorno, { agendas: [agendaDia({ slotMinutos: 20 })] });

      const resultado = await entorno.servicio.delDia(consulta());

      expect(resultado.barberos[0]!.slotMinutos).toBe(20);
      expect(minutosDe(resultado.barberos[0]!.huecos).slice(0, 3)).toEqual([480, 500, 520]);
    });

    it('cae en la preferencia del barbero si el día no lo define', async () => {
      const entorno = montar();
      escenarioBase(entorno, {
        agendas: [
          agendaDia({
            slotMinutos: null,
            usuario: {
              id: ID.barbero,
              nombre: 'Andrés',
              apellido: null,
              alias: 'Andy',
              fotoUrl: null,
              slotMinutos: 45,
            },
          }),
        ],
      });

      const resultado = await entorno.servicio.delDia(consulta());

      expect(resultado.barberos[0]!.slotMinutos).toBe(45);
    });

    it('usa el valor global cuando nadie lo ha configurado', async () => {
      const entorno = montar({ slotMinutosDefault: 60 });
      escenarioBase(entorno);

      const resultado = await entorno.servicio.delDia(consulta());

      expect(resultado.barberos[0]!.slotMinutos).toBe(60);
    });
  });
});

// ============================================================================
//  CAPAS 5 Y 6: BLOQUES Y CITAS EXISTENTES
// ============================================================================

describe('DisponibilidadService.delDia: lo que ocupa la agenda', () => {
  it('descuenta el almuerzo y lo etiqueta como tal', async () => {
    const entorno = montar();
    escenarioBase(entorno, {
      agendas: [agendaDia({ bloques: [{ horaInicio: 720, horaFin: 780, tipo: 'ALMUERZO' }] })],
    });

    const resultado = await entorno.servicio.delDia(consulta());
    const huecos = resultado.barberos[0]!.huecos;
    const porMinuto = new Map(minutosDe(huecos).map((min, i) => [min, huecos[i]!]));

    expect(porMinuto.get(690)).toMatchObject({ disponible: true });
    expect(porMinuto.get(720)).toMatchObject({ disponible: false, motivo: 'ALMUERZO' });
    expect(porMinuto.get(750)).toMatchObject({ disponible: false, motivo: 'ALMUERZO' });
    expect(porMinuto.get(780)).toMatchObject({ disponible: true });
  });

  it('etiqueta los descansos por separado del almuerzo', async () => {
    const entorno = montar();
    escenarioBase(entorno, {
      agendas: [agendaDia({ bloques: [{ horaInicio: 600, horaFin: 630, tipo: 'DESCANSO' }] })],
    });

    const resultado = await entorno.servicio.delDia(consulta());
    const huecos = resultado.barberos[0]!.huecos;
    const indice = minutosDe(huecos).indexOf(600);

    expect(huecos[indice]).toMatchObject({ disponible: false, motivo: 'DESCANSO' });
  });

  it('una cita ocupa también su tiempo de limpieza', async () => {
    const entorno = montar();
    // Corte de 09:00 a 09:30 más 15 minutos de buffer → ocupa hasta 09:45.
    escenarioBase(entorno, { reservas: [ocupacion(540, 585)] });

    const resultado = await entorno.servicio.delDia(consulta());
    const huecos = resultado.barberos[0]!.huecos;
    const porMinuto = new Map(minutosDe(huecos).map((min, i) => [min, huecos[i]!]));

    expect(porMinuto.get(510)).toMatchObject({ disponible: true });
    expect(porMinuto.get(540)).toMatchObject({ disponible: false, motivo: 'OCUPADO' });
    // 09:30 choca con los 15 minutos de limpieza: si se ofreciera, el barbero
    // atendería sin haber limpiado la silla.
    expect(porMinuto.get(570)).toMatchObject({ disponible: false, motivo: 'OCUPADO' });
    expect(porMinuto.get(600)).toMatchObject({ disponible: true });
    expect(resultado.barberos[0]!.ocupadosTotal).toBe(2);
  });

  it('solo cuenta como ocupación los estados que usan la silla', async () => {
    const entorno = montar();
    escenarioBase(entorno);

    await entorno.servicio.delDia(consulta());

    // CANCELADA y NO_ASISTIO liberan el hueco al instante; COMPLETADA no, porque
    // esa silla sí estuvo usada a esa hora.
    expect(entorno.prisma.reserva.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          estado: { in: ['PENDIENTE', 'CONFIRMADA', 'EN_CURSO', 'COMPLETADA'] },
        }),
      }),
    );
  });

  it('ignora la cita que se está reprogramando', async () => {
    const entorno = montar();
    escenarioBase(entorno);

    await entorno.servicio.delDia(consulta({ excluirReservaId: ID.reserva }));

    expect(entorno.prisma.reserva.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { not: ID.reserva } }),
      }),
    );
  });

  it('no asigna la cita de un barbero a la agenda de otro', async () => {
    const entorno = montar();
    escenarioBase(entorno, {
      agendas: [
        agendaDia(),
        agendaDia({
          usuarioId: ID.barberoAjeno,
          usuario: {
            id: ID.barberoAjeno,
            nombre: 'Luis',
            apellido: null,
            alias: null,
            fotoUrl: null,
            slotMinutos: null,
          },
        }),
      ],
      reservas: [ocupacion(540, 570)],
    });

    const resultado = await entorno.servicio.delDia(consulta({ barberoId: undefined }));

    expect(resultado.barberos[0]!.ocupadosTotal).toBe(1);
    expect(resultado.barberos[1]!.ocupadosTotal).toBe(0);
  });

  it('el almuerzo no cuenta como hueco ocupado por una cita', async () => {
    const entorno = montar();
    escenarioBase(entorno, {
      agendas: [agendaDia({ bloques: [{ horaInicio: 720, horaFin: 780, tipo: 'ALMUERZO' }] })],
    });

    const resultado = await entorno.servicio.delDia(consulta());

    // `ocupadosTotal` alimenta el semáforo de ocupación: si el almuerzo contara,
    // todos los días parecerían más llenos de lo que están.
    expect(resultado.barberos[0]!.ocupadosTotal).toBe(0);
    expect(resultado.barberos[0]!.librestotal).toBe(18);
  });
});

// ============================================================================
//  CAPA 7: DURACIÓN, BUFFER Y GENERACIÓN DE INICIOS
// ============================================================================

describe('DisponibilidadService.delDia: duración y encaje', () => {
  it('suma las duraciones y aplica el buffer una sola vez', async () => {
    const entorno = montar();
    escenarioBase(entorno, {
      servicios: [
        { id: ID.servicioCorte, duracionMinutos: 30, bufferMinutos: 10 },
        { id: ID.servicioBarba, duracionMinutos: 20, bufferMinutos: 5 },
      ],
    });

    const resultado = await entorno.servicio.delDia(
      consulta({ servicioIds: [ID.servicioCorte, ID.servicioBarba] }),
    );

    // 30 + 20 de servicio, y el mayor de los dos buffers (10), no la suma.
    expect(resultado.duracionNecesaria).toBe(60);
  });

  it('usa el buffer global cuando el servicio no define el suyo', async () => {
    const entorno = montar({ bufferMinutosDefault: 15 });
    escenarioBase(entorno);

    const resultado = await entorno.servicio.delDia(consulta());

    expect(resultado.duracionNecesaria).toBe(45);
  });

  it('pinta la rejilla con la duración de un slot si aún no se eligieron servicios', async () => {
    const entorno = montar();
    escenarioBase(entorno);

    const resultado = await entorno.servicio.delDia(consulta({ servicioIds: [] }));

    // El panel necesita dibujar el día antes de saber qué le van a hacer al
    // cliente.
    expect(resultado.duracionNecesaria).toBe(30);
    expect(entorno.prisma.servicio.findMany).not.toHaveBeenCalled();
  });

  it('falla si alguno de los servicios consultados no existe', async () => {
    const entorno = montar();
    escenarioBase(entorno, { servicios: [] });

    const error = await capturar(() => entorno.servicio.delDia(consulta()));

    expect(error.codigo).toBe(CODIGOS_ERROR.RECURSO_NO_ENCONTRADO);
    expect(error.getStatus()).toBe(404);
  });

  it('descarta los inicios en los que el servicio no cabe antes del cierre', async () => {
    const entorno = montar();
    escenarioBase(entorno, {
      servicios: [{ id: ID.servicioCorte, duracionMinutos: 90, bufferMinutos: 0 }],
    });

    const resultado = await entorno.servicio.delDia(consulta());
    const huecos = resultado.barberos[0]!.huecos;
    const porMinuto = new Map(minutosDe(huecos).map((min, i) => [min, huecos[i]!]));

    // Un servicio de 90 minutos no cabe empezando a las 17:00 si se cierra a
    // las 18:00.
    expect(porMinuto.get(960)).toMatchObject({ disponible: true }); // 16:00
    expect(porMinuto.get(1020)).toMatchObject({ disponible: false, motivo: 'NO_CABE' });
    expect(porMinuto.get(1050)).toMatchObject({ disponible: false, motivo: 'NO_CABE' });
  });

  it('descarta el inicio en que el servicio chocaría con el almuerzo', async () => {
    const entorno = montar();
    escenarioBase(entorno, {
      agendas: [agendaDia({ bloques: [{ horaInicio: 720, horaFin: 780, tipo: 'ALMUERZO' }] })],
      servicios: [{ id: ID.servicioCorte, duracionMinutos: 60, bufferMinutos: 0 }],
    });

    const resultado = await entorno.servicio.delDia(consulta());
    const huecos = resultado.barberos[0]!.huecos;
    const porMinuto = new Map(minutosDe(huecos).map((min, i) => [min, huecos[i]!]));

    // Empezar a las 11:30 un servicio de una hora metería media hora dentro del
    // almuerzo.
    expect(porMinuto.get(690)).toMatchObject({ disponible: false, motivo: 'ALMUERZO' });
    expect(porMinuto.get(660)).toMatchObject({ disponible: true });
  });

  describe('horas ya pasadas y antelación mínima', () => {
    it('marca como PASADO lo que ya ocurrió hoy', async () => {
      const entorno = montar();
      escenarioBase(entorno);
      // Mediodía: la mañana ya se fue.
      vi.setSystemTime(horaLocal(720));

      const resultado = await entorno.servicio.delDia(consulta());
      const huecos = resultado.barberos[0]!.huecos;
      const porMinuto = new Map(minutosDe(huecos).map((min, i) => [min, huecos[i]!]));

      expect(porMinuto.get(480)).toMatchObject({ disponible: false, motivo: 'PASADO' });
      expect(porMinuto.get(690)).toMatchObject({ disponible: false, motivo: 'PASADO' });
      expect(porMinuto.get(720)).toMatchObject({ disponible: true });
    });

    it('aplica la antelación mínima solo a la reserva del cliente', async () => {
      const entorno = montar({ minAntelacionMinutos: 60 });
      escenarioBase(entorno);
      vi.setSystemTime(horaLocal(720));

      const delCliente = await entorno.servicio.delDia(consulta({ aplicarReglasCliente: true }));
      const huecos = delCliente.barberos[0]!.huecos;
      const porMinuto = new Map(minutosDe(huecos).map((min, i) => [min, huecos[i]!]));

      expect(porMinuto.get(720)).toMatchObject({ disponible: false, motivo: 'ANTELACION' });
      expect(porMinuto.get(750)).toMatchObject({ disponible: false, motivo: 'ANTELACION' });
      expect(porMinuto.get(780)).toMatchObject({ disponible: true });
    });

    it('la recepción puede registrar una cita para dentro de diez minutos', async () => {
      const entorno = montar({ minAntelacionMinutos: 60 });
      escenarioBase(entorno);
      vi.setSystemTime(horaLocal(720));

      const delPanel = await entorno.servicio.delDia(consulta());
      const huecos = delPanel.barberos[0]!.huecos;
      const porMinuto = new Map(minutosDe(huecos).map((min, i) => [min, huecos[i]!]));

      // El cliente ya está en el local: no tiene sentido hacerle esperar una hora.
      expect(porMinuto.get(720)).toMatchObject({ disponible: true });
    });

    it('no marca nada como pasado en un día futuro', async () => {
      const entorno = montar();
      escenarioBase(entorno);
      vi.setSystemTime(horaLocal(1020)); // 17:00 de hoy

      const resultado = await entorno.servicio.delDia(
        consulta({ fecha: '2026-03-17' }), // el martes siguiente
      );

      expect(resultado.barberos[0]!.librestotal).toBe(20);
    });
  });
});

// ============================================================================
//  VALIDAR HUECO
// ============================================================================

describe('DisponibilidadService.validarHueco', () => {
  const validacion = (cambios: Record<string, unknown> = {}) => ({
    sedeId: ID.sede,
    barberoId: ID.barbero,
    inicioEn: horaLocal(600),
    servicioIds: [ID.servicioCorte],
    ...cambios,
  });

  it('acepta una hora alineada y libre', async () => {
    const entorno = montar();
    escenarioBase(entorno);

    await expect(entorno.servicio.validarHueco(validacion())).resolves.toBeUndefined();
  });

  it('rechaza una hora que ya pasó', async () => {
    const entorno = montar();
    escenarioBase(entorno);

    const error = await capturar(() =>
      entorno.servicio.validarHueco(validacion({ inicioEn: horaLocal(600, '2026-03-03') })),
    );

    expect(error.codigo).toBe(CODIGOS_ERROR.RESERVA_EN_EL_PASADO);
    expect(error.getStatus()).toBe(400);
  });

  it('rechaza la reserva del cliente sin la antelación mínima', async () => {
    const entorno = montar({ minAntelacionMinutos: 120 });
    escenarioBase(entorno);

    const error = await capturar(() =>
      entorno.servicio.validarHueco(
        validacion({ inicioEn: horaLocal(510), aplicarReglasCliente: true }),
      ),
    );

    expect(error.codigo).toBe(CODIGOS_ERROR.ANTELACION_INSUFICIENTE);
    expect(error.detalle).toEqual({ minAntelacionMinutos: 120 });
  });

  it('rechaza la reserva del cliente demasiado lejana en el tiempo', async () => {
    const entorno = montar({ maxDiasAnticipacion: 45 });
    escenarioBase(entorno);

    const error = await capturar(() =>
      entorno.servicio.validarHueco(
        validacion({
          inicioEn: new Date(AHORA.getTime() + 60 * 86_400_000),
          aplicarReglasCliente: true,
        }),
      ),
    );

    expect(error.codigo).toBe(CODIGOS_ERROR.FECHA_DEMASIADO_LEJANA);
    expect(error.detalle).toEqual({ maxDiasAnticipacion: 45 });
  });

  it('la recepción no está sujeta a esas dos reglas', async () => {
    const entorno = montar({ minAntelacionMinutos: 120, maxDiasAnticipacion: 1 });
    escenarioBase(entorno);

    await expect(
      entorno.servicio.validarHueco(validacion({ inicioEn: horaLocal(510) })),
    ).resolves.toBeUndefined();
  });

  it('rechaza un día no laborable explicando el motivo', async () => {
    const entorno = montar();
    escenarioBase(entorno, {
      diaEspecial: { tipo: 'FESTIVO_CERRADO', nombre: 'Festivo', horaInicio: null, horaFin: null },
    });

    const error = await capturar(() => entorno.servicio.validarHueco(validacion()));

    expect(error.codigo).toBe(CODIGOS_ERROR.DIA_NO_LABORABLE);
    expect(error.getStatus()).toBe(409);
    expect(error.detalle).toEqual({ motivo: 'Festivo' });
  });

  it('rechaza al barbero que no tiene agenda en esa sede', async () => {
    const entorno = montar();
    escenarioBase(entorno, { agendas: [] });

    const error = await capturar(() => entorno.servicio.validarHueco(validacion()));

    expect(error.codigo).toBe(CODIGOS_ERROR.BARBERO_NO_PERTENECE_A_SEDE);
  });

  it('rechaza el día libre del barbero explicando el motivo', async () => {
    const entorno = montar();
    escenarioBase(entorno, {
      excepciones: [
        {
          usuarioId: ID.barbero,
          tipo: 'CERRADO',
          motivo: 'Vacaciones',
          horaInicio: null,
          horaFin: null,
        },
      ],
    });

    const error = await capturar(() => entorno.servicio.validarHueco(validacion()));

    expect(error.codigo).toBe(CODIGOS_ERROR.BARBERO_NO_TRABAJA_ESE_DIA);
    expect(error.detalle).toEqual({ motivo: 'Vacaciones' });
  });

  it('rechaza una hora que no cae en la rejilla y sugiere alternativas', async () => {
    const entorno = montar();
    escenarioBase(entorno);

    // 09:07 con slots de 30 minutos: dejaría un hueco inservible de 23 minutos.
    const error = await capturar(() =>
      entorno.servicio.validarHueco(validacion({ inicioEn: horaLocal(547) })),
    );

    expect(error.codigo).toBe(CODIGOS_ERROR.HORARIO_FUERA_DE_JORNADA);
    const detalle = error.detalle as { alternativas: { hora: string }[]; slotMinutos: number };
    expect(detalle.slotMinutos).toBe(30);
    // Las tres más cercanas a las 09:07, ordenadas por distancia.
    expect(detalle.alternativas.map((a) => a.hora)).toEqual(['09:00', '09:30', '08:30']);
  });

  it('rechaza un hueco ya ocupado y sugiere alternativas libres', async () => {
    const entorno = montar();
    escenarioBase(entorno, { reservas: [ocupacion(600, 630)] });

    const error = await capturar(() => entorno.servicio.validarHueco(validacion()));

    expect(error.codigo).toBe(CODIGOS_ERROR.RESERVA_SOLAPADA);
    expect(error.getStatus()).toBe(409);
    const detalle = error.detalle as { alternativas: { hora: string; disponible: boolean }[] };
    expect(detalle.alternativas).toHaveLength(3);
    expect(detalle.alternativas.every((a) => a.disponible)).toBe(true);
    expect(detalle.alternativas.map((a) => a.hora)).not.toContain('10:00');
  });

  it('traduce el choque con el almuerzo a "fuera de jornada"', async () => {
    const entorno = montar();
    escenarioBase(entorno, {
      agendas: [agendaDia({ bloques: [{ horaInicio: 600, horaFin: 660, tipo: 'ALMUERZO' }] })],
    });

    const error = await capturar(() => entorno.servicio.validarHueco(validacion()));

    expect(error.codigo).toBe(CODIGOS_ERROR.HORARIO_FUERA_DE_JORNADA);
  });

  it('traduce la falta de antelación del hueco al código correspondiente', async () => {
    const entorno = montar({ minAntelacionMinutos: 30 });
    escenarioBase(entorno);
    vi.setSystemTime(horaLocal(585)); // 09:45

    const error = await capturar(() =>
      entorno.servicio.validarHueco(
        validacion({ inicioEn: horaLocal(600), aplicarReglasCliente: true }),
      ),
    );

    expect(error.codigo).toBe(CODIGOS_ERROR.ANTELACION_INSUFICIENTE);
  });

  it('propaga excluirReservaId para que la cita no choque consigo misma', async () => {
    const entorno = montar();
    escenarioBase(entorno, { reservas: [] });

    await entorno.servicio.validarHueco(validacion({ excluirReservaId: ID.reserva }));

    expect(entorno.prisma.reserva.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { not: ID.reserva } }) }),
    );
  });
});

// ============================================================================
//  PRIMER HUECO LIBRE (WALK-IN)
// ============================================================================

describe('DisponibilidadService.primerHuecoLibre', () => {
  const peticion = (cambios: Record<string, unknown> = {}) => ({
    sedeId: ID.sede,
    barberoId: ID.barbero,
    servicioIds: [ID.servicioCorte],
    ...cambios,
  });

  it('devuelve el primer hueco libre a partir de ahora', async () => {
    const entorno = montar();
    escenarioBase(entorno);
    vi.setSystemTime(horaLocal(600)); // 10:00

    const resultado = await entorno.servicio.primerHuecoLibre(peticion());

    expect(resultado.hora).toBe('10:00');
    expect(resultado.inicioEn).toEqual(horaLocal(600));
  });

  it('salta por encima de las citas ya tomadas', async () => {
    const entorno = montar();
    escenarioBase(entorno, { reservas: [ocupacion(600, 660)] });
    vi.setSystemTime(horaLocal(600));

    const resultado = await entorno.servicio.primerHuecoLibre(peticion());

    expect(resultado.hora).toBe('11:00');
  });

  it('explica que la agenda está completa en lugar de devolver nada', async () => {
    const entorno = montar();
    // Ocupada toda la jornada de hoy y de mañana.
    escenarioBase(entorno, {
      reservas: [ocupacion(480, 1080), ocupacion(480, 1080, '2026-03-11')],
    });

    const resultado = await entorno.servicio.primerHuecoLibre(peticion());

    expect(resultado.inicioEn).toBeUndefined();
    expect(resultado.motivo).toBe('Su agenda está completa.');
  });

  it('distingue la falta de cronograma de la falta de huecos', async () => {
    const entorno = montar();
    escenarioBase(entorno, { agendas: [] });

    const resultado = await entorno.servicio.primerHuecoLibre(peticion());

    // Se arregla configurando la agenda, no buscando otra hora: el mensaje
    // tiene que decirlo.
    expect(resultado.inicioEn).toBeUndefined();
    expect(resultado.motivo).toBe('El barbero no tiene agenda configurada en esa sede');
  });

  it('informa del día libre del barbero', async () => {
    const entorno = montar();
    escenarioBase(entorno, {
      excepciones: [{ usuarioId: ID.barbero, tipo: 'CERRADO', motivo: 'Vacaciones' }],
    });

    const resultado = await entorno.servicio.primerHuecoLibre(peticion());

    expect(resultado.motivo).toBe('Vacaciones');
  });

  it('busca también en el día siguiente cuando hoy ya no cabe nadie', async () => {
    const entorno = montar();
    escenarioBase(entorno);
    // Hoy ocupado de 8 a 18; mañana libre. El doble responde según el día que
    // se le pregunta, porque el motor consulta un día a la vez.
    entorno.prisma.reserva.findMany.mockImplementation(
      async ({ where }: { where: { inicioEn: { gte: Date } } }) =>
        where.inicioEn.gte.getTime() === horaLocal(0).getTime() ? [ocupacion(480, 1080)] : [],
    );

    const resultado = await entorno.servicio.primerHuecoLibre(peticion());

    // Dos días revisados: si no cabe en dos, tiene más sentido que la recepción
    // elija fecha a mano.
    expect(entorno.prisma.sedeHorario.findUnique).toHaveBeenCalledTimes(2);
    expect(resultado.inicioEn).toEqual(horaLocal(480, '2026-03-11'));
  });

  it('respeta el instante de partida indicado', async () => {
    const entorno = montar();
    escenarioBase(entorno);

    const resultado = await entorno.servicio.primerHuecoLibre(
      peticion({ desde: horaLocal(900) }), // 15:00
    );

    expect(resultado.hora).toBe('15:00');
  });
});

// ============================================================================
//  CALENDARIO MENSUAL
// ============================================================================

describe('DisponibilidadService.calendario', () => {
  function escenarioCalendario(
    entorno: Entorno,
    opciones: {
      diasEspeciales?: Record<string, unknown>[];
      horarios?: Record<string, unknown>[];
      agendas?: Record<string, unknown>[];
      excepciones?: Record<string, unknown>[];
      reservas?: Record<string, unknown>[];
    } = {},
  ): void {
    entorno.prisma.diaEspecial.findMany.mockResolvedValue(opciones.diasEspeciales ?? []);
    entorno.prisma.sedeHorario.findMany.mockResolvedValue(opciones.horarios ?? [horarioSede()]);
    entorno.prisma.agendaDia.findMany.mockResolvedValue(opciones.agendas ?? [agendaDia()]);
    entorno.prisma.agendaExcepcion.findMany.mockResolvedValue(opciones.excepciones ?? []);
    entorno.prisma.reserva.findMany.mockResolvedValue(opciones.reservas ?? []);
    entorno.prisma.sede.findFirst.mockResolvedValue({ id: ID.sede });
  }

  const rango = { sedeId: ID.sede, desde: FECHA, hasta: FECHA };

  it('marca el día como libre cuando casi todo está disponible', async () => {
    const entorno = montar();
    escenarioCalendario(entorno);

    const [dia] = await entorno.servicio.calendario(rango);

    expect(dia).toMatchObject({
      fecha: FECHA,
      laborable: true,
      estado: 'libre',
      totalHuecos: 20,
      huecosLibres: 20,
      reservas: 0,
    });
  });

  it('sin excluir nada, la consulta de citas no filtra ninguna', async () => {
    const entorno = montar();
    escenarioCalendario(entorno);
    await entorno.servicio.calendario(rango);
    expect(entorno.prisma.reserva.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.not.objectContaining({ id: expect.anything() }) }),
    );
  });

  it('con excluirReservaId la propia cita no cuenta: el día no sale lleno por ella', async () => {
    const entorno = montar();
    escenarioCalendario(entorno);
    await entorno.servicio.calendario({ ...rango, excluirReservaId: ID.reserva });
    expect(entorno.prisma.reserva.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { not: ID.reserva } }) }),
    );
  });

  it('marca el día como lleno cuando las citas cubren toda la capacidad', async () => {
    const entorno = montar();
    escenarioCalendario(entorno, { reservas: [ocupacion(480, 1080)] });

    const [dia] = await entorno.servicio.calendario(rango);

    expect(dia).toMatchObject({ estado: 'lleno', huecosLibres: 0, reservas: 20 });
  });

  it('marca el día como parcial cuando queda menos de un tercio libre', async () => {
    const entorno = montar();
    // 07 horas ocupadas de 10: quedan 6 huecos de 20 → 30 %.
    escenarioCalendario(entorno, { reservas: [ocupacion(480, 900)] });

    const [dia] = await entorno.servicio.calendario(rango);

    expect(dia).toMatchObject({ estado: 'parcial', huecosLibres: 6 });
  });

  it('marca el festivo como cerrado y lo etiqueta', async () => {
    const entorno = montar();
    escenarioCalendario(entorno, {
      diasEspeciales: [
        {
          fecha: new Date(`${FECHA}T00:00:00.000Z`),
          tipo: 'FESTIVO_CERRADO',
          nombre: 'Día de San José',
          horaInicio: null,
          horaFin: null,
        },
      ],
    });

    const [dia] = await entorno.servicio.calendario(rango);

    expect(dia).toMatchObject({
      laborable: false,
      estado: 'cerrado',
      etiqueta: 'Día de San José',
      totalHuecos: 0,
    });
  });

  it('marca como cerrado el día en que la sede no abre', async () => {
    const entorno = montar();
    escenarioCalendario(entorno, { horarios: [horarioSede({ cerrado: true })] });

    const [dia] = await entorno.servicio.calendario(rango);

    expect(dia).toMatchObject({ laborable: false, estado: 'cerrado' });
  });

  it('excluye del cómputo al barbero con el día cerrado', async () => {
    const entorno = montar();
    escenarioCalendario(entorno, {
      excepciones: [
        {
          usuarioId: ID.barbero,
          sedeId: null,
          fecha: new Date(`${FECHA}T00:00:00.000Z`),
          tipo: 'CERRADO',
        },
      ],
    });

    const [dia] = await entorno.servicio.calendario(rango);

    expect(dia).toMatchObject({ estado: 'cerrado', totalHuecos: 0, laborable: false });
  });

  it('suma la capacidad de todos los barberos de la sede', async () => {
    const entorno = montar();
    escenarioCalendario(entorno, {
      agendas: [
        agendaDia(),
        agendaDia({ usuarioId: ID.barberoAjeno, usuario: { slotMinutos: null } }),
      ],
    });

    const [dia] = await entorno.servicio.calendario(rango);

    expect(dia!.totalHuecos).toBe(40);
  });

  it('cuenta las citas completadas como ocupación', async () => {
    const entorno = montar();
    escenarioCalendario(entorno);

    await entorno.servicio.calendario(rango);

    // Si el resumen del mes y el detalle del día discreparan, nadie se fiaría
    // de ninguno de los dos.
    expect(entorno.prisma.reserva.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          estado: { in: ['PENDIENTE', 'CONFIRMADA', 'EN_CURSO', 'COMPLETADA'] },
        }),
      }),
    );
  });

  it('usa la sede principal si no se indica ninguna', async () => {
    const entorno = montar();
    escenarioCalendario(entorno);

    await entorno.servicio.calendario({ desde: FECHA, hasta: FECHA });

    expect(entorno.prisma.sede.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { activa: true, eliminadoEn: null },
        orderBy: { orden: 'asc' },
      }),
    );
  });

  it('devuelve vacío si no hay ninguna sede activa', async () => {
    const entorno = montar();
    escenarioCalendario(entorno);
    entorno.prisma.sede.findFirst.mockResolvedValue(null);

    const resultado = await entorno.servicio.calendario({ desde: FECHA, hasta: FECHA });

    expect(resultado).toEqual([]);
  });

  it('devuelve vacío con el rango invertido', async () => {
    const entorno = montar();
    escenarioCalendario(entorno);

    const resultado = await entorno.servicio.calendario({
      sedeId: ID.sede,
      desde: '2026-03-20',
      hasta: '2026-03-10',
    });

    expect(resultado).toEqual([]);
  });

  it('acota el rango a 92 días para no recorrer un año entero', async () => {
    const entorno = montar();
    escenarioCalendario(entorno, { horarios: [] });

    const resultado = await entorno.servicio.calendario({
      sedeId: ID.sede,
      desde: '2026-01-01',
      hasta: '2026-12-31',
    });

    expect(resultado).toHaveLength(92);
  });

  it('devuelve un día por fecha del rango pedido', async () => {
    const entorno = montar();
    escenarioCalendario(entorno);

    const resultado = await entorno.servicio.calendario({
      sedeId: ID.sede,
      desde: '2026-03-10',
      hasta: '2026-03-12',
    });

    expect(resultado.map((d) => d.fecha)).toEqual(['2026-03-10', '2026-03-11', '2026-03-12']);
  });
});

// ============================================================================
//  COHERENCIA ENTRE VISTAS
// ============================================================================

describe('DisponibilidadService: coherencia entre el día y el mes', () => {
  it('el detalle del día y el resumen del mes cuentan la misma capacidad', async () => {
    const entorno = montar();
    escenarioBase(entorno);
    const delDia = await entorno.servicio.delDia(consulta());

    const entornoMes = montar();
    entornoMes.prisma.diaEspecial.findMany.mockResolvedValue([]);
    entornoMes.prisma.sedeHorario.findMany.mockResolvedValue([horarioSede()]);
    entornoMes.prisma.agendaDia.findMany.mockResolvedValue([agendaDia()]);
    entornoMes.prisma.agendaExcepcion.findMany.mockResolvedValue([]);
    entornoMes.prisma.reserva.findMany.mockResolvedValue([]);
    entornoMes.prisma.sede.findFirst.mockResolvedValue({ id: ID.sede });
    const [delMes] = await entornoMes.servicio.calendario({
      sedeId: ID.sede,
      desde: FECHA,
      hasta: FECHA,
    });

    // Dos caminos de cálculo distintos sobre los mismos datos: si divergen, el
    // calendario pinta un día en verde que el detalle muestra lleno.
    expect(delMes!.totalHuecos).toBe(delDia.barberos[0]!.huecos.length);
  });

  it('el precio no interviene en el cálculo de huecos', async () => {
    const entorno = montar();
    escenarioBase(entorno, {
      servicios: [{ id: ID.servicioCorte, duracionMinutos: 30, bufferMinutos: null }],
    });

    const resultado = await entorno.servicio.delDia(consulta());

    // La disponibilidad solo mira duración y buffer: un cambio de tarifa no
    // puede mover la agenda.
    expect(entorno.prisma.servicio.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { id: true, duracionMinutos: true, bufferMinutos: true },
      }),
    );
    expect(resultado.barberos[0]!.librestotal).toBe(20);
    expect(servicio().precio).toBeInstanceOf(Prisma.Decimal);
  });
});

// ============================================================================
//  CALENDARIO FIEL (canal público): parámetros opcionales y aditivos
// ============================================================================

describe('DisponibilidadService.calendario con servicio, reglas del cliente y barberos visibles', () => {
  const OTRO_MARTES = '2026-03-17';

  function escenario(
    entorno: Entorno,
    opciones: { agendas?: Record<string, unknown>[]; duracion?: number } = {},
  ): void {
    entorno.prisma.diaEspecial.findMany.mockResolvedValue([]);
    entorno.prisma.sedeHorario.findMany.mockResolvedValue([horarioSede()]);
    entorno.prisma.agendaDia.findMany.mockResolvedValue(opciones.agendas ?? [agendaDia()]);
    entorno.prisma.agendaExcepcion.findMany.mockResolvedValue([]);
    entorno.prisma.reserva.findMany.mockResolvedValue([]);
    entorno.prisma.sede.findFirst.mockResolvedValue({ id: ID.sede });
    entorno.prisma.servicio.findMany.mockResolvedValue([
      { id: ID.servicioCorte, duracionMinutos: opciones.duracion ?? 30, bufferMinutos: null },
    ]);
  }

  const rangoDe = (fecha: string, extra: Record<string, unknown> = {}) => ({
    sedeId: ID.sede,
    desde: fecha,
    hasta: fecha,
    ...extra,
  });

  it('un día cuyos huecos son más cortos que el servicio pedido no tiene hueco', async () => {
    const entorno = montar();
    // Jornada de 30 minutos: cabe un corte de 30, no uno de 45.
    escenario(entorno, { agendas: [agendaDia({ horaInicio: 480, horaFin: 510 })], duracion: 45 });

    const [dia] = await entorno.servicio.calendario(
      rangoDe(OTRO_MARTES, { servicioIds: [ID.servicioCorte] }),
    );

    expect(dia!.huecosLibres).toBe(0);
    expect(dia!.estado).toBe('lleno');
    // `reservas` son reservas: que no quepa el servicio no es una cita.
    expect(dia!.reservas).toBe(0);
  });

  it('en modo exacto `reservas` cuenta solo citas, no descansos ni antelación', async () => {
    const entorno = montar();
    escenario(entorno, {
      agendas: [
        agendaDia({ bloques: [{ horaInicio: 720, horaFin: 780, tipo: 'ALMUERZO' }] }),
      ],
    });
    // Una cita de 09:00 a 09:30 el otro martes.
    entorno.prisma.reserva.findMany.mockResolvedValue([ocupacion(540, 570, OTRO_MARTES)]);

    const [dia] = await entorno.servicio.calendario(
      rangoDe(OTRO_MARTES, { servicioIds: [ID.servicioCorte] }),
    );

    expect(dia!.reservas).toBe(1);
    // 20 inicios: 1 por la cita y 2 por el almuerzo no se ofrecen.
    expect(dia!.totalHuecos).toBe(20);
    expect(dia!.huecosLibres).toBe(17);
  });

  it('el mismo día sí tiene hueco para un servicio que cabe', async () => {
    const entorno = montar();
    escenario(entorno, { agendas: [agendaDia({ horaInicio: 480, horaFin: 510 })], duracion: 30 });

    const [dia] = await entorno.servicio.calendario(
      rangoDe(OTRO_MARTES, { servicioIds: [ID.servicioCorte] }),
    );

    expect(dia!.huecosLibres).toBe(1);
  });

  it('hoy, con todo lo que queda dentro de la antelación mínima, no tiene hueco', async () => {
    const entorno = montar({ minAntelacionMinutos: 60 });
    // Son las 08:00: la jornada 08:00-09:00 queda entera dentro de la antelación.
    escenario(entorno, { agendas: [agendaDia({ horaInicio: 480, horaFin: 540 })] });

    const [dia] = await entorno.servicio.calendario(
      rangoDe(FECHA, { servicioIds: [ID.servicioCorte], aplicarReglasCliente: true }),
    );

    expect(dia!.huecosLibres).toBe(0);
  });

  it('sin las reglas del cliente ese mismo hoy sí tiene hueco', async () => {
    const entorno = montar({ minAntelacionMinutos: 60 });
    escenario(entorno, { agendas: [agendaDia({ horaInicio: 480, horaFin: 540 })] });

    const [dia] = await entorno.servicio.calendario(
      rangoDe(FECHA, { servicioIds: [ID.servicioCorte] }),
    );

    expect(dia!.huecosLibres).toBe(2);
  });

  it('con soloVisiblesWeb pide a Prisma solo barberos visibles en web', async () => {
    const entorno = montar();
    escenario(entorno);

    await entorno.servicio.calendario(rangoDe(OTRO_MARTES, { soloVisiblesWeb: true }));

    expect(entorno.prisma.agendaDia.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          usuario: { activo: true, eliminadoEn: null, rol: 'BARBERO', visibleWeb: true },
        }),
      }),
    );
  });

  it('por defecto no filtra por visibilidad: el panel sigue viendo a todos', async () => {
    const entorno = montar();
    escenario(entorno);

    await entorno.servicio.calendario(rangoDe(OTRO_MARTES));

    expect(entorno.prisma.agendaDia.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          usuario: { activo: true, eliminadoEn: null, rol: 'BARBERO' },
        }),
      }),
    );
  });

  it('el modo exacto no hace una consulta por día', async () => {
    const entorno = montar();
    escenario(entorno);

    await entorno.servicio.calendario({
      sedeId: ID.sede,
      desde: OTRO_MARTES,
      hasta: '2026-03-31',
      servicioIds: [ID.servicioCorte],
      aplicarReglasCliente: true,
    });

    expect(entorno.prisma.reserva.findMany).toHaveBeenCalledTimes(1);
    expect(entorno.prisma.agendaDia.findMany).toHaveBeenCalledTimes(1);
  });
});
