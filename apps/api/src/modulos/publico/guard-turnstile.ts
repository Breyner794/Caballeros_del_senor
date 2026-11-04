import { CanActivate, ExecutionContext, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { CODIGOS_ERROR, MENSAJES_ERROR } from '@cds/shared';
import { ErrorNegocio } from '../../comun/excepciones/error-negocio.js';

const URL_VERIFICACION = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Sin tope, un Cloudflare lento dejaría la petición colgada indefinidamente. */
const TIEMPO_MAXIMO_MS = 5_000;

/** Longitud máxima que documenta Cloudflare para un token de Turnstile. */
const LONGITUD_MAXIMA_TOKEN = 2048;

/** Campo del cuerpo donde el frontend manda el token del widget. */
const CAMPO_TOKEN = 'tokenTurnstile';

/**
 * Captcha del canal público (Cloudflare Turnstile).
 *
 * El cliente no tiene cuenta ni contraseña: el captcha es lo que separa a una
 * persona de un bot que llena la agenda de citas falsas. Se aplica solo a los
 * `POST` (crear, cancelar y reprogramar); en las consultas de disponibilidad
 * rompería la navegación del calendario. Lee `tokenTurnstile` del cuerpo sin
 * asumir la forma del DTO, así sirve a las tres rutas.
 *
 * Si `TURNSTILE_SECRET_KEY` no está configurada, deja pasar y avisa en el log,
 * igual que `CorreoService` con Brevo: permite desarrollar y probar sin
 * credenciales. El contrapeso es `entorno.ts`, que en producción impide que la
 * API arranque sin la clave.
 *
 * Falla cerrado, y es deliberado: si Cloudflare no responde, la petición se
 * rechaza con `SERVICIO_EXTERNO_CAIDO`. Un control de seguridad que se abre
 * cuando su proveedor se cae no es un control. El coste aceptado es que una
 * caída de Cloudflare bloquea las reservas web mientras recepción sigue
 * tomándolas por teléfono.
 */
@Injectable()
export class GuardTurnstile implements CanActivate {
  private readonly logger = new Logger(GuardTurnstile.name);

  constructor(private readonly config: ConfigService) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const secreto = this.config.get<string>('TURNSTILE_SECRET_KEY');
    if (!secreto) {
      this.logger.warn('Turnstile sin configurar: se omite la verificación del captcha.');
      return true;
    }

    const peticion = contexto.switchToHttp().getRequest<Request>();
    const token = this.extraerToken(peticion.body);
    if (!token) throw this.captchaRechazado();

    const resultado = await this.verificar(secreto, token, peticion.ip);
    if (resultado !== true) throw this.captchaRechazado();
    return true;
  }

  private extraerToken(cuerpo: unknown): string | null {
    if (typeof cuerpo !== 'object' || cuerpo === null) return null;
    const valor = (cuerpo as Record<string, unknown>)[CAMPO_TOKEN];
    if (typeof valor !== 'string') return null;
    const token = valor.trim();
    if (!token || token.length > LONGITUD_MAXIMA_TOKEN) return null;
    return token;
  }

  /** `true` solo si Cloudflare confirma el token; cualquier otro fallo del proveedor lanza. */
  private async verificar(secreto: string, token: string, ip: string | undefined): Promise<boolean> {
    try {
      const respuesta = await fetch(URL_VERIFICACION, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret: secreto, response: token, remoteip: ip }),
        signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
      });
      if (!respuesta.ok) throw new Error(`Cloudflare respondió ${respuesta.status}`);
      const datos = (await respuesta.json()) as { success?: unknown };
      return datos.success === true;
    } catch (error) {
      this.logger.error(
        `No se pudo verificar el captcha con Cloudflare: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ErrorNegocio(CODIGOS_ERROR.SERVICIO_EXTERNO_CAIDO, HttpStatus.BAD_GATEWAY);
    }
  }

  /** Señala el campo para que el frontend reinicie el widget. */
  private captchaRechazado(): ErrorNegocio {
    return ErrorNegocio.validacion({ [CAMPO_TOKEN]: [MENSAJES_ERROR.VALIDACION] });
  }
}
