import { describe, expect, it } from 'vitest';
import type { HuecoPublico, ServicioPublico } from '@cds/shared';
import {
  estadoInicial,
  reductor,
  totalDuracion,
  totalPrecio,
  type AccionReserva,
  type EstadoReserva,
} from './reductor';

const corte: ServicioPublico = {
  id: 's-corte',
  nombre: 'Corte',
  descripcion: null,
  incluye: [],
  precio: 25000,
  duracionMinutos: 30,
};
const barba: ServicioPublico = {
  id: 's-barba',
  nombre: 'Barba',
  descripcion: null,
  incluye: [],
  precio: 15000,
  duracionMinutos: 20,
};
const hueco: HuecoPublico = { inicioEn: '2026-11-10T14:30:00.000Z', hora: '09:30', disponible: true };

/** Aplica las acciones en orden, como lo haría `useReducer`. */
function aplicar(...acciones: AccionReserva[]): EstadoReserva {
  return acciones.reduce(reductor, estadoInicial);
}

/** Congela el objeto y todo lo que cuelga de él. */
function deepFreeze<T>(valor: T): T {
  if (valor !== null && typeof valor === 'object') {
    Object.values(valor).forEach(deepFreeze);
    Object.freeze(valor);
  }
  return valor;
}

const retroceder = (veces: number): AccionReserva[] =>
  Array.from({ length: veces }, () => ({ tipo: 'retroceder' }));

const hastaFecha: AccionReserva[] = [
  { tipo: 'alternarServicio', servicio: corte },
  { tipo: 'elegirSede', sedeId: 'sede-1' },
  { tipo: 'avanzar' },
];
const hastaHora: AccionReserva[] = [...hastaFecha, { tipo: 'elegirFecha', fecha: '2026-11-10' }, { tipo: 'avanzar' }];
const hastaDatos: AccionReserva[] = [...hastaHora, { tipo: 'elegirHora', hueco }, { tipo: 'avanzar' }];

