import { Injectable } from '@nestjs/common';
import type { Prisma, Servicio } from '@prisma/client';
import {
  calcularSalto,
  construirMeta,
  type ActualizarServicioDto,
  type CrearServicioDto,
  type PaginaRespuesta,
} from '@cds/shared';
import { PrismaService } from '../../comun/prisma/prisma.service.js';
import { AuditoriaService } from '../../comun/auditoria/auditoria.service.js';
import { ErrorNegocio } from '../../comun/excepciones/error-negocio.js';
import type { UsuarioAutenticado } from '../../comun/autenticacion/tipos.js';
import { aSlug } from '../../comun/utilidades/slug.js';

export interface FiltrosServicios {
  pagina: number;
  limite: number;
  buscar?: string;
  activo?: boolean;
  visibleWeb?: boolean;
  orden: 'asc' | 'desc';
}

@Injectable()
export class ServiciosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async listar(filtros: FiltrosServicios): Promise<PaginaRespuesta<Servicio>> {
    const { skip, take, pagina, limite } = calcularSalto(filtros.pagina, filtros.limite);

    const where: Prisma.ServicioWhereInput = {
      eliminadoEn: null,
      ...(filtros.activo !== undefined ? { activo: filtros.activo } : {}),
      ...(filtros.visibleWeb !== undefined ? { visibleWeb: filtros.visibleWeb } : {}),
      ...(filtros.buscar
        ? {
            OR: [
              { nombre: { contains: filtros.buscar, mode: 'insensitive' } },
              { descripcion: { contains: filtros.buscar, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [datos, total] = await this.prisma.$transaction([
      this.prisma.servicio.findMany({
        where,
        skip,
        take,
        orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
      }),
      this.prisma.servicio.count({ where }),
    ]);

    return { datos, meta: construirMeta(total, pagina, limite) };
  }

  /** Catálogo completo para los selectores del formulario de reservas. */
  async paraSelector(soloWeb = false): Promise<Servicio[]> {
    return this.prisma.servicio.findMany({
      where: { eliminadoEn: null, activo: true, ...(soloWeb ? { visibleWeb: true } : {}) },
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    });
  }

  async obtener(id: string): Promise<Servicio> {
    const servicio = await this.prisma.servicio.findFirst({ where: { id, eliminadoEn: null } });
    if (!servicio) throw ErrorNegocio.noEncontrado('ese servicio');
    return servicio;
  }

  async crear(datos: CrearServicioDto, actor: UsuarioAutenticado): Promise<Servicio> {
    const servicio = await this.prisma.servicio.create({
      data: { ...datos, slug: await this.slugUnico(datos.nombre) },
    });

    await this.auditoria.registrar({
      accion: 'CREAR',
      entidad: 'Servicio',
      entidadId: servicio.id,
      despues: servicio,
      resumen: `Creó el servicio "${servicio.nombre}" (${servicio.duracionMinutos} min, ${this.pesos(servicio.precio)})`,
      actor,
    });

    return servicio;
  }

  async actualizar(
    id: string,
    datos: ActualizarServicioDto,
    actor: UsuarioAutenticado,
  ): Promise<Servicio> {
    const antes = await this.obtener(id);

    const despues = await this.prisma.servicio.update({
      where: { id },
      data: {
        ...datos,
        // El slug se regenera solo si cambia el nombre: es parte de las URL
        // públicas y no conviene moverlo sin motivo.
        ...(datos.nombre && datos.nombre !== antes.nombre
          ? { slug: await this.slugUnico(datos.nombre, id) }
          : {}),
      },
    });

    await this.auditoria.registrarCambio({
      accion: 'ACTUALIZAR',
      entidad: 'Servicio',
      entidadId: id,
      antes: antes as unknown as Record<string, unknown>,
      despues: despues as unknown as Record<string, unknown>,
      resumen: this.resumenCambio(antes, despues),
      actor,
    });

    return despues;
  }

  /**
   * Desactivar un servicio.
   *
   * Es lo que se recomienda en lugar de eliminar: el servicio desaparece de los
   * formularios y de la web, pero las reservas y las ventas que lo usaron siguen
   * mostrándolo con su nombre y precio de entonces.
   */
  async cambiarEstado(id: string, activo: boolean, actor: UsuarioAutenticado): Promise<Servicio> {
    const antes = await this.obtener(id);
    const servicio = await this.prisma.servicio.update({ where: { id }, data: { activo } });

    await this.auditoria.registrar({
      accion: 'ACTUALIZAR',
      entidad: 'Servicio',
      entidadId: id,
      antes: { activo: antes.activo },
      despues: { activo },
      resumen: `${activo ? 'Activó' : 'Desactivó'} el servicio "${servicio.nombre}"`,
      actor,
    });

    return servicio;
  }

  /**
   * Eliminación lógica.
   *
   * No se borra la fila nunca. Un `DELETE` real dejaría huérfanas las reservas
   * históricas y los informes del contador, y además rompería la trazabilidad
   * que pide la auditoría. Si el servicio tiene reservas futuras, se avisa:
   * esas citas quedarían sin servicio asociado en el formulario de edición.
   */
  async eliminar(id: string, actor: UsuarioAutenticado): Promise<{ reservasFuturas: number }> {
    const servicio = await this.obtener(id);

    const reservasFuturas = await this.prisma.reservaServicio.count({
      where: {
        servicioId: id,
        reserva: {
          inicioEn: { gte: new Date() },
          estado: { in: ['PENDIENTE', 'CONFIRMADA', 'EN_CURSO'] },
        },
      },
    });

    if (reservasFuturas > 0) {
      throw ErrorNegocio.conflicto(
        'CONFLICTO',
        { reservasFuturas },
        `Este servicio está en ${reservasFuturas} ${
          reservasFuturas === 1 ? 'reserva' : 'reservas'
        } que aún no se ha atendido. Desactívalo en vez de eliminarlo, o atiende primero esas citas.`,
      );
    }

    await this.prisma.servicio.update({
      where: { id },
      data: { eliminadoEn: new Date(), activo: false, visibleWeb: false },
    });

    await this.auditoria.registrar({
      accion: 'ELIMINAR',
      entidad: 'Servicio',
      entidadId: id,
      antes: servicio,
      resumen: `Eliminó el servicio "${servicio.nombre}"`,
      actor,
    });

    return { reservasFuturas: 0 };
  }

  /** Reordenar la lista arrastrando tarjetas en el panel. */
  async reordenar(orden: { id: string; orden: number }[], actor: UsuarioAutenticado): Promise<void> {
    await this.prisma.$transaction(
      orden.map((item) =>
        this.prisma.servicio.update({ where: { id: item.id }, data: { orden: item.orden } }),
      ),
    );

    await this.auditoria.registrar({
      accion: 'ACTUALIZAR',
      entidad: 'Servicio',
      resumen: `Reordenó ${orden.length} servicios`,
      actor,
    });
  }

  // ---------------------------------------------------------- auxiliares

  private async slugUnico(nombre: string, excluirId?: string): Promise<string> {
    const base = aSlug(nombre);
    let candidato = base;
    let sufijo = 2;

    while (true) {
      const existente = await this.prisma.servicio.findUnique({
        where: { slug: candidato },
        select: { id: true },
      });
      if (!existente || existente.id === excluirId) return candidato;
      candidato = `${base}-${sufijo++}`;
    }
  }

  private pesos(valor: Prisma.Decimal | number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(Number(valor));
  }

  private resumenCambio(antes: Servicio, despues: Servicio): string {
    const cambios: string[] = [];
    if (antes.nombre !== despues.nombre) cambios.push(`nombre → "${despues.nombre}"`);
    if (Number(antes.precio) !== Number(despues.precio)) {
      cambios.push(`precio ${this.pesos(antes.precio)} → ${this.pesos(despues.precio)}`);
    }
    if (antes.duracionMinutos !== despues.duracionMinutos) {
      cambios.push(`duración ${antes.duracionMinutos} → ${despues.duracionMinutos} min`);
    }
    return `Editó el servicio "${antes.nombre}"${cambios.length ? `: ${cambios.join(', ')}` : ''}`;
  }
}
