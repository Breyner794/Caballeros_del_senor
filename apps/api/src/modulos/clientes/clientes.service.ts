import { Injectable } from '@nestjs/common';
import { Prisma, type Cliente } from '@prisma/client';
import {
  calcularSalto,
  construirMeta,
  telefonoVisible,
  type ActualizarClienteDto,
  type CrearClienteDto,
  type PaginaRespuesta,
} from '@cds/shared';
import { PrismaService } from '../../comun/prisma/prisma.service.js';
import { AuditoriaService } from '../../comun/auditoria/auditoria.service.js';
import { ErrorNegocio } from '../../comun/excepciones/error-negocio.js';
import { ConfiguracionNegocioService } from '../../comun/configuracion/configuracion-negocio.service.js';
import type { UsuarioAutenticado } from '../../comun/autenticacion/tipos.js';

/** Lo que ve la recepción al buscar en el formulario de reservas. */
export interface ClienteBusqueda {
  id: string;
  nombreCompleto: string;
  telefono: string;
  telefonoVisible: string;
  totalVisitas: number;
  ultimaVisitaEn: Date | null;
  /** Sellos disponibles y si ya tiene premio: el aviso del 8º corte gratis. */
  sellosDisponibles: number;
  sellosRequeridos: number;
  tienePremio: boolean;
  notas: string | null;
}

export interface FichaCliente extends Cliente {
  sellosDisponibles: number;
  sellosRequeridos: number;
  tienePremio: boolean;
  /** Cuántas visitas le faltan para el premio. */
  faltanParaPremio: number;
  visitasEsteMes: number;
  servicioFavorito: { nombre: string; veces: number } | null;
  barberoHabitual: { id: string; nombre: string; veces: number } | null;
  premiosCanjeados: number;
}

