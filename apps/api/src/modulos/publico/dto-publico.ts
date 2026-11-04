import type {
  BarberoPublico,
  EstadoReserva,
  HuecoPublico,
  ReservaPublica,
  SedePublica,
  ServicioPublico,
} from '@cds/shared';

/**
 * Frontera contra fugas del canal público.
 *
 * Cada mapeador construye un objeto literal campo a campo. No se usa *spread*
 * de la entidad ni `delete`: lo que no se escribe aquí, no sale a internet.
 * Si mañana el `select` de Prisma del panel gana un campo, la respuesta pública
 * no cambia, y las pruebas de claves exactas lo vigilan.
 *
 * Las entradas se declaran de forma estructural y mínima (solo los campos que
 * el mapeador lee): así aceptan tanto la entidad completa como un `select`
 * recortado, y los campos extra se ignoran por construcción.
 */

/** Prisma devuelve `Decimal`; el contrato público usa número. */
type Numerico = { toNumber(): number } | number | string;

const aNumero = (valor: Numerico): number =>
  typeof valor === 'object' ? valor.toNumber() : Number(valor);

/** Los motivos que el cliente puede conocer; cualquier otro se descarta. */
const MOTIVOS_VISIBLES = ['ANTELACION', 'NO_CABE'] as const;

export interface SedeEntrada {
  id: string;
  nombre: string;
  direccion?: string | null;
  ciudad?: string | null;
  telefono?: string | null;
  mapsUrl?: string | null;
}

export interface ServicioEntrada {
  id: string;
  nombre: string;
  descripcion?: string | null;
  incluye?: string[] | null;
  precio: Numerico;
  duracionMinutos: number;
}

export interface UsuarioBarberoEntrada {
  id: string;
  nombre: string;
  alias?: string | null;
  bio?: string | null;
  fotoUrl?: string | null;
}

export interface HuecoEntrada {
  inicioEn: string;
  hora: string;
  disponible: boolean;
  /** Admite los motivos internos (OCUPADO, ALMUERZO, DESCANSO, PASADO): aquí se descartan. */
  motivo?: string;
}

/**
 * Línea congelada de la reserva. El nombre, precio y duración son los de
 * cuando se reservó; la descripción y lo que incluye vienen del catálogo y
 * pueden faltar si la consulta no los trajo.
 */
export interface LineaReservaEntrada {
  servicioId: string;
  nombreSnapshot: string;
  precioSnapshot: Numerico;
  duracionSnapshot: number;
  servicio?: { descripcion?: string | null; incluye?: string[] | null } | null;
}

export interface ReservaEntrada {
  codigo: string;
  estado: EstadoReserva | string;
  inicioEn: Date;
  finEn: Date;
  total: Numerico;
  sede: SedeEntrada;
  barbero: UsuarioBarberoEntrada;
  servicios: LineaReservaEntrada[];
}

export function aSedePublica(sede: SedeEntrada): SedePublica {
  return {
    id: sede.id,
    nombre: sede.nombre,
    direccion: sede.direccion ?? null,
    ciudad: sede.ciudad ?? null,
    telefono: sede.telefono ?? null,
    mapsUrl: sede.mapsUrl ?? null,
  };
}

/** No incluye `bufferMinutos`: es limpieza interna que el cliente no ve. */
export function aServicioPublico(servicio: ServicioEntrada): ServicioPublico {
  return {
    id: servicio.id,
    nombre: servicio.nombre,
    descripcion: servicio.descripcion ?? null,
    incluye: [...(servicio.incluye ?? [])],
    precio: aNumero(servicio.precio),
    duracionMinutos: servicio.duracionMinutos,
  };
}

/** `nombre` sale ya resuelto como `alias ?? nombre`; el nombre real no viaja si hay alias. */
export function aBarberoPublico(usuario: UsuarioBarberoEntrada): BarberoPublico {
  return {
    id: usuario.id,
    nombre: usuario.alias ?? usuario.nombre,
    bio: usuario.bio ?? null,
    fotoUrl: usuario.fotoUrl ?? null,
  };
}

/**
 * Colapsa los motivos internos: `OCUPADO`, `ALMUERZO`, `DESCANSO` (y `PASADO`)
 * salen como un hueco no disponible sin motivo, para no revelar la agenda.
 */
export function aHuecoPublico(hueco: HuecoEntrada): HuecoPublico {
  const motivo = MOTIVOS_VISIBLES.find((visible) => visible === hueco.motivo);
  return {
    inicioEn: hueco.inicioEn,
    hora: hueco.hora,
    disponible: hueco.disponible,
    ...(motivo ? { motivo } : {}),
  };
}

/**
 * `zona` queda en la firma por contrato con los llamadores; los instantes
 * viajan en ISO (UTC) y el cliente los formatea en la zona del negocio.
 */
export function aReservaPublica(reserva: ReservaEntrada, _zona: string): ReservaPublica {
  return {
    codigo: reserva.codigo,
    estado: reserva.estado as EstadoReserva,
    inicioEn: reserva.inicioEn.toISOString(),
    finEn: reserva.finEn.toISOString(),
    sede: aSedePublica(reserva.sede),
    barbero: aBarberoPublico(reserva.barbero),
    servicios: reserva.servicios.map((linea) =>
      aServicioPublico({
        id: linea.servicioId,
        nombre: linea.nombreSnapshot,
        descripcion: linea.servicio?.descripcion,
        incluye: linea.servicio?.incluye,
        precio: linea.precioSnapshot,
        duracionMinutos: linea.duracionSnapshot,
      }),
    ),
    total: aNumero(reserva.total),
  };
}
