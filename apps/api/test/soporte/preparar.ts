/**
 * Preparación global.
 *
 * `reflect-metadata` hace falta porque los servicios llevan `@Injectable()`:
 * el decorador escribe metadatos al cargar la clase y sin el polyfill la
 * importación falla antes de ejecutar un solo caso.
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { beforeAll } from 'vitest';

beforeAll(() => {
  // Los servicios registran líneas informativas. En la suite solo ensucian la
  // salida y esconden los fallos reales.
  Logger.overrideLogger(false);
});
