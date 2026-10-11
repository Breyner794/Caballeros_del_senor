import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import { CODIGOS_ERROR } from '@cds/shared';
import { PrismaService } from '../../comun/prisma/prisma.service.js';
import { ErrorNegocio } from '../../comun/excepciones/error-negocio.js';
import type {
  PayloadAccessToken,
  PayloadRefreshToken,
} from '../../comun/autenticacion/tipos.js';

export interface ParTokens {
  accessToken: string;
  refreshToken: string;
  /** Segundos de vida del access token. */
  expiraEn: number;
  sesionId: string;
}

export interface DatosDispositivo {
  ip?: string;
  userAgent?: string;
}

/**
 * Emisión y rotación de tokens.
 *
 * Esquema: access token corto (15 min) en memoria del navegador + refresh
 * token largo (7 días) en una cookie httpOnly. El refresh **rota en cada uso**
 * y se guarda solo su SHA-256 en la base de datos.
 *
 * La rotación con detección de reutilización es la parte importante. Un
 * refresh token solo puede usarse una vez; si alguien intenta usar uno ya
 * rotado, significa que o lo robaron o hubo una copia, y entonces se revoca
 * *toda la familia* de tokens de esa sesión. El atacante y el usuario
 * legítimo quedan fuera, y el usuario simplemente vuelve a iniciar sesión —
 * que es exactamente lo que queremos en un panel con datos de clientes y caja.
 */
