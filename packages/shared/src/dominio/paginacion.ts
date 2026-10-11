/**
 * Paginación.
 *
 * Toda consulta de listado va paginada: nunca un `findMany` sin límite. Hay
 * dos modos y cada uno tiene su sitio:
 *
 *  - Por página (`PaginaRespuesta`): para las tablas del panel, donde el
 *    usuario quiere saltar a la página 7 y ver el total de registros.
 *  - Por cursor (`CursorRespuesta`): para listas largas de scroll infinito y
 *    para exportaciones del contador. No usa OFFSET, así que el rendimiento no
 *    se degrada al avanzar: la página 500 cuesta lo mismo que la primera.
 */

export const LIMITE_DEFECTO = 20;
export const LIMITE_MAXIMO = 100;
/** Solo para exportaciones del contador, que recorren en lotes grandes. */
export const LIMITE_MAXIMO_EXPORTACION = 1000;

export interface ParametrosPagina {
  pagina?: number;
  limite?: number;
  orden?: 'asc' | 'desc';
  ordenarPor?: string;
  buscar?: string;
}

export interface MetaPagina {
  pagina: number;
  limite: number;
  total: number;
  totalPaginas: number;
  hayAnterior: boolean;
  haySiguiente: boolean;
}

export interface PaginaRespuesta<T> {
  datos: T[];
  meta: MetaPagina;
}

export interface CursorRespuesta<T> {
  datos: T[];
  /** Pasar en la siguiente petición. Null = no hay más. */
  siguienteCursor: string | null;
  limite: number;
}

export function construirMeta(total: number, pagina: number, limite: number): MetaPagina {
  const totalPaginas = limite > 0 ? Math.max(1, Math.ceil(total / limite)) : 1;
  return {
    pagina,
    limite,
    total,
    totalPaginas,
    hayAnterior: pagina > 1,
    haySiguiente: pagina < totalPaginas,
  };
}

/** Traduce página/límite a los `skip`/`take` de Prisma, ya acotados. */
export function calcularSalto(
  pagina = 1,
  limite = LIMITE_DEFECTO,
  limiteMaximo = LIMITE_MAXIMO,
): { skip: number; take: number; pagina: number; limite: number } {
  const limiteSeguro = Math.min(Math.max(1, Math.trunc(limite) || LIMITE_DEFECTO), limiteMaximo);
  const paginaSegura = Math.max(1, Math.trunc(pagina) || 1);
  return {
    skip: (paginaSegura - 1) * limiteSeguro,
    take: limiteSeguro,
    pagina: paginaSegura,
    limite: limiteSeguro,
  };
}
