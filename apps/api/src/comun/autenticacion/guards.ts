import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { CODIGOS_ERROR, PERMISOS_POR_ROL, type Permiso, type Rol } from '@cds/shared';
import { ErrorNegocio } from '../excepciones/error-negocio.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CLAVE_PERMISOS, CLAVE_PUBLICO, CLAVE_ROLES } from './decoradores.js';
import type { PayloadAccessToken, UsuarioAutenticado } from './tipos.js';

/**
 * Guard de autenticación, activo globalmente.
 *
 * Verifica la firma del access token y vuelve a leer el usuario de la base de
 * datos en cada petición. Lo segundo es una decisión consciente: confiar solo
 * en el contenido del token significa que desactivar a un empleado no surte
 * efecto hasta que su token caduca, y en un sistema donde se despide a alguien
 * y hay que cortarle el acceso ya, eso no vale. El coste es una consulta por
 * petición a una tabla pequeña y por clave primaria.
 */
@Injectable()
export class GuardAutenticacion implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const esPublico = this.reflector.getAllAndOverride<boolean>(CLAVE_PUBLICO, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (esPublico) return true;

    const peticion = contexto.switchToHttp().getRequest<Request>();
    const token = this.extraerToken(peticion);
    if (!token) throw ErrorNegocio.noAutenticado(CODIGOS_ERROR.TOKEN_INVALIDO);

    let payload: PayloadAccessToken;
    try {
      payload = await this.jwt.verifyAsync<PayloadAccessToken>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw ErrorNegocio.noAutenticado(CODIGOS_ERROR.SESION_EXPIRADA);
    }

    if (payload.tipo !== 'acceso') {
      // Un refresh token no sirve para llamar a la API.
      throw ErrorNegocio.noAutenticado(CODIGOS_ERROR.TOKEN_INVALIDO);
    }

    const usuario = await this.prisma.usuario.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        nombre: true,
        apellido: true,
        email: true,
        rol: true,
        activo: true,
        sedeId: true,
        debeCambiarPassword: true,
        eliminadoEn: true,
        sedesPermitidas: { select: { sedeId: true } },
      },
    });

    if (!usuario || usuario.eliminadoEn) {
      throw ErrorNegocio.noAutenticado(CODIGOS_ERROR.TOKEN_INVALIDO);
    }
    if (!usuario.activo) {
      throw new ErrorNegocio(CODIGOS_ERROR.USUARIO_INACTIVO, 401);
    }

    // La sesión debe seguir viva: cerrar sesión en un dispositivo o revocar la
    // familia por token reutilizado corta el acceso de inmediato.
    const sesion = await this.prisma.sesion.findFirst({
      where: { id: payload.sid, usuarioId: usuario.id, revocadaEn: null },
      select: { id: true },
    });
    if (!sesion) throw ErrorNegocio.noAutenticado(CODIGOS_ERROR.SESION_EXPIRADA);

    const rol = usuario.rol as Rol;
    const autenticado: UsuarioAutenticado = {
      id: usuario.id,
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      email: usuario.email,
      rol,
      sedeId: usuario.sedeId,
      sedesPermitidas: [
        ...new Set([
          ...(usuario.sedeId ? [usuario.sedeId] : []),
          ...usuario.sedesPermitidas.map((s) => s.sedeId),
        ]),
      ],
      permisos: [...PERMISOS_POR_ROL[rol]],
      debeCambiarPassword: usuario.debeCambiarPassword,
    };

    peticion.usuario = autenticado;
    // El id de sesión permite cerrar sesión solo en este dispositivo.
    (peticion as { sesionId?: string }).sesionId = payload.sid;
    return true;
  }

  private extraerToken(peticion: Request): string | null {
    const cabecera = peticion.headers.authorization;
    if (cabecera?.startsWith('Bearer ')) return cabecera.slice(7).trim() || null;
    return null;
  }
}

/**
 * Guard de autorización por permisos.
 *
 * Trabaja sobre el catálogo de permisos del paquete compartido, no sobre una
 * lista de roles escrita a mano en cada controlador: cuando el cliente pida un
 * rol nuevo, se define una vez en `PERMISOS_POR_ROL` y todas las rutas quedan
 * bien sin tocarlas.
 */
@Injectable()
export class GuardPermisos implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(contexto: ExecutionContext): boolean {
    const permisos = this.reflector.getAllAndOverride<Permiso[]>(CLAVE_PERMISOS, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    const roles = this.reflector.getAllAndOverride<Rol[]>(CLAVE_ROLES, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);

    if ((!permisos || permisos.length === 0) && (!roles || roles.length === 0)) return true;

    const peticion = contexto.switchToHttp().getRequest<Request>();
    const usuario = peticion.usuario;
    if (!usuario) throw new UnauthorizedException();

    if (roles && roles.length > 0 && !roles.includes(usuario.rol)) {
      throw ErrorNegocio.sinPermiso();
    }

    if (permisos && permisos.length > 0) {
      const faltantes = permisos.filter((p) => !usuario.permisos.includes(p));
      if (faltantes.length > 0) throw ErrorNegocio.sinPermiso();
    }

    return true;
  }
}
