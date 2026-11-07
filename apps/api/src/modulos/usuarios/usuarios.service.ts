import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CODIGOS_ERROR,
  calcularSalto,
  construirMeta,
  type ActualizarPerfilDto,
  type ActualizarUsuarioDto,
  type CrearUsuarioDto,
  type PaginaRespuesta,
  type Rol,
} from '@cds/shared';
import { PrismaService } from '../../comun/prisma/prisma.service.js';
import { AuditoriaService } from '../../comun/auditoria/auditoria.service.js';
import { ErrorNegocio } from '../../comun/excepciones/error-negocio.js';
import { AutenticacionService } from '../autenticacion/autenticacion.service.js';
import { TokensService } from '../autenticacion/tokens.service.js';
import { CorreoService } from '../notificaciones/correo.service.js';
import { fechaLegible } from '../../comun/tiempo/tiempo.js';
import { ConfiguracionNegocioService } from '../../comun/configuracion/configuracion-negocio.service.js';
import type { UsuarioAutenticado } from '../../comun/autenticacion/tipos.js';

/** Lo que devuelve el panel: sin el hash de la contraseña, nunca. */
const SELECCION_USUARIO = {
  id: true,
  nombre: true,
  apellido: true,
  email: true,
  telefono: true,
  rol: true,
  activo: true,
  debeCambiarPassword: true,
  sedeId: true,
  alias: true,
  bio: true,
  fotoUrl: true,
  visibleWeb: true,
  slotMinutos: true,
  ultimoAccesoEn: true,
  bloqueadoHasta: true,
  creadoEn: true,
  sede: { select: { id: true, nombre: true } },
  sedesPermitidas: { select: { sede: { select: { id: true, nombre: true } } } },
} satisfies Prisma.UsuarioSelect;

export type UsuarioPanel = Prisma.UsuarioGetPayload<{ select: typeof SELECCION_USUARIO }>;

/** Cita que impide mover a un barbero de sede. */
export interface CitaPendiente {
  id: string;
  codigo: string;
  inicioEn: Date;
  fechaLegible: string;
  cliente: string;
  telefono: string;
  sede: string;
}

