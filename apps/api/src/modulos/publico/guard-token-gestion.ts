import { CanActivate, createParamDecorator, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { CODIGOS_ERROR } from '@cds/shared';
import { ErrorNegocio } from '../../comun/excepciones/error-negocio.js';
import { PrismaService } from '../../comun/prisma/prisma.service.js';

/** Cabecera donde el frontend manda el token leído del fragmento del enlace. */
export const CABECERA_TOKEN_GESTION = 'x-token-gestion';

/** La columna es `VarChar(64)`: un token más largo no puede existir. */
const LONGITUD_MAXIMA_TOKEN = 64;

/** Reserva resuelta por el guard, tal como la devuelve Prisma. */
export type ReservaPublica = NonNullable<
  Awaited<ReturnType<PrismaService['reserva']['findUnique']>>
>;

type PeticionConReserva = Request & { reservaPublica?: ReservaPublica };

/**
 * Autenticación del canal público por token de gestión.
 *
 * El cliente no tiene cuenta: su cita se gestiona con un enlace
 * `https://<booking>/cita#<token>`. El token va en el fragmento porque un
 * fragmento nunca viaja al servidor (ni a logs, ni a proxies, ni a `Referer`);
 * el frontend lo lee del `hash` y lo envía en `X-Token-Gestion`.
 *
 * La búsqueda es `findUnique` sobre la columna única: una comparación
 * indexada, no un barrido. Al cancelar una cita su token se pone a `null`, de
 * modo que una cita cancelada no se encuentra por ninguna vía. Al reprogramar
 * el token se rota, así que no se cachea nada: cada petición consulta.
 *
 * El token nunca se escribe en un log ni en un mensaje de error; todo fallo es
 * el mismo `TOKEN_INVALIDO` (401), sin distinguir entre «no existe» y «no se
 * envió», para no dar pistas a quien adivine tokens.
 */
@Injectable()
export class GuardTokenGestion implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const peticion = contexto.switchToHttp().getRequest<PeticionConReserva>();
    const token = this.extraerToken(peticion);
    if (!token) throw ErrorNegocio.noAutenticado(CODIGOS_ERROR.TOKEN_INVALIDO);

    const reserva = await this.prisma.reserva.findUnique({ where: { tokenGestion: token } });
    if (!reserva) throw ErrorNegocio.noAutenticado(CODIGOS_ERROR.TOKEN_INVALIDO);

    peticion.reservaPublica = reserva;
    return true;
  }

  private extraerToken(peticion: Request): string | null {
    const valor = peticion.headers[CABECERA_TOKEN_GESTION];
    // Una cabecera repetida llega como arreglo: es ambigua, se rechaza.
    if (typeof valor !== 'string') return null;
    const token = valor.trim();
    if (!token || token.length > LONGITUD_MAXIMA_TOKEN) return null;
    return token;
  }
}

/** Inyecta la reserva resuelta por el guard: `@ReservaPorToken() reserva: ReservaPublica` */
export const ReservaPorToken = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<PeticionConReserva>().reservaPublica;
});
