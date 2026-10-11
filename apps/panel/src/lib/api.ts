import type { RespuestaError, RespuestaLogin, UsuarioSesion } from '@cds/shared';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api/v1';

/**
 * Cliente HTTP del panel.
 *
 * Dos decisiones que vienen del diseño de seguridad de la API:
 *
 *  · El access token vive **solo en memoria** de este módulo, nunca en
 *    localStorage. Un XSS puede leer localStorage; no puede leer una variable
 *    de un módulo cerrado. El coste es que al recargar la página hay que
 *    pedir uno nuevo, y de eso se encarga la cookie de refresco.
 *  · Cada petición va con `credentials: 'include'` para que viaje la cookie
 *    httpOnly del refresh token.
 *
 * Cuando una petición recibe 401 por token caducado, se refresca **una sola
 * vez** y se reintenta. Si varias peticiones caducan a la vez (lo normal al
 * volver a una pestaña abandonada), todas esperan al mismo refresco en lugar
 * de disparar cinco, que además invalidarían el token unas a otras por la
 * rotación.
 */

let accessToken: string | null = null;
let refrescoEnCurso: Promise<boolean> | null = null;
let alPerderSesion: (() => void) | null = null;

export function guardarToken(token: string | null): void {
  accessToken = token;
}

export function tokenActual(): string | null {
  return accessToken;
}

/** El contexto de autenticación registra aquí qué hacer al perder la sesión. */
export function registrarCierreForzado(callback: () => void): void {
  alPerderSesion = callback;
}

/** Error de la API con el código de negocio y los errores por campo. */
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

  /** Alias legible de `message`: el resto del panel habla en español. */
  get mensaje(): string {
    return this.message;
  }

  /** true si el error trae mensajes para pintar junto a los inputs. */
  get esDeValidacion(): boolean {
    return this.campos !== undefined && Object.keys(this.campos).length > 0;
  }
}

interface OpcionesPeticion extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Uso interno: evita bucles infinitos de refresco. */
  _reintento?: boolean;
  /** No intenta refrescar ni avisa de sesión perdida (login, refrescar). */
  sinSesion?: boolean;
}

async function peticion<T>(ruta: string, opciones: OpcionesPeticion = {}): Promise<T> {
  const { body, _reintento, sinSesion, headers, ...resto } = opciones;

  const respuesta = await fetch(`${BASE}${ruta}`, {
    ...resto,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken && !sinSesion ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (respuesta.status === 204) return undefined as T;

  const texto = await respuesta.text();
  const cuerpo = texto ? (JSON.parse(texto) as unknown) : null;

  if (respuesta.ok) return cuerpo as T;

  const error = cuerpo as RespuestaError | null;

  // Token caducado: un solo refresco compartido por todas las peticiones.
  if (respuesta.status === 401 && !_reintento && !sinSesion) {
    const refrescado = await refrescarUnaVez();
    if (refrescado) {
      return peticion<T>(ruta, { ...opciones, _reintento: true });
    }
    alPerderSesion?.();
  }

  throw new ErrorApi(
    error?.codigo ?? 'ERROR_DESCONOCIDO',
    error?.mensaje ?? 'No se pudo completar la operación.',
    respuesta.status,
    error?.campos,
    error?.detalle,
    error?.requestId,
  );
}

async function refrescarUnaVez(): Promise<boolean> {
  refrescoEnCurso ??= (async () => {
    try {
      const datos = await peticion<RespuestaLogin>('/auth/refrescar', {
        method: 'POST',
        sinSesion: true,
      });
      accessToken = datos.accessToken;
      return true;
    } catch (error) {
      // Si otra pestaña rotó el token un instante antes, esta llega con el
      // obsoleto. El navegador ya tiene la cookie nueva (se comparte entre
      // pestañas), así que un segundo intento funciona. El servidor concede
      // una ventana de gracia justo para esto.
      if (error instanceof ErrorApi && error.codigo === 'SESION_EXPIRADA') {
        await new Promise((listo) => setTimeout(listo, 400));
        try {
          const datos = await peticion<RespuestaLogin>('/auth/refrescar', {
            method: 'POST',
            sinSesion: true,
          });
          accessToken = datos.accessToken;
          return true;
        } catch {
          /* se cae al return de abajo */
        }
      }
      accessToken = null;
      return false;
    } finally {
      // Se libera en el siguiente tick para que las peticiones que llegaron
      // mientras se refrescaba reutilicen este resultado y no abran otro.
      setTimeout(() => {
        refrescoEnCurso = null;
      }, 0);
    }
  })();

  return refrescoEnCurso;
}

export const api = {
  get: <T>(ruta: string) => peticion<T>(ruta),
  post: <T>(ruta: string, body?: unknown) => peticion<T>(ruta, { method: 'POST', body }),
  patch: <T>(ruta: string, body?: unknown) => peticion<T>(ruta, { method: 'PATCH', body }),
  put: <T>(ruta: string, body?: unknown) => peticion<T>(ruta, { method: 'PUT', body }),
  delete: <T>(ruta: string) => peticion<T>(ruta, { method: 'DELETE' }),
};

// ============================ Autenticación ================================

export const autenticacion = {
  async iniciarSesion(email: string, password: string): Promise<RespuestaLogin> {
    const datos = await peticion<RespuestaLogin>('/auth/login', {
      method: 'POST',
      body: { email, password, recordarme: true },
      sinSesion: true,
    });
    accessToken = datos.accessToken;
    return datos;
  },

  /**
   * Al cargar la aplicación: ¿hay una sesión viva en la cookie?
   *
   * Pasa por el mismo guardia de una sola petición que usa el reintento tras
   * un 401. Sin eso, el doble montaje de React en desarrollo dispara dos
   * refrescos simultáneos con la misma cookie y el segundo parece un token
   * reutilizado: el servidor revocaría la sesión entera y el usuario volvería
   * al login cada vez que recarga.
   */
  async recuperarSesion(): Promise<RespuestaLogin | null> {
    const refrescado = await refrescarUnaVez();
    if (!refrescado) {
      accessToken = null;
      return null;
    }
    try {
      const usuario = await peticion<UsuarioSesion>('/auth/yo');
      return { accessToken: accessToken ?? '', expiraEn: 0, usuario };
    } catch {
      accessToken = null;
      return null;
    }
  },

  async cerrarSesion(): Promise<void> {
    try {
      await peticion<void>('/auth/cerrar-sesion', { method: 'POST' });
    } finally {
      accessToken = null;
    }
  },

  yo: () => peticion<UsuarioSesion>('/auth/yo'),

  solicitarRecuperacion: (email: string) =>
    peticion<{ mensaje: string }>('/auth/recuperar', {
      method: 'POST',
      body: { email },
      sinSesion: true,
    }),

  restablecer: (datos: { email: string; codigo: string; password: string; confirmacion: string }) =>
    peticion<{ mensaje: string }>('/auth/restablecer', {
      method: 'POST',
      body: datos,
      sinSesion: true,
    }),

  cambiarPassword: (datos: { passwordActual: string; password: string; confirmacion: string }) =>
    peticion<{ mensaje: string }>('/auth/cambiar-password', { method: 'POST', body: datos }),
};