@Injectable()
export class UsuariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly tokens: TokensService,
    private readonly correo: CorreoService,
    private readonly configuracion: ConfiguracionNegocioService,
  ) {}

  async listar(filtros: {
    pagina: number;
    limite: number;
    buscar?: string;
    rol?: Rol;
    sedeId?: string;
    activo?: boolean;
    orden: 'asc' | 'desc';
  }): Promise<PaginaRespuesta<UsuarioPanel>> {
    const { skip, take, pagina, limite } = calcularSalto(filtros.pagina, filtros.limite);

    const where: Prisma.UsuarioWhereInput = {
      eliminadoEn: null,
      ...(filtros.rol ? { rol: filtros.rol } : {}),
      ...(filtros.activo !== undefined ? { activo: filtros.activo } : {}),
      ...(filtros.sedeId
        ? { OR: [{ sedeId: filtros.sedeId }, { sedesPermitidas: { some: { sedeId: filtros.sedeId } } }] }
        : {}),
      ...(filtros.buscar
        ? {
            OR: [
              { nombre: { contains: filtros.buscar, mode: 'insensitive' } },
              { apellido: { contains: filtros.buscar, mode: 'insensitive' } },
              { email: { contains: filtros.buscar, mode: 'insensitive' } },
              { alias: { contains: filtros.buscar, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [datos, total] = await this.prisma.$transaction([
      this.prisma.usuario.findMany({
        where,
        skip,
        take,
        orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
        select: SELECCION_USUARIO,
      }),
      this.prisma.usuario.count({ where }),
    ]);

    return { datos, meta: construirMeta(total, pagina, limite) };
  }

  async obtener(id: string): Promise<UsuarioPanel> {
    const usuario = await this.prisma.usuario.findFirst({
      where: { id, eliminadoEn: null },
      select: SELECCION_USUARIO,
    });
    if (!usuario) throw ErrorNegocio.noEncontrado('ese usuario');
    return usuario;
  }

  /**
   * Alta de usuario.
   *
   * La contraseña la pone el administrador y se marca `debeCambiarPassword`:
   * el panel obliga a cambiarla en el primer acceso, de modo que la clave que
   * el admin dictó por WhatsApp deja de valer en cuanto la persona entra.
   */
  async crear(datos: CrearUsuarioDto, actor: UsuarioAutenticado): Promise<UsuarioPanel> {
    const { password, sedesPermitidas, ...resto } = datos;

    await this.verificarSedesExisten([
      ...(resto.sedeId ? [resto.sedeId] : []),
      ...sedesPermitidas,
    ]);

    const creado = await this.prisma.usuario.create({
      data: {
        ...resto,
        passwordHash: await AutenticacionService.hashPassword(password),
        sedesPermitidas: {
          createMany: {
            // La sede principal no se duplica en las permitidas: ya se asume.
            data: sedesPermitidas
              .filter((id) => id !== resto.sedeId)
              .map((sedeId) => ({ sedeId })),
          },
        },
      },
      select: SELECCION_USUARIO,
    });

    await this.auditoria.registrar({
      accion: 'CREAR',
      entidad: 'Usuario',
      entidadId: creado.id,
      despues: creado,
      resumen: `Creó al usuario ${creado.nombre} (${creado.email}) con rol ${creado.rol}`,
      actor,
    });

    return creado;
  }

  async actualizar(
    id: string,
    datos: ActualizarUsuarioDto,
    actor: UsuarioAutenticado,
  ): Promise<UsuarioPanel> {
    const antes = await this.obtener(id);
    const { sedesPermitidas, ...resto } = datos;

    // Un administrador no puede quitarse a sí mismo el rol ni desactivarse:
    // es la forma más fácil de quedarse sin ningún admin en el sistema.
    if (actor.id === id) {
      if (resto.rol && resto.rol !== antes.rol) {
        throw ErrorNegocio.conflicto(
          'CONFLICTO',
          undefined,
          'No puedes cambiarte el rol a ti mismo. Pídeselo a otro administrador.',
        );
      }
      if (resto.activo === false) {
        throw ErrorNegocio.conflicto(
          'CONFLICTO',
          undefined,
          'No puedes desactivar tu propia cuenta.',
        );
      }
    }

    if (antes.rol === 'ADMIN' && (resto.rol !== undefined && resto.rol !== 'ADMIN')) {
      await this.verificarQuedaAlgunAdmin(id);
    }
    if (antes.rol === 'ADMIN' && resto.activo === false) {
      await this.verificarQuedaAlgunAdmin(id);
    }

    // Desactivar a un barbero con citas por atender dejaría a esos clientes
    // sin quien los atienda, y además desaparecería de la disponibilidad.
    if (resto.activo === false && antes.rol === 'BARBERO') {
      const pendientes = await this.citasPendientes(id);
      if (pendientes.length > 0) {
        throw new ErrorNegocio(
          CODIGOS_ERROR.CONFLICTO,
          409,
          { citas: pendientes.map((c) => ({ ...c, inicioEn: c.inicioEn.toISOString() })) },
          `${antes.nombre} tiene ${pendientes.length} ${pendientes.length === 1 ? 'cita' : 'citas'} por atender. Reasígnalas o cancélalas antes de desactivar la cuenta.`,
        );
      }
    }

    if (resto.sedeId !== undefined || sedesPermitidas) {
      await this.verificarSedesExisten([
        ...(resto.sedeId ? [resto.sedeId] : []),
        ...(sedesPermitidas ?? []),
      ]);
    }

    const despues = await this.prisma.$transaction(async (tx) => {
      if (sedesPermitidas) {
        await tx.usuarioSede.deleteMany({ where: { usuarioId: id } });
        const sedeFinal = resto.sedeId !== undefined ? resto.sedeId : antes.sedeId;
        const aCrear = sedesPermitidas.filter((s) => s !== sedeFinal);
        if (aCrear.length > 0) {
          await tx.usuarioSede.createMany({
            data: aCrear.map((sedeId) => ({ usuarioId: id, sedeId })),
          });
        }
      }

      return tx.usuario.update({ where: { id }, data: resto, select: SELECCION_USUARIO });
    });

    // Desactivar o cambiar de rol invalida las sesiones abiertas al instante.
    if (resto.activo === false || (resto.rol && resto.rol !== antes.rol)) {
      await this.tokens.revocarTodas(id, 'Cuenta modificada por un administrador');
    }

    await this.auditoria.registrarCambio({
      accion: 'ACTUALIZAR',
      entidad: 'Usuario',
      entidadId: id,
      antes: antes as unknown as Record<string, unknown>,
      despues: despues as unknown as Record<string, unknown>,
      resumen: this.resumenCambio(antes, despues),
      actor,
    });

    return despues;
  }

  /**
   * Cambio de sede hecho por el propio usuario, desde su perfil.
   *
   * Es la regla que pidió el cliente: un barbero no puede mudarse de local
   * dejando citas colgadas en el anterior. Si las tiene, se le devuelve la
   * lista con los teléfonos para que hable con esos clientes — o las mueve de
   * sede desde el módulo de reservas, que también vale.
   */
  async actualizarPerfil(
    id: string,
    datos: ActualizarPerfilDto,
    actor: UsuarioAutenticado,
  ): Promise<UsuarioPanel> {
    const antes = await this.obtener(id);

    if (datos.sedeId && datos.sedeId !== antes.sedeId) {
      const permitidas = [
        ...(antes.sedeId ? [antes.sedeId] : []),
        ...antes.sedesPermitidas.map((s) => s.sede.id),
      ];
      if (!permitidas.includes(datos.sedeId)) {
        throw ErrorNegocio.sinPermiso('cambiarte a una sede en la que no estás habilitado');
      }

      if (antes.rol === 'BARBERO') {
        const pendientes = await this.citasPendientes(id, antes.sedeId ?? undefined);
        if (pendientes.length > 0) {
          throw new ErrorNegocio(
            CODIGOS_ERROR.CAMBIO_SEDE_CON_RESERVAS,
            409,
            { citas: pendientes.map((c) => ({ ...c, inicioEn: c.inicioEn.toISOString() })) },
            `Tienes ${pendientes.length} ${pendientes.length === 1 ? 'cita' : 'citas'} por atender en ${pendientes[0]?.sede ?? 'tu sede actual'}. Habla con esos clientes para cambiarles la fecha, o mueve las citas a la sede nueva desde Reservas.`,
          );
        }
      }
    }

    const despues = await this.prisma.usuario.update({
      where: { id },
      data: datos,
      select: SELECCION_USUARIO,
    });

    await this.auditoria.registrarCambio({
      accion: 'ACTUALIZAR',
      entidad: 'Usuario',
      entidadId: id,
      antes: antes as unknown as Record<string, unknown>,
      despues: despues as unknown as Record<string, unknown>,
      resumen:
        datos.sedeId && datos.sedeId !== antes.sedeId
          ? `Se cambió de sede: de ${antes.sede?.nombre ?? '—'} a ${despues.sede?.nombre ?? '—'}`
          : 'Actualizó sus datos de perfil',
      actor,
    });

    return despues;
  }

  /** Reseteo de contraseña hecho por un administrador. */
  async resetearPassword(
    id: string,
    password: string,
    notificar: boolean,
    actor: UsuarioAutenticado,
  ): Promise<void> {
    const usuario = await this.obtener(id);

    await this.prisma.usuario.update({
      where: { id },
      data: {
        passwordHash: await AutenticacionService.hashPassword(password),
        // Provisional: la persona la cambia al entrar.
        debeCambiarPassword: true,
        intentosFallidos: 0,
        bloqueadoHasta: null,
      },
    });

    await this.tokens.revocarTodas(id, 'Contraseña restablecida por un administrador');

    if (notificar) {
      await this.correo.enviar({
        para: usuario.email,
        nombreDestinatario: usuario.nombre,
        asunto: 'Tu contraseña del panel fue restablecida',
        texto: `Hola ${usuario.nombre}:\n\nUn administrador restableció tu contraseña del panel. Te la habrá hecho llegar por otro medio.\n\nAl entrar, el panel te pedirá cambiarla por una tuya.\n\nSi no esperabas este cambio, avisa al administrador.`,
        html: `<p>Hola ${usuario.nombre}:</p><p>Un administrador restableció tu contraseña del panel. Al entrar, el sistema te pedirá cambiarla por una tuya.</p><p>Si no esperabas este cambio, avisa al administrador.</p>`,
      });
    }

    await this.auditoria.registrar({
      accion: 'RESTABLECER_PASSWORD',
      entidad: 'Usuario',
      entidadId: id,
      resumen: `Restableció la contraseña de ${usuario.nombre} (${usuario.email}) y cerró sus sesiones`,
      actor,
    });
  }

  /**
   * Baja lógica.
   *
   * No se borra la fila: las reservas, las ventas y la auditoría apuntan a
   * este usuario y perderían su autor.
   */
  async eliminar(id: string, actor: UsuarioAutenticado): Promise<void> {
    const usuario = await this.obtener(id);

    if (actor.id === id) {
      throw ErrorNegocio.conflicto('CONFLICTO', undefined, 'No puedes eliminar tu propia cuenta.');
    }
    if (usuario.rol === 'ADMIN') await this.verificarQuedaAlgunAdmin(id);

    const pendientes = await this.citasPendientes(id);
    if (pendientes.length > 0) {
      throw new ErrorNegocio(
        CODIGOS_ERROR.CONFLICTO,
        409,
        { citas: pendientes.map((c) => ({ ...c, inicioEn: c.inicioEn.toISOString() })) },
        `${usuario.nombre} tiene ${pendientes.length} ${pendientes.length === 1 ? 'cita' : 'citas'} por atender. Reasígnalas o cancélalas primero.`,
      );
    }

    await this.prisma.usuario.update({
      where: { id },
      data: { eliminadoEn: new Date(), activo: false },
    });
    await this.tokens.revocarTodas(id, 'Cuenta eliminada');

    await this.auditoria.registrar({
      accion: 'ELIMINAR',
      entidad: 'Usuario',
      entidadId: id,
      antes: usuario,
      resumen: `Eliminó al usuario ${usuario.nombre} (${usuario.email})`,
      actor,
    });
  }

  /** Sesiones abiertas de un usuario: el panel permite cerrarlas una a una. */
  async sesiones(id: string) {
    return this.prisma.sesion.findMany({
      where: { usuarioId: id, revocadaEn: null, expiraEn: { gt: new Date() } },
      orderBy: { creadoEn: 'desc' },
      select: { id: true, ip: true, userAgent: true, creadoEn: true, expiraEn: true },
      take: 20,
    });
  }

  // ---------------------------------------------------------- auxiliares

  /** Citas futuras que todavía ocupan tiempo de este barbero. */
  private async citasPendientes(barberoId: string, sedeId?: string): Promise<CitaPendiente[]> {
    const zona = await this.configuracion.zonaHoraria();

    const reservas = await this.prisma.reserva.findMany({
      where: {
        barberoId,
        ...(sedeId ? { sedeId } : {}),
        estado: { in: ['PENDIENTE', 'CONFIRMADA', 'EN_CURSO'] },
        inicioEn: { gte: new Date() },
      },
      orderBy: { inicioEn: 'asc' },
      take: 50,
      select: {
        id: true,
        codigo: true,
        inicioEn: true,
        telefonoContacto: true,
        cliente: { select: { nombreCompleto: true, telefono: true } },
        sede: { select: { nombre: true } },
      },
    });

    return reservas.map((r) => ({
      id: r.id,
      codigo: r.codigo,
      inicioEn: r.inicioEn,
      fechaLegible: fechaLegible(r.inicioEn, zona),
      cliente: r.cliente?.nombreCompleto ?? 'Cliente sin ficha',
      telefono: r.cliente?.telefono ?? r.telefonoContacto ?? '',
      sede: r.sede.nombre,
    }));
  }

  /** Impide quedarse sin ningún administrador activo. */
  private async verificarQuedaAlgunAdmin(excluyendoId: string): Promise<void> {
    const otros = await this.prisma.usuario.count({
      where: { rol: 'ADMIN', activo: true, eliminadoEn: null, id: { not: excluyendoId } },
    });
    if (otros === 0) {
      throw ErrorNegocio.conflicto(
        'CONFLICTO',
        undefined,
        'Es el único administrador activo. Nombra a otro antes de quitarle el rol o desactivarlo, o nadie podrá gestionar el sistema.',
      );
    }
  }

  private async verificarSedesExisten(ids: string[]): Promise<void> {
    const unicas = [...new Set(ids)];
    if (unicas.length === 0) return;

    const encontradas = await this.prisma.sede.count({
      where: { id: { in: unicas }, eliminadoEn: null },
    });
    if (encontradas !== unicas.length) {
      throw ErrorNegocio.noEncontrado('alguna de las sedes seleccionadas');
    }
  }

  private resumenCambio(antes: UsuarioPanel, despues: UsuarioPanel): string {
    const cambios: string[] = [];
    if (antes.rol !== despues.rol) cambios.push(`rol ${antes.rol} → ${despues.rol}`);
    if (antes.activo !== despues.activo) cambios.push(despues.activo ? 'reactivado' : 'desactivado');
    if (antes.sedeId !== despues.sedeId) {
      cambios.push(`sede ${antes.sede?.nombre ?? '—'} → ${despues.sede?.nombre ?? '—'}`);
    }
    if (antes.email !== despues.email) cambios.push(`correo ${antes.email} → ${despues.email}`);

    return `Editó al usuario ${antes.nombre}${cambios.length ? `: ${cambios.join(', ')}` : ''}`;
  }
}
