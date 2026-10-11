import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import {
  CODIGOS_ERROR,
  cambiarPasswordSchema,
  loginSchema,
  restablecerPasswordSchema,
  solicitarRecuperacionSchema,
  type UsuarioSesion,
} from '@cds/shared';
import { Publico, UsuarioActual } from '../../comun/autenticacion/decoradores.js';
import type { UsuarioAutenticado } from '../../comun/autenticacion/tipos.js';
import { validar } from '../../comun/validacion/zod.pipe.js';
import { ErrorNegocio } from '../../comun/excepciones/error-negocio.js';
import { AutenticacionService } from './autenticacion.service.js';

/** Nombre de la cookie del refresh token. */
const COOKIE_REFRESH = 'cds_rt';

@Controller('auth')
export class AutenticacionController {
  constructor(
    private readonly servicio: AutenticacionService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Inicio de sesión.
   *
   * El access token se devuelve en el cuerpo (el frontend lo guarda en memoria,
   * no en localStorage) y el refresh token va en una cookie httpOnly +
   * SameSite=Strict. Así un XSS en el panel no puede leer el refresh token, y
   * un CSRF no puede usarlo contra otra ruta.
   *
   * Límite: 5 intentos por minuto desde la misma IP, además del bloqueo por
   * cuenta que aplica el servicio.
   */
  @Publico()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(validar(loginSchema)) datos: { email: string; password: string; recordarme: boolean },
    @Req() peticion: Request,
    @Res({ passthrough: true }) respuesta: Response,
  ) {
    const resultado = await this.servicio.iniciarSesion(datos, {
      ip: peticion.ip,
      userAgent: peticion.headers['user-agent'],
    });

    this.ponerCookieRefresh(respuesta, resultado.refreshToken);

    return {
      accessToken: resultado.accessToken,
      expiraEn: resultado.expiraEn,
      usuario: resultado.usuario,
    };
  }

  /** Canjea la cookie de refresco por un access token nuevo. */
  @Publico()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refrescar')
  @HttpCode(HttpStatus.OK)
  async refrescar(@Req() peticion: Request, @Res({ passthrough: true }) respuesta: Response) {
    const token = (peticion.cookies as Record<string, string> | undefined)?.[COOKIE_REFRESH];
    if (!token) throw ErrorNegocio.noAutenticado(CODIGOS_ERROR.TOKEN_INVALIDO);

    try {
      const resultado = await this.servicio.refrescar(token, {
        ip: peticion.ip,
        userAgent: peticion.headers['user-agent'],
      });
      this.ponerCookieRefresh(respuesta, resultado.refreshToken);
      return {
        accessToken: resultado.accessToken,
        expiraEn: resultado.expiraEn,
        usuario: resultado.usuario,
      };
    } catch (error) {
      // Si el refresco falla, la cookie ya no sirve: se borra para que el
      // navegador no siga reintentando con un token muerto.
      this.borrarCookieRefresh(respuesta);
      throw error;
    }
  }

  @Post('cerrar-sesion')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cerrarSesion(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Req() peticion: Request,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<void> {
    const sesionId = (peticion as { sesionId?: string }).sesionId;
    await this.servicio.cerrarSesion(sesionId, usuario.id);
    this.borrarCookieRefresh(respuesta);
  }

  /** Cierra la sesión en todos los dispositivos. */
  @Post('cerrar-todas')
  @HttpCode(HttpStatus.OK)
  async cerrarTodas(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Res({ passthrough: true }) respuesta: Response,
  ) {
    const cerradas = await this.servicio.cerrarTodasLasSesiones(usuario.id);
    this.borrarCookieRefresh(respuesta);
    return { cerradas };
  }

  /** Datos del usuario de la sesión actual: lo primero que pide el panel. */
  @Get('yo')
  yo(@UsuarioActual() usuario: UsuarioAutenticado): Partial<UsuarioSesion> & { id: string } {
    return {
      id: usuario.id,
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      email: usuario.email,
      rol: usuario.rol,
      sedeId: usuario.sedeId,
      permisos: usuario.permisos,
      debeCambiarPassword: usuario.debeCambiarPassword,
    };
  }

  /**
   * Pide el código de recuperación.
   *
   * Responde siempre lo mismo, exista el correo o no: este formulario no puede
   * servir para averiguar qué cuentas existen.
   */
  @Publico()
  @Throttle({ default: { limit: 3, ttl: 300_000 } })
  @Post('recuperar')
  @HttpCode(HttpStatus.OK)
  async recuperar(
    @Body(validar(solicitarRecuperacionSchema)) datos: { email: string },
    @Req() peticion: Request,
  ) {
    await this.servicio.solicitarRecuperacion(datos.email, peticion.ip);
    return {
      mensaje:
        'Si el correo está registrado, te enviamos un código de verificación. Revisa tu bandeja de entrada.',
    };
  }

  @Publico()
  @Throttle({ default: { limit: 10, ttl: 300_000 } })
  @Post('restablecer')
  @HttpCode(HttpStatus.OK)
  async restablecer(
    @Body(validar(restablecerPasswordSchema))
    datos: { email: string; codigo: string; password: string; confirmacion: string },
    @Req() peticion: Request,
  ) {
    await this.servicio.restablecerPassword(datos, peticion.ip);
    return { mensaje: 'Contraseña actualizada. Ya puedes iniciar sesión.' };
  }

  @Post('cambiar-password')
  @HttpCode(HttpStatus.OK)
  async cambiarPassword(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body(validar(cambiarPasswordSchema))
    datos: { passwordActual: string; password: string; confirmacion: string },
    @Req() peticion: Request,
    @Res({ passthrough: true }) respuesta: Response,
  ) {
    await this.servicio.cambiarPassword(usuario.id, datos, {
      ip: peticion.ip,
      userAgent: peticion.headers['user-agent'],
    });
    // Se cerraron todas las sesiones, incluida esta: hay que volver a entrar.
    this.borrarCookieRefresh(respuesta);
    return { mensaje: 'Contraseña actualizada. Vuelve a iniciar sesión.' };
  }

  // --------------------------- cookies -----------------------------------

  private ponerCookieRefresh(respuesta: Response, token: string): void {
    const produccion = this.config.get<string>('NODE_ENV') === 'production';
    respuesta.cookie(COOKIE_REFRESH, token, {
      httpOnly: true,
      secure: produccion,
      sameSite: 'strict',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  private borrarCookieRefresh(respuesta: Response): void {
    const produccion = this.config.get<string>('NODE_ENV') === 'production';
    respuesta.clearCookie(COOKIE_REFRESH, {
      httpOnly: true,
      secure: produccion,
      sameSite: 'strict',
      path: '/',
    });
  }
}
