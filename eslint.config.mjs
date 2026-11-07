import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Configuración única de ESLint para todo el monorepo.
 *
 * Vive en la raíz y no una por paquete a propósito: las tres aplicaciones y
 * `packages/shared` comparten el mismo TypeScript estricto y las mismas
 * convenciones, así que una sola configuración plana evita que las reglas se
 * desincronicen entre carpetas. `pnpm lint` desde la raíz revisa el
 * repositorio completo; para una parte, `pnpm exec eslint apps/api`.
 *
 * Las reglas son las recomendadas de JavaScript y de typescript-eslint *sin*
 * información de tipos. La variante con tipos (`recommendedTypeChecked`) exige
 * un `tsconfig` por paquete que ESLint pueda abrir y, sobre este código,
 * levantaba cientos de avisos de `no-unsafe-*` por el cliente de Prisma y los
 * dobles de las pruebas. Se empieza por lo que el código ya cumple; endurecer
 * es un paso aparte y deliberado.
 *
 * `eslint-config-prettier` va al final: el formato lo decide Prettier
 * (`.prettierrc`), y ESLint no opina de comas ni de comillas.
 */
export default tseslint.config(
  // ───────────────────────── Qué no se revisa ─────────────────────────
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      'apps/api/generated/**',
      'packages/shared/dist/**',
      // Artefactos de proceso y de herramientas, no código del proyecto.
      '.claude/**',
      '.agents/**',
      '.superpowers/**',
      'graphify-out/**',
      'infra/**',
      '**/*.tsbuildinfo',
    ],
  },

  // ───────────────────────── Base para todo ─────────────────────────
  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx,mts,cts,js,mjs,cjs,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      // Las interfaces vacías que extienden las props de un componente de
      // Radix son el patrón que usa shadcn; no son un error.
      '@typescript-eslint/no-empty-object-type': [
        'error',
        { allowInterfaces: 'with-single-extends' },
      ],
      // Un argumento o una variable que empieza por `_` está ahí a propósito
      // (firmas de callbacks, descartes de desestructuración).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },

  // ───────────────────────── API (Node + Nest) ─────────────────────────
  {
    files: [
      'apps/api/**/*.ts',
      'packages/shared/**/*.ts',
      '**/*.config.{ts,mts,js,mjs}',
      '**/*.mjs',
    ],
    languageOptions: {
      globals: globals.node,
    },
  },

  // ─────────────────── Paneles web (React 19 + Vite) ───────────────────
  {
    files: ['apps/panel/**/*.{ts,tsx}', 'apps/booking/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2023 },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { 'react-refresh': reactRefresh, 'react-hooks': reactHooks },
    rules: {
      // Las dos reglas clásicas de los hooks. El plugin v7 trae además el
      // compilador de React con una treintena de reglas nuevas
      // (`set-state-in-effect`, `purity`, `immutability`…); encenderlas es un
      // cambio de calado que merece su propia revisión, no un efecto colateral
      // de montar el linter.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Vite solo puede recargar en caliente un módulo que exporte
      // componentes; `allowConstantExport` deja pasar las constantes de
      // `class-variance-authority` que shadcn exporta junto al componente.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // Las configuraciones de Vite y de Vitest corren en Node, no en el navegador.
  {
    files: ['apps/*/vite.config.ts', 'apps/*/vitest*.config.ts'],
    languageOptions: { globals: globals.node },
  },

  // ───────────────────────── Pruebas ─────────────────────────
  {
    files: ['**/*.spec.{ts,tsx}', '**/test/**/*.{ts,tsx}', '**/pruebas/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Los dobles de prueba se tipan con `any` adrede: reproducir la firma
      // completa de PrismaClient en cada mock no comprueba nada más.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
    },
  },

  prettier,
);