@Injectable()
export class ClientesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly configuracion: ConfiguracionNegocioService,
  ) {}

  /**
   * Búsqueda del formulario de reservas: por nombre o por teléfono, a la vez.
   *
   * Usa los índices trigram, así que tolera acentos y errores de tipeo: quien
   * escriba "jose" encuentra a "José Andrés", y quien teclee los últimos
   * cuatro dígitos del celular también lo encuentra. Es deliberadamente
   * tolerante porque es lo que la recepción hace con el cliente delante y el
   * teléfono sonando.
   *
   * Va por SQL directo porque Prisma no expone los operadores de similitud de
   * trigram, y sin ellos la búsqueda haría un recorrido completo de la tabla.
   */
  async buscar(consulta: string, limite = 8): Promise<ClienteBusqueda[]> {
    const programa = await this.configuracion.obtenerFidelidad();
    const termino = consulta.trim();
    const soloDigitos = termino.replace(/\D/g, '');

    const filas = await this.prisma.$queryRaw<
      {
        id: string;
        nombreCompleto: string;
        telefono: string;
        totalVisitas: number;
        ultimaVisitaEn: Date | null;
        notas: string | null;
        sellos: bigint;
      }[]
    >`
      SELECT c.id,
             c."nombreCompleto",
             c.telefono,
             c."totalVisitas",
             c."ultimaVisitaEn",
             c.notas,
             (SELECT count(*) FROM sellos_fidelidad s
               WHERE s."clienteId" = c.id AND s."canjeId" IS NULL
                 AND (s."caducaEn" IS NULL OR s."caducaEn" > now())) AS sellos
      FROM clientes c
      WHERE c."eliminadoEn" IS NULL
        AND c.activo = true
        AND c."esGenerico" = false
        AND (
          public.normalizar_texto(c."nombreCompleto") LIKE '%' || public.normalizar_texto(${termino}) || '%'
          OR (${soloDigitos} <> '' AND c.telefono LIKE '%' || ${soloDigitos} || '%')
        )
      ORDER BY
        -- Primero quien empieza por lo que se escribió, luego por similitud y
        -- a igualdad, el cliente más reciente: el habitual aparece arriba.
        (public.normalizar_texto(c."nombreCompleto") LIKE public.normalizar_texto(${termino}) || '%') DESC,
        similarity(public.normalizar_texto(c."nombreCompleto"), public.normalizar_texto(${termino})) DESC,
        c."ultimaVisitaEn" DESC NULLS LAST
      LIMIT ${limite}
    `;

    return filas.map((fila) => {
      const sellos = Number(fila.sellos);
      return {
        id: fila.id,
        nombreCompleto: fila.nombreCompleto,
        telefono: fila.telefono,
        telefonoVisible: telefonoVisible(fila.telefono),
        totalVisitas: fila.totalVisitas,
        ultimaVisitaEn: fila.ultimaVisitaEn,
        sellosDisponibles: sellos,
        sellosRequeridos: programa.sellosRequeridos,
        tienePremio: programa.activo && sellos >= programa.sellosRequeridos,
        notas: fila.notas,
      };
    });
  }

  async listar(filtros: {
    pagina: number;
    limite: number;
    buscar?: string;
    activo?: boolean;
    conPremioDisponible?: boolean;
    pendientesDeRegreso?: boolean;
    orden: 'asc' | 'desc';
    ordenarPor?: string;
  }): Promise<PaginaRespuesta<ClienteBusqueda & { regresoEstimadoEn: Date | null; promedioDiasRegreso: number | null; totalGastado: Prisma.Decimal }>> {
    const { skip, take, pagina, limite } = calcularSalto(filtros.pagina, filtros.limite);
    const programa = await this.configuracion.obtenerFidelidad();

    const where: Prisma.ClienteWhereInput = {
      eliminadoEn: null,
      esGenerico: false,
      ...(filtros.activo !== undefined ? { activo: filtros.activo } : {}),
      ...(filtros.buscar
        ? {
            OR: [
              { nombreCompleto: { contains: filtros.buscar, mode: 'insensitive' } },
              { telefono: { contains: filtros.buscar.replace(/\D/g, '') || filtros.buscar } },
            ],
          }
        : {}),
      // Clientes que ya deberían haber vuelto: la lista para llamarlos.
      ...(filtros.pendientesDeRegreso
        ? { regresoEstimadoEn: { lte: new Date() }, ultimaVisitaEn: { not: null } }
        : {}),
    };

    const ordenables = new Set([
      'nombreCompleto',
      'totalVisitas',
      'ultimaVisitaEn',
      'totalGastado',
      'creadoEn',
      'regresoEstimadoEn',
    ]);
    const campoOrden =
      filtros.ordenarPor && ordenables.has(filtros.ordenarPor) ? filtros.ordenarPor : 'ultimaVisitaEn';

    const [clientes, total] = await this.prisma.$transaction([
      this.prisma.cliente.findMany({
        where,
        skip,
        take,
        orderBy: { [campoOrden]: { sort: filtros.orden, nulls: 'last' } },
        include: {
          _count: {
            select: {
              sellos: {
                where: { canjeId: null, OR: [{ caducaEn: null }, { caducaEn: { gt: new Date() } }] },
              },
            },
          },
        },
      }),
      this.prisma.cliente.count({ where }),
    ]);

    const datos = clientes
      .map((cliente) => {
        const sellos = cliente._count.sellos;
        return {
          id: cliente.id,
          nombreCompleto: cliente.nombreCompleto,
          telefono: cliente.telefono,
          telefonoVisible: telefonoVisible(cliente.telefono),
          totalVisitas: cliente.totalVisitas,
          ultimaVisitaEn: cliente.ultimaVisitaEn,
          regresoEstimadoEn: cliente.regresoEstimadoEn,
          promedioDiasRegreso: cliente.promedioDiasRegreso,
          totalGastado: cliente.totalGastado,
          sellosDisponibles: sellos,
          sellosRequeridos: programa.sellosRequeridos,
          tienePremio: programa.activo && sellos >= programa.sellosRequeridos,
          notas: cliente.notas,
        };
      })
      .filter((c) => !filtros.conPremioDisponible || c.tienePremio);

    return { datos, meta: construirMeta(total, pagina, limite) };
  }

  /** Ficha completa: lo que se ve al abrir un cliente en el panel. */
  async obtener(id: string): Promise<FichaCliente> {
    const cliente = await this.prisma.cliente.findFirst({ where: { id, eliminadoEn: null } });
    if (!cliente) throw ErrorNegocio.noEncontrado('ese cliente');

    const programa = await this.configuracion.obtenerFidelidad();
    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);

    const [sellosDisponibles, visitasEsteMes, premiosCanjeados, servicios, barberos] =
      await Promise.all([
        this.prisma.selloFidelidad.count({
          where: {
            clienteId: id,
            canjeId: null,
            OR: [{ caducaEn: null }, { caducaEn: { gt: new Date() } }],
          },
        }),
        this.prisma.reserva.count({
          where: { clienteId: id, estado: 'COMPLETADA', completadaEn: { gte: inicioMes } },
        }),
        this.prisma.canjeFidelidad.count({ where: { clienteId: id } }),
        this.prisma.reservaServicio.groupBy({
          by: ['nombreSnapshot'],
          where: { reserva: { clienteId: id, estado: 'COMPLETADA' } },
          _count: { nombreSnapshot: true },
          orderBy: { _count: { nombreSnapshot: 'desc' } },
          take: 1,
        }),
        this.prisma.reserva.groupBy({
          by: ['barberoId'],
          where: { clienteId: id, estado: 'COMPLETADA' },
          _count: { barberoId: true },
          orderBy: { _count: { barberoId: 'desc' } },
          take: 1,
        }),
      ]);

    const barberoHabitualId = barberos[0]?.barberoId;
    const barberoHabitual = barberoHabitualId
      ? await this.prisma.usuario.findUnique({
          where: { id: barberoHabitualId },
          select: { id: true, nombre: true, apellido: true, alias: true },
        })
      : null;

    return {
      ...cliente,
      sellosDisponibles,
      sellosRequeridos: programa.sellosRequeridos,
      tienePremio: programa.activo && sellosDisponibles >= programa.sellosRequeridos,
      faltanParaPremio: Math.max(0, programa.sellosRequeridos - sellosDisponibles),
      visitasEsteMes,
      premiosCanjeados,
      servicioFavorito: servicios[0]
        ? { nombre: servicios[0].nombreSnapshot, veces: servicios[0]._count.nombreSnapshot }
        : null,
      barberoHabitual:
        barberoHabitual && barberos[0]
          ? {
              id: barberoHabitual.id,
              nombre: barberoHabitual.alias ?? barberoHabitual.nombre,
              veces: barberos[0]._count.barberoId,
            }
          : null,
    };
  }

  /** Historial de visitas, paginado. */
  async historial(id: string, pagina = 1, limite = 10) {
    const { skip, take, ...meta } = calcularSalto(pagina, limite);

    const [reservas, total] = await this.prisma.$transaction([
      this.prisma.reserva.findMany({
        where: { clienteId: id },
        skip,
        take,
        orderBy: { inicioEn: 'desc' },
        select: {
          id: true,
          codigo: true,
          inicioEn: true,
          estado: true,
          total: true,
          canal: true,
          notaCliente: true,
          barbero: { select: { id: true, nombre: true, alias: true } },
          sede: { select: { id: true, nombre: true } },
          servicios: { select: { nombreSnapshot: true, precioSnapshot: true } },
          canje: { select: { id: true } },
        },
      }),
      this.prisma.reserva.count({ where: { clienteId: id } }),
    ]);

    return { datos: reservas, meta: construirMeta(total, meta.pagina, meta.limite) };
  }

  async crear(
    // Los consentimientos son opcionales a propósito: el canal público los omite
    // para no pisar, al reactivar una ficha, lo que el cliente ya había decidido.
    datos: Omit<CrearClienteDto, 'aceptaEmail' | 'aceptaWhatsapp'> &
      Partial<Pick<CrearClienteDto, 'aceptaEmail' | 'aceptaWhatsapp'>>,
    actor?: UsuarioAutenticado | null,
  ): Promise<Cliente> {
    const existente = await this.prisma.cliente.findUnique({
      where: { telefono: datos.telefono },
      select: { id: true, nombreCompleto: true, eliminadoEn: true },
    });

    if (existente) {
      // Si estaba eliminado se reactiva en vez de fallar: es el mismo cliente
      // de siempre, que vuelve.
      if (existente.eliminadoEn) {
        return this.prisma.cliente.update({
          where: { id: existente.id },
          data: { ...datos, eliminadoEn: null, activo: true },
        });
      }
      throw ErrorNegocio.duplicado(`un cliente con ese celular (${existente.nombreCompleto})`, {
        telefono: ['Ya hay un cliente registrado con este celular'],
      });
    }

    const cliente = await this.prisma.cliente.create({
      data: {
        ...datos,
        fechaNacimiento: datos.fechaNacimiento ? new Date(datos.fechaNacimiento) : null,
      },
    });

    await this.auditoria.registrar({
      accion: 'CREAR',
      entidad: 'Cliente',
      entidadId: cliente.id,
      despues: cliente,
      resumen: `Registró al cliente ${cliente.nombreCompleto} (${telefonoVisible(cliente.telefono)})`,
      actor,
    });

    return cliente;
  }

  async actualizar(
    id: string,
    datos: ActualizarClienteDto,
    actor: UsuarioAutenticado,
  ): Promise<Cliente> {
    const antes = await this.prisma.cliente.findFirst({ where: { id, eliminadoEn: null } });
    if (!antes) throw ErrorNegocio.noEncontrado('ese cliente');

    if (antes.esGenerico) {
      throw ErrorNegocio.conflicto(
        'CONFLICTO',
        undefined,
        'El cliente genérico "Consumidor final" no se puede editar: lo usa el sistema para las ventas sin registrar.',
      );
    }

    const despues = await this.prisma.cliente.update({
      where: { id },
      data: {
        ...datos,
        ...(datos.fechaNacimiento !== undefined
          ? { fechaNacimiento: datos.fechaNacimiento ? new Date(datos.fechaNacimiento) : null }
          : {}),
      },
    });

    await this.auditoria.registrarCambio({
      accion: 'ACTUALIZAR',
      entidad: 'Cliente',
      entidadId: id,
      antes: antes as unknown as Record<string, unknown>,
      despues: despues as unknown as Record<string, unknown>,
      resumen: `Editó la ficha de ${antes.nombreCompleto}`,
      actor,
    });

    return despues;
  }

  async eliminar(id: string, actor: UsuarioAutenticado): Promise<void> {
    const cliente = await this.prisma.cliente.findFirst({ where: { id, eliminadoEn: null } });
    if (!cliente) throw ErrorNegocio.noEncontrado('ese cliente');

    if (cliente.esGenerico) {
      throw ErrorNegocio.conflicto(
        'CONFLICTO',
        undefined,
        'El cliente genérico no se puede eliminar: lo usa el sistema para las ventas sin registrar.',
      );
    }

    const futuras = await this.prisma.reserva.count({
      where: {
        clienteId: id,
        estado: { in: ['PENDIENTE', 'CONFIRMADA', 'EN_CURSO'] },
        inicioEn: { gte: new Date() },
      },
    });

    if (futuras > 0) {
      throw ErrorNegocio.conflicto(
        'CONFLICTO',
        { reservasFuturas: futuras },
        `${cliente.nombreCompleto} tiene ${futuras} ${futuras === 1 ? 'cita' : 'citas'} pendiente${futuras === 1 ? '' : 's'}. Cancélalas antes de eliminar la ficha.`,
      );
    }

    // Eliminación lógica: el historial de visitas y las ventas siguen en pie
    // para los informes del contador.
    await this.prisma.cliente.update({
      where: { id },
      data: { eliminadoEn: new Date(), activo: false },
    });

    await this.auditoria.registrar({
      accion: 'ELIMINAR',
      entidad: 'Cliente',
      entidadId: id,
      antes: cliente,
      resumen: `Eliminó la ficha de ${cliente.nombreCompleto}`,
      actor,
    });
  }

  /** El "Consumidor final" para los walk-ins que no dejan sus datos. */
  async clienteGenerico(): Promise<Cliente> {
    const existente = await this.prisma.cliente.findFirst({ where: { esGenerico: true } });
    if (existente) return existente;

    return this.prisma.cliente.create({
      data: {
        nombreCompleto: 'Consumidor final',
        telefono: '+570000000000',
        esGenerico: true,
        aceptaWhatsapp: false,
        notas:
          'Cliente genérico para ventas sin registrar. No acumula fidelidad: si el barbero no crea la ficha, el cliente no suma cortes.',
      },
    });
  }

  /**
   * Recalcula las métricas del cliente tras completar una visita.
   *
   * Se guardan desnormalizadas (`totalVisitas`, `promedioDiasRegreso`…) porque
   * la lista de clientes las muestra en todas las filas, y calcularlas al vuelo
   * obligaría a agregar sobre todo el historial en cada carga de la tabla.
   *
   * `promedioDiasRegreso` es lo que pidió el cliente: cada cuánto suele volver
   * cada persona. Se calcula sobre las últimas visitas, no sobre todas, para
   * que refleje el hábito actual y no el de hace tres años.
   */
  async recalcularMetricas(clienteId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;

    const visitas = await db.reserva.findMany({
      where: { clienteId, estado: 'COMPLETADA' },
      select: { completadaEn: true, inicioEn: true, total: true },
      orderBy: { inicioEn: 'desc' },
      take: 12,
    });

    const [agregado, cancelaciones, noAsistio] = await Promise.all([
      db.reserva.aggregate({
        where: { clienteId, estado: 'COMPLETADA' },
        _count: { _all: true },
        _sum: { total: true },
        _min: { inicioEn: true },
        _max: { inicioEn: true },
      }),
      db.reserva.count({ where: { clienteId, estado: 'CANCELADA' } }),
      db.reserva.count({ where: { clienteId, estado: 'NO_ASISTIO' } }),
    ]);

    // Días entre visitas consecutivas (las fechas vienen de más nueva a más
    // vieja, así que la resta es al contrario).
    const intervalos: number[] = [];
    for (let i = 0; i < visitas.length - 1; i++) {
      const actual = visitas[i]?.inicioEn;
      const anterior = visitas[i + 1]?.inicioEn;
      if (!actual || !anterior) continue;
      const dias = Math.round((actual.getTime() - anterior.getTime()) / 86_400_000);
      if (dias > 0 && dias < 365) intervalos.push(dias);
    }

    const promedio =
      intervalos.length > 0
        ? Math.round(intervalos.reduce((a, b) => a + b, 0) / intervalos.length)
        : null;

    const ultimaVisita = agregado._max.inicioEn;

    await db.cliente.update({
      where: { id: clienteId },
      data: {
        totalVisitas: agregado._count._all,
        totalGastado: agregado._sum.total ?? 0,
        primeraVisitaEn: agregado._min.inicioEn,
        ultimaVisitaEn: ultimaVisita,
        promedioDiasRegreso: promedio,
        regresoEstimadoEn:
          promedio && ultimaVisita
            ? new Date(ultimaVisita.getTime() + promedio * 86_400_000)
            : null,
        totalCancelaciones: cancelaciones,
        totalNoAsistio: noAsistio,
      },
    });
  }
}
