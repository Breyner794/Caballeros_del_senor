import { CODIGOS_ERROR, MENSAJES_ERROR, type RespuestaError } from '@cds/shared';

/**
 * `??` no cubre la cadena vacía, y crear la variable en el panel de despliegue
 * y dejarla sin valor es el error más fácil de cometer: con `''` todas las
 * peticiones saldrían a una URL relativa y la web no cargaría nada, solo en
 * producción. Vacía equivale a no configurada.
 */
const BASE = import.meta.env.VITE_API_URL?.trim() || 'http://localhost:3001/api/v1';

/**
 * Cliente HTTP de la web pública.
 *
 * Es deliberadamente mucho más simple que el del panel: el canal público no
 * tiene sesión. No hay access token, ni refresco, ni rotación, ni cookie. Solo
 * `fetch`, la cabecera del token de gestión cuando lo hay y la traducción de
 * los errores de la API.
 *
 * Ante un 401 no se refresca nada: significa que el enlace de gestión no
 * vale, y eso se le cuenta al cliente en lugar de reintentarlo.
 */

/** Token del enlace de gestión («Mi reserva»). Vive solo en memoria. */
let tokenGestion: string | null = null;

/** Fija (o borra, con `null`) el token que viaja en `X-Token-Gestion`. */
export function guardarTokenGestion(token: string | null): void {
  tokenGestion = token;
}

/**
 * Error de la API con el código de negocio.
 *
 * El frontend ramifica por `codigo`, nunca por `status`. `detalle` no es
 * decorativo: con `RESERVA_SOLAPADA` trae los huecos recalculados para
 * repintar la rejilla bajo el aviso «Ese horario acaba de ocuparse».
 */
export class ErrorApi extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
    readonly status: number,
    readonly campos?: Record<string, string[]>,
    readonly detalle?: unknown,
    readonly requestId?: string,
  ) {
    super(mensaje);
    this.name = 'ErrorApi';
  }

  /** Alias legible de `message`: el resto de la web habla en español. */
  get mensaje(): string {
    return this.message;
  }
}

interface OpcionesPeticion extends Omit<RequestInit, 'body' | 'headers'> {
  body?: unknown;
  /** Solo un objeto plano: es lo que `peticion` sabe mezclar con sus cabeceras. */
  headers?: Record<string, string>;
}

export async function peticion<T>(ruta: string, opciones: OpcionesPeticion = {}): Promise<T> {
  const { body, headers, ...resto } = opciones;

  let respuesta: Response;
  try {
    respuesta = await fetch(`${BASE}${ruta}`, {
      ...resto,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(tokenGestion ? { 'x-token-gestion': tokenGestion } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (causa) {
    // Una cancelación deliberada no es un fallo de red: se deja pasar tal cual.
    if (causa instanceof DOMException && causa.name === 'AbortError') throw causa;
    // Sin conexión `fetch` rechaza con un TypeError sin código. Se traduce para
    // que las pantallas ramifiquen siempre por `codigo`, también aquí.
    throw new ErrorApi(CODIGOS_ERROR.ERROR_RED, MENSAJES_ERROR.ERROR_RED, 0);
  }

  if (respuesta.status === 204) return undefined as T;

  const texto = await respuesta.text();
  const cuerpo = leerJson(texto);

  if (respuesta.ok) return cuerpo as T;

  const error = cuerpo as Partial<RespuestaError> | null;

  throw new ErrorApi(
    error?.codigo ?? 'ERROR_DESCONOCIDO',
    error?.mensaje ?? 'No se pudo completar la operación.',
    respuesta.status,
    error?.campos,
    error?.detalle,
    error?.requestId,
  );
}

/** Un proxy o un balanceador pueden devolver HTML en un error: no es motivo para romper aquí. */
function leerJson(texto: string): unknown {
  if (!texto) return null;
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}
