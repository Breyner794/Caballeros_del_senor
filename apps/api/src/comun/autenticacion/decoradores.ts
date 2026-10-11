import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Permiso, Rol } from '@cds/shared';
import type { UsuarioAutenticado } from './tipos.js';

export const CLAVE_PUBLICO = 'es_publico';
export const CLAVE_PERMISOS = 'permisos_requeridos';
export const CLAVE_ROLES = 'roles_requeridos';

/**
 * Marca una ruta como pública.
 *
 * El guard de autenticación está activo globalmente: todo exige sesión salvo
 * lo que se marque aquí. Es al revés de lo habitual a propósito — olvidarse de
 * proteger una ruta nueva es un fallo de seguridad silencioso; olvidarse de
 * abrir una ruta pública se nota en el primer clic.
 */
export const Publico = () => SetMetadata(CLAVE_PUBLICO, true);

/** Exige todos los permisos indicados. */
export const RequierePermisos = (...permisos: Permiso[]) => SetMetadata(CLAVE_PERMISOS, permisos);

/** Exige que el rol esté en la lista (útil cuando el permiso no basta). */
export const RequiereRoles = (...roles: Rol[]) => SetMetadata(CLAVE_ROLES, roles);

/** Inyecta el usuario autenticado: `@UsuarioActual() usuario: UsuarioAutenticado` */
export const UsuarioActual = createParamDecorator(
  (campo: keyof UsuarioAutenticado | undefined, ctx: ExecutionContext) => {
    const peticion = ctx.switchToHttp().getRequest<Request>();
    const usuario = peticion.usuario;
    if (!usuario) return undefined;
    return campo ? usuario[campo] : usuario;
  },
);

/** Metadatos de la petición para auditoría: ip, agente e id de correlación. */
export const ContextoPeticion = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const peticion = ctx.switchToHttp().getRequest<Request>();
  return {
    ip: peticion.ip,
    userAgent: peticion.headers['user-agent'],
    requestId: peticion.requestId,
  };
});
