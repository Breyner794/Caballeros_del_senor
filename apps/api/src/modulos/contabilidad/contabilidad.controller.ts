import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { fechaSchema, idSchema, porcentajeSchema } from '@cds/shared';
import { RequierePermisos } from '../../comun/autenticacion/decoradores.js';
import { validar } from '../../comun/validacion/zod.pipe.js';
import { ContabilidadService } from './contabilidad.service.js';

const filtros = z
  .object({
    desde: fechaSchema,
    hasta: fechaSchema,
    sedeId: idSchema.optional(),
  })
  .refine((v) => v.desde <= v.hasta, {
    message: 'La fecha inicial no puede ser posterior a la final',
    path: ['desde'],
  });

const simulacion = z.object({
  desde: fechaSchema,
  hasta: fechaSchema,
  sedeId: idSchema.optional(),
  porcentajes: z.array(z.object({ barberoId: idSchema, porcentaje: porcentajeSchema })).max(50),
});

@Controller('contabilidad')
export class ContabilidadController {
  constructor(private readonly servicio: ContabilidadService) {}

  @Get('resumen')
  @RequierePermisos('contabilidad:ver')
  resumen(@Query(validar(filtros)) f: z.infer<typeof filtros>) {
    return this.servicio.resumen(f);
  }

  @Get('por-barbero')
  @RequierePermisos('contabilidad:ver')
  porBarbero(@Query(validar(filtros)) f: z.infer<typeof filtros>) {
    return this.servicio.porBarbero(f);
  }

  @Get('por-sede')
  @RequierePermisos('contabilidad:ver_todas_sedes')
  porSede(@Query(validar(filtros)) f: z.infer<typeof filtros>) {
    return this.servicio.porSede(f);
  }

  @Get('por-servicio')
  @RequierePermisos('contabilidad:ver')
  porServicio(@Query(validar(filtros)) f: z.infer<typeof filtros>) {
    return this.servicio.porServicio(f);
  }

  @Get('evolucion')
  @RequierePermisos('contabilidad:ver')
  evolucion(@Query(validar(filtros)) f: z.infer<typeof filtros>) {
    return this.servicio.evolucionDiaria(f);
  }

  @Get('comisiones-vigentes')
  @RequierePermisos('contabilidad:ver')
  comisionesVigentes() {
    return this.servicio.comisionesVigentes();
  }

  /**
   * Simulador de reparto.
   *
   * Es POST aunque no guarde nada: los porcentajes a probar son una lista y no
   * caben con comodidad en una query string. No modifica ningún dato.
   */
  @Post('simular-reparto')
  @RequierePermisos('contabilidad:ver')
  simular(@Body(validar(simulacion)) datos: z.infer<typeof simulacion>) {
    const { porcentajes, ...f } = datos;
    return this.servicio.simularReparto(f, porcentajes);
  }

  @Get('ventas')
  @RequierePermisos('contabilidad:ver')
  ventas(
    @Query(validar(filtros)) f: z.infer<typeof filtros>,
    @Query('pagina') pagina?: string,
    @Query('limite') limite?: string,
  ) {
    return this.servicio.detalleVentas({
      ...f,
      pagina: Number(pagina) || 1,
      limite: Number(limite) || 100,
    });
  }
}
