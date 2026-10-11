import { Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import {
  CODIGOS_ERROR,
  PERMISOS_POR_ROL,
  type CambiarPasswordDto,
  type LoginDto,
  type RespuestaLogin,
  type RestablecerPasswordDto,
  type Rol,
  type UsuarioSesion,
} from '@cds/shared';
import { PrismaService } from '../../comun/prisma/prisma.service.js';
import { ErrorNegocio } from '../../comun/excepciones/error-negocio.js';
import { AuditoriaService } from '../../comun/auditoria/auditoria.service.js';
import { CorreoService } from '../notificaciones/correo.service.js';
import { TokensService, type DatosDispositivo, type ParTokens } from './tokens.service.js';

/**
 * Parámetros de Argon2id.
 *
 * Argon2id en lugar de bcrypt: resiste mejor los ataques con GPU y es la
 * recomendación actual de OWASP. 19 MiB de memoria y 2 iteraciones es el
 * perfil que OWASP sugiere para servidores — unos 50 ms por verificación en el
 * VPS, suficiente para frenar fuerza bruta sin que el inicio de sesión se note
 * lento.
 */
const OPCIONES_ARGON: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/** Tras 5 fallos la cuenta se bloquea 15 minutos. */
const MAX_INTENTOS = 5;
const MINUTOS_BLOQUEO = 15;
const MINUTOS_VALIDEZ_CODIGO = 15;
const MAX_INTENTOS_CODIGO = 5;

@Injectable()
export class AutenticacionService {
  private readonly logger = new Logger(AutenticacionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly auditoria: AuditoriaService,
    private readonly correo: CorreoService,
  ) {}

  static hashPassword(password: string): Promise<string> {
    return argon2.hash(password, OPCIONES_ARGON);
  }

  async iniciarSesion(
    datos: LoginDto,
    dispositivo: DatosDispositivo,
  ): Promise<RespuestaLogin & { refreshToken: string }> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: datos.email },
      include: {
        sede: { select: { id: true, nombre: true } },
        sedesPermitidas: { select: { sede: { select: { id: true, nombre: true } } } },
      },
    });

    // Se verifica un hash falso cuando el usuario no existe para que el tiempo
    // de respuesta sea el mismo en ambos casos: si no, medir la latencia
    // revelaría qué correos están registrados.
    if (!usuario || usuario.eliminadoEn) {
      await this.gastarTiempo();
      throw new ErrorNegocio(CODIGOS_ERROR.CREDENCIALES_INVALIDAS, 401);
    }

    if (usuario.bloqueadoHasta && usuario.bloqueadoHasta > new Date()) {
      const segundos = Math.ceil((usuario.bloqueadoHasta.getTime() - Date.now()) / 1000);
      throw new ErrorNegocio(CODIGOS_ERROR.USUARIO_BLOQUEADO, 423, { segundosEspera: segundos });
    }

    const correcta = await argon2.verify(usuario.passwordHash, datos.password).catch(() => false);

    if (!correcta) {
      await this.registrarFallo(usuario.id, usuario.intentosFallidos, dispositivo, usuario.email);
      throw new ErrorNegocio(CODIGOS_ERROR.CREDENCIALES_INVALIDAS, 401);
    }

    // La cuenta puede estar desactivada aunque la contraseña sea correcta: se
    // comprueba después para no revelar el estado a quien no tiene la clave.
    if (!usuario.activo) {
      throw new ErrorNegocio(CODIGOS_ERROR.USUARIO_INACTIVO, 403);
    }

    // Si el hash se creó con parámetros antiguos, se regenera al vuelo.
    const necesitaRehash = argon2.needsRehash(usuario.passwordHash, OPCIONES_ARGON);

    await this.prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        intentosFallidos: 0,
        bloqueadoHasta: null,
        ultimoAccesoEn: new Date(),
        ...(necesitaRehash
          ? { passwordHash: await AutenticacionService.hashPassword(datos.password) }
          : {}),
      },
    });

    const par = await this.tokens.emitirPar(usuario.id, usuario.rol as Rol, dispositivo);

    await this.auditoria.registrar({
      accion: 'INICIAR_SESION',
      entidad: 'Usuario',
      entidadId: usuario.id,
      resumen: `${usuario.nombre} inició sesión`,
      actor: {
        id: usuario.id,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        email: usuario.email,
        rol: usuario.rol as Rol,
        sedeId: usuario.sedeId,
        sedesPermitidas: [],
        permisos: [],
        debeCambiarPassword: usuario.debeCambiarPassword,
      },
      ip: dispositivo.ip,
      userAgent: dispositivo.userAgent,
    });

    return {
      accessToken: par.accessToken,
      refreshToken: par.refreshToken,
      expiraEn: par.expiraEn,
      usuario: this.aUsuarioSesion(usuario),
    };
  }

  async refrescar(
    refreshToken: string,
    dispositivo: DatosDispositivo,
  ): Promise<RespuestaLogin & { refreshToken: string }> {
    const par: ParTokens = await this.tokens.rotar(refreshToken, dispositivo);

    const usuario = await this.prisma.usuario.findUniqueOrThrow({
      where: { id: await this.usuarioDeSesion(par.sesionId) },
      include: {
        sede: { select: { id: true, nombre: true } },
        sedesPermitidas: { select: { sede: { select: { id: true, nombre: true } } } },
      },
    });

    return {
      accessToken: par.accessToken,
      refreshToken: par.refreshToken,
      expiraEn: par.expiraEn,
      usuario: this.aUsuarioSesion(usuario),
    };
  }

  async cerrarSesion(sesionId: string | undefined, usuarioId: string): Promise<void> {
    if (sesionId) await this.tokens.revocar(sesionId, 'Cierre de sesión del usuario');
    await this.auditoria.registrar({
      accion: 'CERRAR_SESION',
      entidad: 'Usuario',
      entidadId: usuarioId,
      resumen: 'Cerró sesión',
    });
  }

  async cerrarTodasLasSesiones(usuarioId: string): Promise<number> {
    return this.tokens.revocarTodas(usuarioId, 'Cierre de todas las sesiones');
  }

  // ====================== RECUPERAR CONTRASEÑA ============================

  /**
   * Envía un código de 6 dígitos por correo.
   *
   * La respuesta es idéntica exista o no el correo: un atacante no debe poder
   * usar este formulario para averiguar qué cuentas hay en el sistema.
   */
  async solicitarRecuperacion(email: string, ip?: string): Promise<void> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { email },
      select: { id: true, nombre: true, email: true, activo: true, eliminadoEn: true },
    });

    if (!usuario || !usuario.activo || usuario.eliminadoEn) {
      this.logger.warn(`Recuperación solicitada para un correo inexistente o inactivo: ${email}`);
      return;
    }

    // Se invalidan los códigos anteriores: solo el último vale.
    await this.prisma.tokenRecuperacion.updateMany({
      where: { usuarioId: usuario.id, usadoEn: null },
      data: { usadoEn: new Date() },
    });

    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');

    await this.prisma.tokenRecuperacion.create({
      data: {
        usuarioId: usuario.id,
        codigoHash: this.hashCodigo(codigo),
        expiraEn: new Date(Date.now() + MINUTOS_VALIDEZ_CODIGO * 60_000),
        ip: ip?.slice(0, 64),
      },
    });

    await this.correo.enviarCodigoRecuperacion(
      usuario.email,
      usuario.nombre,
      codigo,
      MINUTOS_VALIDEZ_CODIGO,
    );
  }

  async restablecerPassword(datos: RestablecerPasswordDto, ip?: string): Promise<void> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: datos.email },
      select: { id: true, nombre: true, apellido: true, email: true, rol: true, sedeId: true },
    });
    if (!usuario) throw new ErrorNegocio(CODIGOS_ERROR.CODIGO_INVALIDO, 400);

    const token = await this.prisma.tokenRecuperacion.findFirst({
      where: { usuarioId: usuario.id, usadoEn: null },
      orderBy: { creadoEn: 'desc' },
    });

    if (!token) throw new ErrorNegocio(CODIGOS_ERROR.CODIGO_INVALIDO, 400);

    if (token.expiraEn < new Date()) {
      throw new ErrorNegocio(CODIGOS_ERROR.CODIGO_EXPIRADO, 400);
    }

    if (token.intentos >= MAX_INTENTOS_CODIGO) {
      await this.prisma.tokenRecuperacion.update({
        where: { id: token.id },
        data: { usadoEn: new Date() },
      });
      throw ErrorNegocio.demasiadosIntentos();
    }

    if (!this.codigoCoincide(datos.codigo, token.codigoHash)) {
      await this.prisma.tokenRecuperacion.update({
        where: { id: token.id },
        data: { intentos: { increment: 1 } },
      });
      throw new ErrorNegocio(CODIGOS_ERROR.CODIGO_INVALIDO, 400);
    }

    const passwordHash = await AutenticacionService.hashPassword(datos.password);

    await this.prisma.$transaction([
      this.prisma.tokenRecuperacion.update({
        where: { id: token.id },
        data: { usadoEn: new Date() },
      }),
      this.prisma.usuario.update({
        where: { id: usuario.id },
        data: {
          passwordHash,
          debeCambiarPassword: false,
          intentosFallidos: 0,
          bloqueadoHasta: null,
        },
      }),
    ]);

    // Cambiar la contraseña cierra todas las sesiones: si alguien había
    // entrado con la contraseña antigua, queda fuera.
    await this.tokens.revocarTodas(usuario.id, 'Contraseña restablecida');

    await this.auditoria.registrar({
      accion: 'RESTABLECER_PASSWORD',
      entidad: 'Usuario',
      entidadId: usuario.id,
      resumen: `${usuario.nombre} restableció su contraseña con código de verificación`,
      ip,
    });
  }

  async cambiarPassword(
    usuarioId: string,
    datos: CambiarPasswordDto,
    dispositivo: DatosDispositivo,
  ): Promise<void> {
    const usuario = await this.prisma.usuario.findUniqueOrThrow({
      where: { id: usuarioId },
      select: { id: true, nombre: true, passwordHash: true },
    });

    const correcta = await argon2.verify(usuario.passwordHash, datos.passwordActual).catch(() => false);
    if (!correcta) throw new ErrorNegocio(CODIGOS_ERROR.PASSWORD_ACTUAL_INCORRECTA, 400);

    await this.prisma.usuario.update({
      where: { id: usuarioId },
      data: {
        passwordHash: await AutenticacionService.hashPassword(datos.password),
        debeCambiarPassword: false,
      },
    });

    await this.tokens.revocarTodas(usuarioId, 'Contraseña cambiada por el usuario');

    await this.auditoria.registrar({
      accion: 'CAMBIAR_PASSWORD',
      entidad: 'Usuario',
      entidadId: usuarioId,
      resumen: `${usuario.nombre} cambió su contraseña`,
      ip: dispositivo.ip,
      userAgent: dispositivo.userAgent,
    });
  }

  /**
   * Perfil completo del usuario de la sesion.
   *
   * El panel lo pide al arrancar: necesita la sede, las sedes permitidas y los
   * permisos, no solo el identificador.
   */
  async perfil(usuarioId: string): Promise<UsuarioSesion> {
    const usuario = await this.prisma.usuario.findUniqueOrThrow({
      where: { id: usuarioId },
      include: {
        sede: { select: { id: true, nombre: true } },
        sedesPermitidas: { select: { sede: { select: { id: true, nombre: true } } } },
      },
    });
    return this.aUsuarioSesion(usuario);
  }

  // ============================ AUXILIARES ================================

  private async registrarFallo(
    usuarioId: string,
    intentosActuales: number,
    dispositivo: DatosDispositivo,
    email: string,
  ): Promise<void> {
    const intentos = intentosActuales + 1;
    const bloquear = intentos >= MAX_INTENTOS;

    await this.prisma.usuario.update({
      where: { id: usuarioId },
      data: {
        intentosFallidos: intentos,
        ...(bloquear ? { bloqueadoHasta: new Date(Date.now() + MINUTOS_BLOQUEO * 60_000) } : {}),
      },
    });

    await this.auditoria.registrar({
      accion: 'INICIO_SESION_FALLIDO',
      entidad: 'Usuario',
      entidadId: usuarioId,
      resumen: bloquear
        ? `Cuenta ${email} bloqueada ${MINUTOS_BLOQUEO} min tras ${intentos} intentos fallidos`
        : `Intento fallido ${intentos}/${MAX_INTENTOS} en ${email}`,
      ip: dispositivo.ip,
      userAgent: dispositivo.userAgent,
    });
  }

  /** Iguala el tiempo de respuesta cuando el correo no existe. */
  private async gastarTiempo(): Promise<void> {
    const hashFalso =
      '$argon2id$v=19$m=19456,t=2,p=1$c2FsYWRvZmFsc29wYXJhdGltaW5n$8uJJ0W0z0qK1a3o6cT5yVbQ7m8Xk2wM9pL4nR6sT1uY';
    await argon2.verify(hashFalso, 'contraseña-que-no-existe').catch(() => false);
  }

  private hashCodigo(codigo: string): string {
    return createHash('sha256').update(codigo).digest('hex');
  }

  /** Comparación en tiempo constante del código de verificación. */
  private codigoCoincide(codigo: string, hashGuardado: string): boolean {
    const calculado = Buffer.from(this.hashCodigo(codigo), 'hex');
    const guardado = Buffer.from(hashGuardado, 'hex');
    if (calculado.length !== guardado.length) return false;
    return timingSafeEqual(calculado, guardado);
  }

  private async usuarioDeSesion(sesionId: string): Promise<string> {
    const sesion = await this.prisma.sesion.findUniqueOrThrow({
      where: { id: sesionId },
      select: { usuarioId: true },
    });
    return sesion.usuarioId;
  }

  private aUsuarioSesion(usuario: {
    id: string;
    nombre: string;
    apellido: string | null;
    email: string;
    telefono: string;
    rol: string;
    sedeId: string | null;
    alias: string | null;
    fotoUrl: string | null;
    debeCambiarPassword: boolean;
    sede: { id: string; nombre: string } | null;
    sedesPermitidas: { sede: { id: string; nombre: string } }[];
  }): UsuarioSesion {
    const rol = usuario.rol as Rol;
    const sedes = new Map<string, { id: string; nombre: string }>();
    if (usuario.sede) sedes.set(usuario.sede.id, usuario.sede);
    for (const { sede } of usuario.sedesPermitidas) sedes.set(sede.id, sede);

    return {
      id: usuario.id,
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      email: usuario.email,
      telefono: usuario.telefono,
      rol,
      sedeId: usuario.sedeId,
      sedeNombre: usuario.sede?.nombre ?? null,
      sedesPermitidas: [...sedes.values()],
      alias: usuario.alias,
      fotoUrl: usuario.fotoUrl,
      debeCambiarPassword: usuario.debeCambiarPassword,
      permisos: [...PERMISOS_POR_ROL[rol]],
    };
  }
}
