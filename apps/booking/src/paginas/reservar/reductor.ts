import type { HuecoPublico, ServicioPublico } from '@cds/shared';

/** Pasos del asistente, en el orden en que el cliente los recorre. */
export type PasoReserva = 'servicio' | 'fecha' | 'hora' | 'datos' | 'listo';

const ORDEN_PASOS: readonly PasoReserva[] = ['servicio', 'fecha', 'hora', 'datos', 'listo'];

/**
 * Lo elegido hasta ahora. Guarda los servicios completos (no solo el id)
 * porque el precio y la duración totales salen de ellos.
 *
 * La fecha viaja como `YYYY-MM-DD` en la zona horaria del negocio, igual que
 * la API; el hueco conserva su `inicioEn`, que es lo que se envía al reservar.
 */
export interface EstadoReserva {
  paso: PasoReserva;
  servicios: ServicioPublico[];
  sedeId: string | null;
  /** `null` es «cualquier barbero»: la API asigna uno libre en esa hora. */
  barberoId: string | null;
  fecha: string | null;
  hueco: HuecoPublico | null;
}

export type AccionReserva =
  /** Marca el servicio si no estaba elegido y lo quita si lo estaba. */
  | { tipo: 'alternarServicio'; servicio: ServicioPublico }
  | { tipo: 'elegirSede'; sedeId: string }
  /** Solo en «hora». `null` vuelve a «cualquier barbero». */
  | { tipo: 'elegirBarbero'; barberoId: string | null }
  | { tipo: 'elegirFecha'; fecha: string }
  | { tipo: 'elegirHora'; hueco: HuecoPublico }
  /** El servidor dijo que la hora elegida ya no está libre: se descarta. */
  | { tipo: 'soltarHora' }
  | { tipo: 'avanzar' }
  | { tipo: 'retroceder' }
  /** La reserva se creó en el servidor: pasa de «datos» a «listo». */
  | { tipo: 'confirmar' };

export const estadoInicial: EstadoReserva = {
  paso: 'servicio',
  servicios: [],
  sedeId: null,
  barberoId: null,
  fecha: null,
  hueco: null,
};

export function totalPrecio(estado: EstadoReserva): number {
  return estado.servicios.reduce((suma, servicio) => suma + servicio.precio, 0);
}

export function totalDuracion(estado: EstadoReserva): number {
  return estado.servicios.reduce((suma, servicio) => suma + servicio.duracionMinutos, 0);
}

/** ¿Está lo necesario para salir del paso actual hacia el siguiente? */
function puedeAvanzar(estado: EstadoReserva): boolean {
  switch (estado.paso) {
    case 'servicio':
      return estado.servicios.length > 0 && estado.sedeId !== null;
    case 'fecha':
      return estado.fecha !== null;
    case 'hora':
      return estado.hueco !== null;
    default:
      // «datos» no avanza con `avanzar`: se sale con `confirmar`.
      return false;
  }
}

/**
 * Reductor puro: nunca modifica el estado recibido y siempre devuelve uno
 * nuevo, o el mismo objeto cuando la acción no procede.
 *
 * Cada elección solo vale en su paso. Así no hay forma de llegar a una
 * combinación imposible (una hora sin fecha, o una fecha sin sede), y la
 * pantalla no tiene que volver a comprobarlo.
 *
 * Los borrados siguen una sola idea: lo elegido después depende de lo elegido
 * antes.
 *  · Los huecos pertenecen a una sede, así que cambiar de sede limpia fecha, barbero y hora
 *    (un barbero de una sede no atiende en otra).
 *  · Los huecos dependen del barbero, así que cambiar de barbero limpia la hora.
 *  · La duración decide si un hueco cabe, así que cambiar de servicio limpia la hora.
 *  · Los huecos son de un día, así que cambiar de fecha limpia la hora.
 */
export function reductor(estado: EstadoReserva, accion: AccionReserva): EstadoReserva {
  switch (accion.tipo) {
    case 'alternarServicio': {
      if (estado.paso !== 'servicio') return estado;
      const yaElegido = estado.servicios.some((s) => s.id === accion.servicio.id);
      const servicios = yaElegido
        ? estado.servicios.filter((s) => s.id !== accion.servicio.id)
        : [...estado.servicios, accion.servicio];
      return { ...estado, servicios, hueco: null };
    }
    case 'elegirSede': {
      if (estado.paso !== 'servicio') return estado;
      if (estado.sedeId === accion.sedeId) return estado;
      return { ...estado, sedeId: accion.sedeId, barberoId: null, fecha: null, hueco: null };
    }
    case 'elegirFecha': {
      if (estado.paso !== 'fecha') return estado;
      if (estado.fecha === accion.fecha) return estado;
      return { ...estado, fecha: accion.fecha, hueco: null };
    }
    case 'elegirHora': {
      if (estado.paso !== 'hora' || !accion.hueco.disponible) return estado;
      return { ...estado, hueco: accion.hueco };
    }
    case 'elegirBarbero': {
      if (estado.paso !== 'hora') return estado;
      if (estado.barberoId === accion.barberoId) return estado;
      return { ...estado, barberoId: accion.barberoId, hueco: null };
    }
    case 'soltarHora': {
      // También desde «datos»: es donde el servidor descubre que la hora se ocupó.
      if ((estado.paso !== 'hora' && estado.paso !== 'datos') || estado.hueco === null) return estado;
      return { ...estado, hueco: null };
    }
    case 'avanzar': {
      if (!puedeAvanzar(estado)) return estado;
      return { ...estado, paso: ORDEN_PASOS[ORDEN_PASOS.indexOf(estado.paso) + 1] };
    }
    case 'retroceder': {
      // Desde «listo» la cita ya existe: volver atrás no la deshace.
      if (estado.paso === 'servicio' || estado.paso === 'listo') return estado;
      return { ...estado, paso: ORDEN_PASOS[ORDEN_PASOS.indexOf(estado.paso) - 1] };
    }
    case 'confirmar': {
      if (estado.paso !== 'datos') return estado;
      return { ...estado, paso: 'listo' };
    }
  }
}
