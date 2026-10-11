import type { Permiso, Rol } from '@cds/shared';

/** Usuario resuelto a partir del access token, disponible en cada petición. */
export interface UsuarioAutenticado {
  id: string;
  nombre: string;
  apellido: string | null;
  email: string;
  rol: Rol;
  /** Sede principal. Null para admin y contador, que no están atados a una. */
  sedeId: string | null;
  /** Sedes donde puede operar. Para el admin se interpreta como "todas". */
  sedesPermitidas: string[];
  permisos: Permiso[];
  debeCambiarPassword: boolean;
}

/** Contenido del access token. Deliberadamente mínimo y de vida corta. */
export interface PayloadAccessToken {
  /** Id del usuario */
  sub: string;
  rol: Rol;
  /** Id de la sesión: permite invalidar un dispositivo concreto. */
  sid: string;
  tipo: 'acceso';
  iat?: number;
  exp?: number;
}

export interface PayloadRefreshToken {
  sub: string;
  sid: string;
  /** Familia de rotación: si se reutiliza un token, se revoca la familia. */
  fam: string;
  tipo: 'refresco';
  iat?: number;
  exp?: number;
}

declare module 'express' {
  interface Request {
    usuario?: UsuarioAutenticado;
    requestId?: string;
  }
}
