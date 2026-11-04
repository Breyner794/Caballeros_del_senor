import { Injectable } from '@nestjs/common';
import type { BarberoPublico, ConfigPublica, OpcionesPublicas } from '@cds/shared';
import { PrismaService } from '../../comun/prisma/prisma.service.js';
import { ConfiguracionNegocioService } from '../../comun/configuracion/configuracion-negocio.service.js';
import { aBarberoPublico, aSedePublica, aServicioPublico } from './dto-publico.js';

/**
 * Los `select` piden solo las columnas que emite el mapeador correspondiente:
 * una fuga tendría que atravesar dos barreras (el `select` y el mapeador).
 * Si el mapeador gana un campo, hay que añadirlo aquí o saldrá `undefined`.
 */
const SELECT_SEDE = {
  id: true,
  nombre: true,
  direccion: true,
  ciudad: true,
  telefono: true,
  mapsUrl: true,
} as const;

const SELECT_SERVICIO = {
  id: true,
  nombre: true,
  descripcion: true,
  incluye: true,
  precio: true,
  duracionMinutos: true,
} as const;

/** `sedeId` y `sedesPermitidas` solo sirven para agrupar: no salen en la respuesta. */
const SELECT_BARBERO = {
  id: true,
  nombre: true,
  alias: true,
  bio: true,
  fotoUrl: true,
  sedeId: true,
  sedesPermitidas: { select: { sedeId: true } },
} as const;

/**
 * Fachada del canal público: valida (en el controlador), llama a la
 * persistencia y traduce con los mapeadores. No contiene lógica de negocio.
 */
@Injectable()
export class PublicoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configuracion: ConfiguracionNegocioService,
  ) {}

  // ---------------------------------------------------------------- Opciones

  /** Todo lo que el asistente de reserva necesita para que el cliente elija. */
  async opciones(): Promise<OpcionesPublicas> {
    const [sedes, servicios, barberos, config] = await Promise.all([
      this.prisma.sede.findMany({
        where: { activa: true, eliminadoEn: null },
        select: SELECT_SEDE,
        orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
      }),
      this.prisma.servicio.findMany({
        where: { activo: true, visibleWeb: true, eliminadoEn: null },
        select: SELECT_SERVICIO,
        orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
      }),
      this.prisma.usuario.findMany({
        where: { rol: 'BARBERO', activo: true, visibleWeb: true, eliminadoEn: null },
        select: SELECT_BARBERO,
        orderBy: { nombre: 'asc' },
      }),
      this.configuracion.obtener(),
    ]);

    // Un barbero atiende en su sede principal y en todas las `sedesPermitidas`
    // (cubre turnos): aparece en cada una de ellas, una sola vez por sede.
    const barberosPorSede = new Map<string, BarberoPublico[]>();
    for (const barbero of barberos) {
      const sedesHabilitadas = new Set<string>(barbero.sedesPermitidas.map((s) => s.sedeId));
      if (barbero.sedeId) sedesHabilitadas.add(barbero.sedeId);
      const publico = aBarberoPublico(barbero);
      for (const sedeId of sedesHabilitadas) {
        const lista = barberosPorSede.get(sedeId) ?? [];
        lista.push(publico);
        barberosPorSede.set(sedeId, lista);
      }
    }

    return {
      sedes: sedes.map((sede) => ({
        ...aSedePublica(sede),
        barberos: barberosPorSede.get(sede.id) ?? [],
      })),
      servicios: servicios.map(aServicioPublico),
      config: aConfigPublica(config),
    };
  }
}

/** Solo los seis campos que el frontend necesita para comportarse como la API. */
function aConfigPublica(config: {
  permiteElegirBarbero: boolean;
  maxDiasAnticipacion: number;
  minAntelacionMinutos: number;
  zonaHoraria: string;
  moneda: string;
  nombreNegocio: string;
}): ConfigPublica {
  return {
    permiteElegirBarbero: config.permiteElegirBarbero,
    maxDiasAnticipacion: config.maxDiasAnticipacion,
    minAntelacionMinutos: config.minAntelacionMinutos,
    zonaHoraria: config.zonaHoraria,
    moneda: config.moneda,
    nombreNegocio: config.nombreNegocio,
  };
}