@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);

  /**
   * Segundos durante los que un token recién rotado no cuenta como robo.
   *
   * Lo bastante corto para no abrir una ventana útil a un atacante y lo
   * bastante largo para cubrir el reintento de una pestaña que perdió la
   * carrera, incluso con una conexión lenta.
   */
  private static readonly GRACIA_ROTACION_S = 20;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /** Nunca se guarda un token en claro: solo su hash. */
  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private get secretoAcceso(): string {
    return this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
  }

  private get secretoRefresco(): string {
    return this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
  }

  private get ttlAcceso(): string {
    return this.config.get<string>('JWT_ACCESS_TTL') ?? '15m';
  }

  private get ttlRefresco(): string {
    return this.config.get<string>('JWT_REFRESH_TTL') ?? '7d';
  }

  /** Crea una sesión nueva (inicio de sesión). */
  async emitirPar(
    usuarioId: string,
    rol: PayloadAccessToken['rol'],
    dispositivo: DatosDispositivo,
  ): Promise<ParTokens> {
    const familiaId = randomUUID();
    return this.crearSesion(usuarioId, rol, familiaId, dispositivo);
  }

  /**
   * Canjea un refresh token por un par nuevo.
   *
   * Pasos: verificar firma → buscar la sesión por el hash → si no existe o ya
   * estaba revocada, revocar la familia completa y rechazar → si todo está
   * bien, revocar esta sesión y crear la siguiente de la misma familia.
   */
  async rotar(refreshToken: string, dispositivo: DatosDispositivo): Promise<ParTokens> {
    let payload: PayloadRefreshToken;
    try {
      payload = await this.jwt.verifyAsync<PayloadRefreshToken>(refreshToken, {
        secret: this.secretoRefresco,
      });
    } catch {
      throw ErrorNegocio.noAutenticado(CODIGOS_ERROR.SESION_EXPIRADA);
    }

    if (payload.tipo !== 'refresco') {
      throw ErrorNegocio.noAutenticado(CODIGOS_ERROR.TOKEN_INVALIDO);
    }

    const tokenHash = this.hash(refreshToken);
    const sesion = await this.prisma.sesion.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        usuarioId: true,
        familiaId: true,
        expiraEn: true,
        revocadaEn: true,
        motivoRevoca: true,
        usuario: { select: { rol: true, activo: true, eliminadoEn: true } },
      },
    });

    // Token válido en firma pero desconocido: señal clara de robo.
    if (!sesion) {
      await this.revocarFamilia(payload.fam, 'Reutilización de refresh token detectada');
      this.logger.warn(
        `Refresh token desconocido (familia ${payload.fam}, usuario ${payload.sub}). Familia revocada.`,
      );
      throw ErrorNegocio.noAutenticado(CODIGOS_ERROR.TOKEN_REUTILIZADO);
    }

    if (sesion.revocadaEn) {
      /**
       * Ventana de gracia tras la rotación.
       *
       * Dos pestañas abiertas del panel refrescan a la vez con la misma cookie:
       * una gana y rota el token, la otra llega con el que acaba de quedar
       * obsoleto. Sin esta ventana, esa carrera perfectamente normal se
       * interpretaría como un robo y echaría al usuario de todas sus sesiones
       * — algo que en recepción, con el panel abierto en varias pestañas,
       * pasaría a diario.
       *
       * Durante unos segundos tras la rotación se devuelve un 401 normal y la
       * pestaña perdedora reintenta: para entonces el navegador ya tiene la
       * cookie nueva (es compartida entre pestañas) y el reintento funciona.
       * Un atacante no gana nada: sigue necesitando la cookie vigente, que ya
       * no es la que tiene.
       */
      const segundosDesdeRotacion = (Date.now() - sesion.revocadaEn.getTime()) / 1000;
      const esRotacionReciente =
        sesion.motivoRevoca === 'Rotada' && segundosDesdeRotacion <= TokensService.GRACIA_ROTACION_S;

      if (esRotacionReciente) {
        throw ErrorNegocio.noAutenticado(CODIGOS_ERROR.SESION_EXPIRADA);
      }

      await this.revocarFamilia(payload.fam, 'Reutilización de refresh token detectada');
      this.logger.warn(
        `Refresh token reutilizado (familia ${payload.fam}, usuario ${payload.sub}). Familia revocada.`,
      );
      throw ErrorNegocio.noAutenticado(CODIGOS_ERROR.TOKEN_REUTILIZADO);
    }

    if (sesion.expiraEn < new Date()) {
      await this.revocar(sesion.id, 'Expirada');
      throw ErrorNegocio.noAutenticado(CODIGOS_ERROR.SESION_EXPIRADA);
    }

    if (!sesion.usuario.activo || sesion.usuario.eliminadoEn) {
      await this.revocarTodas(sesion.usuarioId, 'Usuario desactivado');
      throw new ErrorNegocio(CODIGOS_ERROR.USUARIO_INACTIVO, 401);
    }

    // La rotación es atómica: se marca la vieja y se crea la nueva en la misma
    // transacción, para que no pueda quedar una sesión sin su reemplazo.
    return this.prisma.$transaction(async () => {
      await this.prisma.sesion.update({
        where: { id: sesion.id },
        data: { revocadaEn: new Date(), motivoRevoca: 'Rotada' },
      });
      return this.crearSesion(
        sesion.usuarioId,
        sesion.usuario.rol as PayloadAccessToken['rol'],
        sesion.familiaId,
        dispositivo,
      );
    });
  }

  private async crearSesion(
    usuarioId: string,
    rol: PayloadAccessToken['rol'],
    familiaId: string,
    dispositivo: DatosDispositivo,
  ): Promise<ParTokens> {
    const sesionId = randomUUID();

    const accessToken = await this.jwt.signAsync(
      { sub: usuarioId, rol, sid: sesionId, tipo: 'acceso' } satisfies PayloadAccessToken,
      { secret: this.secretoAcceso, expiresIn: Math.floor(this.ttlEnMs(this.ttlAcceso) / 1000) },
    );

    const refreshToken = await this.jwt.signAsync(
      { sub: usuarioId, sid: sesionId, fam: familiaId, tipo: 'refresco' } satisfies PayloadRefreshToken,
      { secret: this.secretoRefresco, expiresIn: Math.floor(this.ttlEnMs(this.ttlRefresco) / 1000) },
    );

    await this.prisma.sesion.create({
      data: {
        id: sesionId,
        usuarioId,
        tokenHash: this.hash(refreshToken),
        familiaId,
        expiraEn: new Date(Date.now() + this.ttlEnMs(this.ttlRefresco)),
        ip: dispositivo.ip?.slice(0, 64),
        userAgent: dispositivo.userAgent?.slice(0, 300),
      },
    });

    return {
      accessToken,
      refreshToken,
      expiraEn: Math.floor(this.ttlEnMs(this.ttlAcceso) / 1000),
      sesionId,
    };
  }

  async revocar(sesionId: string, motivo: string): Promise<void> {
    await this.prisma.sesion.updateMany({
      where: { id: sesionId, revocadaEn: null },
      data: { revocadaEn: new Date(), motivoRevoca: motivo.slice(0, 120) },
    });
  }

  async revocarFamilia(familiaId: string, motivo: string): Promise<void> {
    await this.prisma.sesion.updateMany({
      where: { familiaId, revocadaEn: null },
      data: { revocadaEn: new Date(), motivoRevoca: motivo.slice(0, 120) },
    });
  }

  /** Cierra la sesión en todos los dispositivos (cambio de contraseña, baja). */
  async revocarTodas(usuarioId: string, motivo: string): Promise<number> {
    const resultado = await this.prisma.sesion.updateMany({
      where: { usuarioId, revocadaEn: null },
      data: { revocadaEn: new Date(), motivoRevoca: motivo.slice(0, 120) },
    });
    return resultado.count;
  }

  /** Limpieza periódica de sesiones caducadas. */
  async limpiarCaducadas(): Promise<number> {
    const resultado = await this.prisma.sesion.deleteMany({
      where: { expiraEn: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    });
    return resultado.count;
  }

  /** "15m" → 900000. Acepta s, m, h y d. */
  private ttlEnMs(ttl: string): number {
    const coincidencia = /^(\d+)\s*([smhd])$/.exec(ttl.trim());
    if (!coincidencia) return 15 * 60 * 1000;
    const cantidad = Number(coincidencia[1]);
    const unidades: Record<string, number> = {
      s: 1000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return cantidad * (unidades[coincidencia[2] as string] ?? 60_000);
  }
}
