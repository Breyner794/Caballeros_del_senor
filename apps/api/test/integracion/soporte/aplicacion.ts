import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { urlDePruebas } from './conexion.js';

/**
 * Aplicación Nest real, con el grafo completo de módulos, contra la base de
 * pruebas. La usan la prueba de arranque y las del canal público: así los
 * servicios que se ejercitan son los que el contenedor construye, con su
 * cableado verdadero, y no los que un doble monta a mano.
 */

export interface AplicacionDePruebas {
  app: INestApplication;
  /** URL base del servidor HTTP efímero (sin prefijo global). */
  base: string;
}

export async function arrancarAplicacion(): Promise<AplicacionDePruebas> {
  // El entorno que `AppModule` valida al arrancar. Son valores de pruebas: la
  // base es la `_test` (nunca la de desarrollo) y los secretos no protegen nada.
  process.env['DATABASE_URL'] = urlDePruebas();
  process.env['REDIS_URL'] ??= 'redis://localhost:6379';
  process.env['JWT_ACCESS_SECRET'] ??= 'secreto-de-acceso-solo-para-pruebas';
  process.env['JWT_REFRESH_SECRET'] ??= 'secreto-de-refresco-solo-para-pruebas';

  // Import dinámico: `ConfigModule` lee el entorno al evaluar el módulo, así
  // que tiene que cargarse DESPUÉS de fijar las variables de arriba.
  const [{ Test }, { AppModule }] = await Promise.all([
    import('@nestjs/testing'),
    import('../../../src/app.module.js'),
  ]);

  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = modulo.createNestApplication();
  await app.init();
  await app.listen(0);
  const base = (await app.getUrl()).replace('[::1]', 'localhost');
  return { app, base };
}
