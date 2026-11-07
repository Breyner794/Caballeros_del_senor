import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { CODIGOS_ERROR, MAX_TOKEN_TURNSTILE, MENSAJES_ERROR } from '@cds/shared';
import { ErrorNegocio } from '../../comun/excepciones/error-negocio.js';

const URL_VERIFICACION = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Sin tope, un Cloudflare lento dejaría la petición colgada indefinidamente. */
const TIEMPO_MAXIMO_MS = 5_000;

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
 * Si `TURNSTILE_SECRET_KEY` no está configurada, deja pasar, igual que
 * `CorreoService` con Brevo: permite desarrollar y probar sin credenciales. El
 * contrapeso es `entorno.ts`, que en producción impide que la API arranque sin
 * la clave.
 *
 * El aviso de que el canal público está levantando SIN CAPTCHA se escribe UNA
 * VEZ al arrancar y con nivel `error`, no en cada petición: un susurro por
 * petición es ruido que nadie lee, y este es uno de los dos únicos caminos por
 * los que esta función puede quedar rota sin que nadie se entere.
 *
 * Falla cerrado, y es deliberado: si Cloudflare no responde, la petición se
 * rechaza con `SERVICIO_EXTERNO_CAIDO`. Un control de seguridad que se abre
 * cuando su proveedor se cae no es un control. El coste aceptado es que una
 * caída de Cloudflare bloquea las reservas web mientras recepción sigue
 * tomándolas por teléfono.
 */
@Injectable()
export class GuardTurnstile implements CanActivate, OnModuleInit {
  private readonly logger = new Logger(GuardTurnstile.name);

  constructor(private readonly config: ConfigService) {}

  /** El único rastro de que el canal público quedó sin captcha: una vez, y alto. */
  onModuleInit(): void {
    if (this.config.get<string>('TURNSTILE_SECRET_KEY')) return;
    this.logger.error(
      'TURNSTILE_SECRET_KEY no está configurada: el canal público levanta SIN CAPTCHA y cualquier bot puede llenar la agenda de citas falsas. Configúrala antes de exponer la web a internet.',
    );
  }

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const secreto = this.config.get<string>('TURNSTILE_SECRET_KEY');
    // Sin clave se deja pasar en silencio: el aviso ya se dio al arrancar.
    if (!secreto) return true;

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
    if (!token || token.length > MAX_TOKEN_TURNSTILE) return null;
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
