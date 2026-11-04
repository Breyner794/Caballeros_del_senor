import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const raiz = fileURLToPath(new URL('.', import.meta.url));

/**
 * Pruebas de integración: Postgres de verdad.
 *
 * Van en una configuración aparte, y no mezcladas con las unitarias, por una
 * razón práctica: `pnpm test` tiene que seguir corriendo en tres segundos sin
 * Docker levantado. Quien no tenga la base arriba no puede quedarse sin poder
 * ejecutar nada.
 *
 * Lo que solo se puede comprobar aquí son las garantías que vienen del motor:
 * la restricción de exclusión anti-solape y los CHECK de coherencia. Con dobles
 * de Prisma esas reglas simplemente no existen — y son precisamente la red que
 * atrapa la carrera entre dos recepcionistas guardando el mismo hueco.
 *
 * Requisitos:  `pnpm db:up`  (o `DATABASE_URL_TEST` apuntando a otro Postgres)
 * Ejecución:   `pnpm --filter @cds/api test:integracion`
 */
export default defineConfig({
  resolve: {
    alias: {
      '@cds/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    root: raiz,
    include: ['test/integracion/**/*.spec.ts'],
    globalSetup: ['./test/integracion/soporte/preparar-base.ts'],
    // Una sola base compartida: los archivos se turnan en vez de pisarse las
    // tablas unos a otros al truncar.
    fileParallelism: false,
    sequence: { concurrent: false },
    // La prueba de concurrencia mantiene dos transacciones abiertas a la vez y
    // espera a que Postgres resuelva el bloqueo.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    clearMocks: true,
  },
});