describe('reductor del asistente de reserva', () => {
  it('empieza en el paso de servicio sin nada elegido', () => {
    expect(estadoInicial).toEqual({
      paso: 'servicio',
      servicios: [],
      sedeId: null,
      barberoId: null,
      fecha: null,
      hueco: null,
    });
  });

  it('no avanza de servicio sin al menos uno elegido', () => {
    const estado = aplicar({ tipo: 'elegirSede', sedeId: 'sede-1' }, { tipo: 'avanzar' });
    expect(estado.paso).toBe('servicio');
  });

  it('no avanza de servicio sin sede, porque los huecos son de una sede', () => {
    const estado = aplicar({ tipo: 'alternarServicio', servicio: corte }, { tipo: 'avanzar' });
    expect(estado.paso).toBe('servicio');
  });

  it('suma el precio y la duración de los servicios elegidos', () => {
    const estado = aplicar(
      { tipo: 'alternarServicio', servicio: corte },
      { tipo: 'alternarServicio', servicio: barba },
    );
    expect(totalPrecio(estado)).toBe(40000);
    expect(totalDuracion(estado)).toBe(50);
  });

  it('al quitar el último servicio vuelve a bloquear el avance', () => {
    const estado = aplicar(
      { tipo: 'alternarServicio', servicio: corte },
      { tipo: 'elegirSede', sedeId: 'sede-1' },
      { tipo: 'alternarServicio', servicio: corte },
      { tipo: 'avanzar' },
    );
    expect(estado.servicios).toEqual([]);
    expect(estado.paso).toBe('servicio');
    expect(totalPrecio(estado)).toBe(0);
    expect(totalDuracion(estado)).toBe(0);
  });

  it('avanza paso a paso exigiendo lo elegido en cada uno', () => {
    expect(aplicar(...hastaFecha).paso).toBe('fecha');
    expect(aplicar(...hastaFecha, { tipo: 'avanzar' }).paso).toBe('fecha');
    expect(aplicar(...hastaHora).paso).toBe('hora');
    expect(aplicar(...hastaHora, { tipo: 'avanzar' }).paso).toBe('hora');
    expect(aplicar(...hastaDatos).paso).toBe('datos');
    expect(aplicar(...hastaDatos, { tipo: 'confirmar' }).paso).toBe('listo');
  });

  it('cambiar de sede limpia la fecha y la hora elegidas', () => {
    const estado = aplicar(...hastaDatos, ...retroceder(3), { tipo: 'elegirSede', sedeId: 'sede-2' });
    expect(estado.sedeId).toBe('sede-2');
    expect(estado.fecha).toBeNull();
    expect(estado.hueco).toBeNull();
  });

  it('elegir la misma sede no limpia nada', () => {
    const estado = aplicar(...hastaDatos, ...retroceder(3), { tipo: 'elegirSede', sedeId: 'sede-1' });
    expect(estado.fecha).toBe('2026-11-10');
    expect(estado.hueco).toEqual(hueco);
  });

  it('cambiar de servicio limpia la fecha y la hora: la duración decide si el día tiene hueco', () => {
    const estado = aplicar(...hastaDatos, ...retroceder(3), { tipo: 'alternarServicio', servicio: barba });
    expect(estado.hueco).toBeNull();
    expect(estado.fecha).toBeNull();
    expect(estado.sedeId).toBe('sede-1');
    // Sin fecha no se puede continuar: el cliente tiene que volver a elegir día.
    expect(reductor({ ...estado, paso: 'fecha' }, { tipo: 'avanzar' }).paso).toBe('fecha');
  });

  it('cambiar de fecha limpia la hora elegida', () => {
    const estado = aplicar(...hastaDatos, ...retroceder(2), { tipo: 'elegirFecha', fecha: '2026-11-11' });
    expect(estado.fecha).toBe('2026-11-11');
    expect(estado.hueco).toBeNull();
  });

  it('retroceder desde datos vuelve a hora conservando lo elegido', () => {
    const estado = aplicar(...hastaDatos, { tipo: 'retroceder' });
    expect(estado.paso).toBe('hora');
    expect(estado.hueco).toEqual(hueco);
    expect(estado.fecha).toBe('2026-11-10');
    expect(estado.servicios).toEqual([corte]);
  });

  it('no retrocede desde el primer paso ni desde listo', () => {
    expect(aplicar({ tipo: 'retroceder' }).paso).toBe('servicio');
    expect(aplicar(...hastaDatos, { tipo: 'confirmar' }, { tipo: 'retroceder' }).paso).toBe('listo');
  });

  it('no acepta un hueco no disponible', () => {
    const ocupado: HuecoPublico = { ...hueco, disponible: false, motivo: 'NO_CABE' };
    const estado = aplicar(...hastaHora, { tipo: 'elegirHora', hueco: ocupado }, { tipo: 'avanzar' });
    expect(estado.hueco).toBeNull();
    expect(estado.paso).toBe('hora');
  });

  it('ignora las elecciones que no corresponden al paso en que se está', () => {
    expect(aplicar({ tipo: 'elegirFecha', fecha: '2026-11-10' }).fecha).toBeNull();
    expect(aplicar(...hastaFecha, { tipo: 'elegirHora', hueco }).hueco).toBeNull();
    expect(aplicar(...hastaDatos, { tipo: 'confirmar' }, { tipo: 'elegirSede', sedeId: 'x' }).sedeId).toBe('sede-1');
  });

  it('ignora cambiar de sede o de servicio desde el paso de fecha', () => {
    const estado = aplicar(...hastaFecha);
    expect(reductor(estado, { tipo: 'elegirSede', sedeId: 'sede-2' })).toBe(estado);
    expect(reductor(estado, { tipo: 'alternarServicio', servicio: barba })).toBe(estado);
  });

  it('no confirma fuera del paso de datos', () => {
    expect(aplicar(...hastaHora, { tipo: 'confirmar' }).paso).toBe('hora');
  });

  it('elegir barbero solo vale en el paso de hora y limpia la hora elegida', () => {
    expect(aplicar(...hastaFecha, { tipo: 'elegirBarbero', barberoId: 'b-1' }).barberoId).toBeNull();
    const estado = aplicar(...hastaHora, { tipo: 'elegirHora', hueco }, { tipo: 'elegirBarbero', barberoId: 'b-1' });
    expect(estado.barberoId).toBe('b-1');
    expect(estado.hueco).toBeNull();
  });

  it('volver a «cualquier barbero» (null) quita el barbero elegido', () => {
    const estado = aplicar(...hastaHora, { tipo: 'elegirBarbero', barberoId: 'b-1' }, { tipo: 'elegirBarbero', barberoId: null });
    expect(estado.barberoId).toBeNull();
  });

  it('cambiar de sede limpia el barbero: uno de otra sede no atiende en la nueva', () => {
    const estado = aplicar(
      ...hastaHora,
      { tipo: 'elegirBarbero', barberoId: 'b-1' },
      ...retroceder(2),
      { tipo: 'elegirSede', sedeId: 'sede-2' },
    );
    expect(estado.barberoId).toBeNull();
  });

  it('cambiar de servicio o de fecha conserva el barbero', () => {
    const base = [...hastaHora, { tipo: 'elegirBarbero', barberoId: 'b-1' } as const];
    expect(aplicar(...base, ...retroceder(2), { tipo: 'elegirFecha', fecha: '2026-11-11' }).barberoId).toBe('b-1');
    expect(
      aplicar(...base, ...retroceder(2), { tipo: 'alternarServicio', servicio: barba }).barberoId,
    ).toBe('b-1');
  });

  it('soltarHora quita la hora elegida cuando el servidor dice que se ocupó, desde hora o desde datos', () => {
    const enHora = aplicar(...hastaDatos, { tipo: 'retroceder' }, { tipo: 'soltarHora' });
    expect(enHora.hueco).toBeNull();
    expect(enHora.paso).toBe('hora');
    expect(enHora.fecha).toBe('2026-11-10');

    const enDatos = aplicar(...hastaDatos, { tipo: 'soltarHora' });
    expect(enDatos.hueco).toBeNull();
    expect(enDatos.paso).toBe('datos');
    expect(enDatos.servicios).toEqual([corte]);
  });

  it('soltarHora no actúa en los demás pasos', () => {
    const enFecha = aplicar(...hastaFecha);
    expect(reductor(enFecha, { tipo: 'soltarHora' })).toBe(enFecha);
    const enListo = aplicar(...hastaDatos, { tipo: 'confirmar' });
    expect(reductor(enListo, { tipo: 'soltarHora' })).toBe(enListo);
  });

  it('no muta el estado que recibe, ni en las ramas que construyen arrays', () => {
    // Congelado en profundidad: en modo estricto, cualquier mutación lanza en el sitio exacto.
    const enServicio = deepFreeze(
      aplicar({ tipo: 'alternarServicio', servicio: corte }, { tipo: 'elegirSede', sedeId: 'sede-1' }),
    );
    const enFecha = deepFreeze(aplicar(...hastaFecha));
    const enHora = deepFreeze(aplicar(...hastaHora));
    // Con una hora elegida: si no, `soltarHora` saldría por su guard sin visitar la rama que construye el estado nuevo.
    const enHoraConHueco = deepFreeze(aplicar(...hastaHora, { tipo: 'elegirHora', hueco }));
    const enDatos = deepFreeze(aplicar(...hastaDatos));

    // Cada acción se aplica desde un paso donde de verdad actúa (no sale por el guard).
    expect(reductor(enServicio, { tipo: 'alternarServicio', servicio: barba }).servicios).toEqual([corte, barba]);
    expect(reductor(enServicio, { tipo: 'alternarServicio', servicio: corte }).servicios).toEqual([]);
    expect(reductor(enServicio, { tipo: 'elegirSede', sedeId: 'sede-2' }).sedeId).toBe('sede-2');
    expect(reductor(enServicio, { tipo: 'avanzar' }).paso).toBe('fecha');
    expect(reductor(enFecha, { tipo: 'elegirFecha', fecha: '2026-11-11' }).fecha).toBe('2026-11-11');
    expect(reductor(enFecha, { tipo: 'retroceder' }).paso).toBe('servicio');
    expect(reductor(enHora, { tipo: 'elegirHora', hueco }).hueco).toEqual(hueco);
    expect(reductor(enDatos, { tipo: 'retroceder' }).paso).toBe('hora');
    expect(reductor(enDatos, { tipo: 'confirmar' }).paso).toBe('listo');
    expect(reductor(enHora, { tipo: 'elegirBarbero', barberoId: 'b-1' }).barberoId).toBe('b-1');
    const sinHora = reductor(enHoraConHueco, { tipo: 'soltarHora' });
    expect(sinHora).not.toBe(enHoraConHueco);
    expect(sinHora.hueco).toBeNull();
    expect(reductor(enDatos, { tipo: 'soltarHora' }).hueco).toBeNull();
  });
});
