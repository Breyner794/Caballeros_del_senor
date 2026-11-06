import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Configuración de pruebas de la web pública.
 *
 *  · Entorno `jsdom` y Testing Library para probar componentes como los ve
 *    quien los usa.
 *  · `globals: false`: `describe`, `it`, `expect` y `vi` se importan de
 *    `vitest`. Así cada archivo dice de dónde sale lo que usa.
 *  · `@cds/shared` se resuelve al código fuente, no a `dist`, para no
 *    validar contra una versión vieja si se olvida reconstruir el paquete.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@cds/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: false,
    environment: 'jsdom',
    setupFiles: ['./test/preparar.ts'],
    include: ['src/**/*.spec.{ts,tsx}'],
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
  },
});
