import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import {
  actualizarPerfilSchema,
  actualizarUsuarioSchema,
  crearUsuarioSchema,
  listarUsuariosSchema,
  resetearPasswordUsuarioSchema,
} from '@cds/shared';
import { RequierePermisos, UsuarioActual } from '../../comun/autenticacion/decoradores.js';
import type { UsuarioAutenticado } from '../../comun/autenticacion/tipos.js';
import { validar } from '../../comun/validacion/zod.pipe.js';
import { UsuariosService } from './usuarios.service.js';

@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly servicio: UsuariosService) {}

  /**
   * El propio perfil.
   *
   * Va antes que `:id` a propósito: Nest resuelve las rutas en orden y `/mi`
   * encajaría en `:id` si estuviera después, provocando un error de UUID.
   */
  @Get('mi-perfil')
  miPerfil(@UsuarioActual() usuario: UsuarioAutenticado) {
    return this.servicio.obtener(usuario.id);
  }

  @Patch('mi-perfil')
  actualizarMiPerfil(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body(validar(actualizarPerfilSchema)) datos: z.infer<typeof actualizarPerfilSchema>,
  ) {
    return this.servicio.actualizarPerfil(usuario.id, datos, usuario);
  }

  @Get('mis-sesiones')
  misSesiones(@UsuarioActual() usuario: UsuarioAutenticado) {
    return this.servicio.sesiones(usuario.id);
  }

  @Get()
  @RequierePermisos('usuarios:ver')
  listar(@Query(validar(listarUsuariosSchema)) filtros: z.infer<typeof listarUsuariosSchema>) {
    return this.servicio.listar(filtros);
  }

  @Get(':id')
  @RequierePermisos('usuarios:ver')
  obtener(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicio.obtener(id);
  }

  @Post()
  @RequierePermisos('usuarios:gestionar')
  crear(
    @Body(validar(crearUsuarioSchema)) datos: z.infer<typeof crearUsuarioSchema>,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.crear(datos, usuario);
  }

  @Patch(':id')
  @RequierePermisos('usuarios:gestionar')
  actualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(validar(actualizarUsuarioSchema)) datos: z.infer<typeof actualizarUsuarioSchema>,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.actualizar(id, datos, usuario);
  }

  @Patch(':id/password')
  @RequierePermisos('usuarios:gestionar')
  async resetearPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(validar(resetearPasswordUsuarioSchema))
    datos: z.infer<typeof resetearPasswordUsuarioSchema>,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    await this.servicio.resetearPassword(id, datos.password, datos.notificar, usuario);
    return {
      mensaje:
        'Contraseña restablecida. El usuario deberá cambiarla la próxima vez que entre, y sus sesiones abiertas se cerraron.',
    };
  }

  @Delete(':id')
  @RequierePermisos('usuarios:gestionar')
  async eliminar(
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    await this.servicio.eliminar(id, usuario);
    return { mensaje: 'Usuario eliminado.' };
  }
}
