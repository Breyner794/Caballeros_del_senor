import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { z } from 'zod';
import { actualizarProgramaFidelidadSchema } from '@cds/shared';
import { RequierePermisos, UsuarioActual } from '../../comun/autenticacion/decoradores.js';
import type { UsuarioAutenticado } from '../../comun/autenticacion/tipos.js';
import { validar } from '../../comun/validacion/zod.pipe.js';
import { FidelidadService } from './fidelidad.service.js';
import { ConfiguracionNegocioService } from '../../comun/configuracion/configuracion-negocio.service.js';

@Controller('fidelidad')
export class FidelidadController {
  constructor(
    private readonly servicio: FidelidadService,
    private readonly configuracion: ConfiguracionNegocioService,
  ) {}

  @Get('programa')
  @RequierePermisos('fidelidad:ver')
  programa() {
    return this.configuracion.obtenerFidelidad();
  }

  /** Clientes que ya tienen el premio: la lista para avisarles. */
  @Get('con-premio')
  @RequierePermisos('fidelidad:ver')
  async conPremio(@Query('sedeId') sedeId?: string) {
    const filas = await this.servicio.conPremioDisponible(sedeId);
    return filas.map((f) => ({ ...f, sellos: Number(f.sellos) }));
  }

  @Patch('programa')
  @RequierePermisos('fidelidad:configurar')
  actualizar(
    @Body(validar(actualizarProgramaFidelidadSchema))
    datos: z.infer<typeof actualizarProgramaFidelidadSchema>,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.actualizarPrograma(datos, usuario);
  }
}
