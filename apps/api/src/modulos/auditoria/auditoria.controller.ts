import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { z } from 'zod';
import { fechaSchema, paginacionSchema } from '@cds/shared';
import { RequierePermisos, UsuarioActual } from '../../comun/autenticacion/decoradores.js';
import type { UsuarioAutenticado } from '../../comun/autenticacion/tipos.js';
import { validar } from '../../comun/validacion/zod.pipe.js';
import { AuditoriaConsultaService } from './auditoria-consulta.service.js';

const ACCIONES = [
  'CREAR','ACTUALIZAR','ELIMINAR','INICIAR_SESION','CERRAR_SESION','INICIO_SESION_FALLIDO',
  'CAMBIAR_PASSWORD','RESTABLECER_PASSWORD','CANJEAR_FIDELIDAD','CANCELAR_RESERVA',
  'REPROGRAMAR_RESERVA','COMPLETAR_RESERVA','ANULAR_VENTA','AJUSTAR_INVENTARIO','EXPORTAR_DATOS',
] as const;

const filtrosAuditoria = paginacionSchema.extend({
  usuarioId: z.string().uuid().optional(),
  entidad: z.string().max(60).optional(),
  entidadId: z.string().max(64).optional(),
  accion: z.enum(ACCIONES).optional(),
  desde: fechaSchema.optional(),
  hasta: fechaSchema.optional(),
});

const filtrosErrores = paginacionSchema.extend({
  nivel: z.enum(['WARN', 'ERROR', 'FATAL']).optional(),
  resueltos: z.coerce.boolean().optional(),
});

@Controller('auditoria')
export class AuditoriaController {
  constructor(private readonly servicio: AuditoriaConsultaService) {}

  @Get()
  @RequierePermisos('auditoria:ver')
  listar(@Query(validar(filtrosAuditoria)) filtros: z.infer<typeof filtrosAuditoria>) {
    return this.servicio.listar(filtros);
  }

  @Get('acciones')
  @RequierePermisos('auditoria:ver')
  acciones() {
    return this.servicio.accionesUsadas();
  }

  /** Historia completa de un registro: una reserva, un cliente, un usuario. */
  @Get('historial/:entidad/:entidadId')
  @RequierePermisos('auditoria:ver')
  historial(@Param('entidad') entidad: string, @Param('entidadId') entidadId: string) {
    return this.servicio.historialDe(entidad, entidadId);
  }
}

@Controller('errores')
export class ErroresController {
  constructor(private readonly servicio: AuditoriaConsultaService) {}

  @Get()
  @RequierePermisos('errores:ver')
  listar(@Query(validar(filtrosErrores)) filtros: z.infer<typeof filtrosErrores>) {
    return this.servicio.errores(filtros);
  }

  @Get('resumen')
  @RequierePermisos('errores:ver')
  resumen() {
    return this.servicio.resumenErrores();
  }

  @Get(':id')
  @RequierePermisos('errores:ver')
  detalle(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicio.detalleError(id);
  }

  @Patch(':id/resuelto')
  @RequierePermisos('errores:ver')
  marcarResuelto(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(validar(z.object({ resuelto: z.boolean(), notas: z.string().max(2000).optional() })))
    datos: { resuelto: boolean; notas?: string },
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.marcarResuelto(id, datos.resuelto, datos.notas, usuario);
  }
}
