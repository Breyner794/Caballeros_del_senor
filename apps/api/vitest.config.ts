import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const raiz = fileURLToPath(new URL('.', import.meta.url));

/**
 * Configuración de pruebas de la API.
 *
 * Dos decisiones que conviene no deshacer sin pensarlo:
 *
 *  · `@cds/shared` se resuelve al código fuente, no a `dist`. Las pruebas
 *    ejercitan los esquemas de Zod y el motor de horarios reales, y si
 *    apuntaran al compilado habría que recordar construir el paquete antes de
 *    cada ejecución — el día que alguien lo olvide, la suite valida una
 *    versión vieja de las reglas y pasa en verde sin querer.
 *
 *  · Nada de base de datos. Hace falta `pnpm prisma:generate` una vez (los
 *    servicios importan `Prisma.Decimal` del cliente generado), pero ninguna
 *    prueba abre una conexión. Los servicios se instancian a mano con dobles, de
 *    forma que la suite corre en cualquier portátil y en CI sin Postgres
 *    levantado. Lo que no se puede cubrir así (la restricción de exclusión
 *    anti-solape, que es del motor) queda explícitamente fuera y anotado en
 *    los propios casos.
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
    setupFiles: ['./test/soporte/preparar.ts'],
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    // Las de integración necesitan Postgres y viven en su propia configuración
    // (`vitest.integracion.config.ts`): aquí solo estorbarían.
    exclude: ['**/node_modules/**', '**/dist/**', 'test/integracion/**'],
    clearMocks: true,
    restoreMocks: true,
  },
});
