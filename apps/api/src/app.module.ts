import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { JwtModule } from '@nestjs/jwt';
import path from 'node:path';

import { validarEntorno } from './comun/configuracion/entorno.js';
import { ComunModule } from './comun/comun.module.js';
import { FiltroGlobalExcepciones } from './comun/excepciones/filtro-global.js';
import { GuardAutenticacion, GuardPermisos } from './comun/autenticacion/guards.js';
import { AutenticacionModule } from './modulos/autenticacion/autenticacion.module.js';
import { NotificacionesModule } from './modulos/notificaciones/notificaciones.module.js';
import { SedesModule } from './modulos/sedes/sedes.module.js';
import { ServiciosModule } from './modulos/servicios/servicios.module.js';
import { ClientesModule } from './modulos/clientes/clientes.module.js';
import { FidelidadModule } from './modulos/fidelidad/fidelidad.module.js';
import { DisponibilidadModule } from './modulos/disponibilidad/disponibilidad.module.js';
import { AgendaModule } from './modulos/agenda/agenda.module.js';
import { VentasModule } from './modulos/ventas/ventas.module.js';
import { ReservasModule } from './modulos/reservas/reservas.module.js';
import { UsuariosModule } from './modulos/usuarios/usuarios.module.js';
import { ConfiguracionModule } from './modulos/configuracion/configuracion.module.js';
import { AuditoriaConsultaModule } from './modulos/auditoria/auditoria.module.js';
import { InventarioModule } from './modulos/inventario/inventario.module.js';
import { ContabilidadModule } from './modulos/contabilidad/contabilidad.module.js';
import { SaludController } from './comun/salud/salud.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Un solo .env en la raíz del monorepo: el mismo que leen
      // docker-compose y la CLI de Prisma.
      envFilePath: [path.resolve(process.cwd(), '../../.env'), path.resolve(process.cwd(), '.env')],
      validate: validarEntorno,
    }),

    /**
     * Límite de peticiones global: 120 por minuto por IP.
     *
     * Es una red de seguridad contra abuso y scraping; las rutas sensibles
     * (login, recuperación de contraseña) llevan además su propio límite,
     * mucho más estricto, declarado en el controlador.
     */
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),

    ScheduleModule.forRoot(),

    // El guard de autenticación es global y vive en este módulo, así que
    // necesita JwtService aquí (cada token se firma con su propio secreto,
    // que se pasa en cada llamada; de ahí el registro vacío).
    JwtModule.register({}),

    ComunModule,
    NotificacionesModule,
    AutenticacionModule,
    SedesModule,
    ServiciosModule,
    ClientesModule,
    FidelidadModule,
    DisponibilidadModule,
    AgendaModule,
    VentasModule,
    ReservasModule,
    UsuariosModule,
    ConfiguracionModule,
    AuditoriaConsultaModule,
    InventarioModule,
    ContabilidadModule,
  ],
  controllers: [SaludController],
  providers: [
    { provide: APP_FILTER, useClass: FiltroGlobalExcepciones },
    // El orden importa: primero el límite de peticiones, luego la identidad y
    // por último los permisos.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: GuardAutenticacion },
    { provide: APP_GUARD, useClass: GuardPermisos },
  ],
})
export class AppModule {}
