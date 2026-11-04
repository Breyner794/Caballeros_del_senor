import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module.js';

async function arrancar(): Promise<void> {
  const logger = new Logger('Arranque');
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  const entorno = config.get<string>('NODE_ENV') ?? 'development';
  const puerto = config.get<number>('API_PORT') ?? 3001;
  const prefijo = config.get<string>('API_PREFIX') ?? 'api/v1';

  app.setGlobalPrefix(prefijo);

  /**
   * Cabeceras de seguridad.
   *
   * La API solo devuelve JSON, así que la CSP se cierra por completo: no se
   * sirve HTML y por tanto nada legítimo necesita cargar scripts ni estilos.
   * `crossOriginResourcePolicy` se relaja a same-site porque el panel y la web
   * del cliente viven en subdominios distintos del mismo sitio.
   */
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: entorno === 'production' ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );

  app.use(cookieParser());

  /**
   * Id de correlación.
   *
   * Cada petición recibe un identificador que viaja al log, a la auditoría y
   * al registro de errores, y que se devuelve en la respuesta de error. Cuando
   * el barbero llame diciendo "me salió un error", ese código lleva directo a
   * la traza exacta.
   */
  app.use((peticion: Request, respuesta: Response, siguiente: NextFunction) => {
    const id = (peticion.headers['x-request-id'] as string | undefined) ?? randomUUID();
    peticion.headers['x-request-id'] = id;
    peticion.requestId = id;
    respuesta.setHeader('x-request-id', id);
    siguiente();
  });

  /**
   * CORS restringido a los dos orígenes del proyecto.
   *
   * `credentials: true` es imprescindible porque el refresh token viaja en una
   * cookie httpOnly, y eso obliga a enumerar los orígenes explícitamente: con
   * credenciales, el comodín `*` no es válido.
   */
  const origenes = [
    config.get<string>('PANEL_ORIGIN'),
    config.get<string>('BOOKING_ORIGIN'),
  ].filter((o): o is string => Boolean(o));

  app.enableCors({
    origin: origenes,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    // `x-token-gestion` lo envía la web pública al gestionar su cita; sin
    // listarlo, el navegador rechaza la petición en el preflight.
    allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id', 'x-token-gestion'],
    exposedHeaders: ['x-request-id'],
    maxAge: 86_400,
  });

  // Detrás del proxy de Dokploy: hace que peticion.ip sea la IP real del
  // cliente y no la del contenedor del proxy, que es lo que registran la
  // auditoría y el bloqueo por intentos fallidos.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.enableShutdownHooks();

  // La documentación solo existe fuera de producción: en el VPS no se publica
  // el mapa completo de la API.
  if (entorno !== 'production') {
    const documento = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Caballeros del Señor — API')
        .setDescription('Sistema de reservas y gestión de barbería')
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup(`${prefijo}/docs`, app, documento);
  }

  await app.listen(puerto, '0.0.0.0');

  logger.log(`API escuchando en http://localhost:${puerto}/${prefijo} (entorno: ${entorno})`);
  if (entorno !== 'production') {
    logger.log(`Documentación en http://localhost:${puerto}/${prefijo}/docs`);
  }
}

void arrancar();
