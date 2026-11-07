import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { config as cargarEnv } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { nombreDeBase, urlDeMantenimiento, urlDePruebas } from './conexion.js';

/**
 * `globalSetup` de la suite de integración: deja la base de pruebas lista.
 *
 * Cuatro pasos, en este orden:
 *
 *   1. Comprobar que Postgres responde. Si no, se aborta con la instrucción
 *      exacta (`pnpm db:up`) en lugar de dejar que cada caso muera por timeout
 *      con un error de red ilegible.
 *   2. Crear la base `…_test` si no existe.
 *   3. Aplicar las migraciones, pero solo si falta alguna: la base sobrevive
 *      entre ejecuciones y arrancar el CLI de Prisma en cada corrida costaría
 *      más que las propias pruebas.
 *   4. Nunca `db push`: lo que se quiere verificar son precisamente las
 *      restricciones que viven en el SQL de la migración `reglas_negocio_sql`,
 *      y `db push` las ignora porque solo sabe del `schema.prisma`.
 *
 * La raíz del proyecto llega en el argumento que pasa Vitest, no de
 * `import.meta`: el `tsconfig` de la API compila a CommonJS y `import.meta`
 * ahí no es válido, así que `pnpm typecheck` lo rechazaría.
 */
export async function setup(proyecto?: { config?: { root?: string } }): Promise<void> {
  const raizApi = proyecto?.config?.root ?? process.cwd();

  cargarEnv({ path: path.resolve(raizApi, '../../.env'), quiet: true });

  const url = urlDePruebas();

  await asegurarServidor(url);
  await asegurarBase(url, nombreDeBase(url));

  if (!(await migracionesAlDia(url, raizApi))) {
    aplicarMigraciones(url, raizApi);
  }
}

/** Falla pronto y con instrucciones si no hay Postgres escuchando. */
async function asegurarServidor(url: string): Promise<void> {
  const mantenimiento = new PrismaClient({ datasourceUrl: urlDeMantenimiento(url) });
  try {
    await mantenimiento.$queryRaw`SELECT 1`;
  } catch (error) {
    throw new Error(
      [
        'No se pudo conectar a Postgres para las pruebas de integración.',
        `URL probada: ${urlDeMantenimiento(url).replace(/:[^:@]*@/, ':***@')}`,
        'Levanta la base con:  pnpm db:up',
        '',
        `Detalle: ${primeraLinea(error)}`,
      ].join('\n'),
      { cause: error },
    );
  } finally {
    await mantenimiento.$disconnect();
  }
}

/** Primera línea con contenido del error: Prisma los empieza con saltos. */
function primeraLinea(error: unknown): string {
  const texto = error instanceof Error ? error.message : String(error);
  return (
    texto
      .split(/\r?\n/)
      .map((linea) => linea.trim())
      .find(Boolean) ?? 'sin detalle'
  );
}

async function asegurarBase(url: string, nombre: string): Promise<void> {
  const mantenimiento = new PrismaClient({ datasourceUrl: urlDeMantenimiento(url) });
  try {
    const existe = await mantenimiento.$queryRaw<
      { uno: number }[]
    >`SELECT 1 AS uno FROM pg_database WHERE datname = ${nombre}`;

    if (existe.length === 0) {
      // `CREATE DATABASE` no puede ir dentro de una transacción, y el nombre no
      // admite parámetros: se valida a mano antes de interpolarlo.
      if (!/^[a-zA-Z0-9_]+$/.test(nombre)) {
        throw new Error(`Nombre de base de datos no admitido para pruebas: ${nombre}`);
      }
      await mantenimiento.$executeRawUnsafe(`CREATE DATABASE "${nombre}"`);
    }
  } finally {
    await mantenimiento.$disconnect();
  }
}

/** ¿Están aplicadas todas las migraciones del repositorio? */
async function migracionesAlDia(url: string, raizApi: string): Promise<boolean> {
  const enDisco = readdirSync(path.join(raizApi, 'prisma', 'migrations'), {
    withFileTypes: true,
  }).filter((entrada) => entrada.isDirectory()).length;

  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const aplicadas = await db.$queryRaw<
      { total: bigint }[]
    >`SELECT count(*) AS total FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL`;
    return Number(aplicadas[0]?.total ?? 0) >= enDisco;
  } catch {
    // Sin tabla de migraciones, la base está recién creada.
    return false;
  } finally {
    await db.$disconnect();
  }
}

function aplicarMigraciones(url: string, raizApi: string): void {
  // Se invoca el CLI de Prisma con el propio Node, no con `npx`: en Windows,
  // `execFileSync('npx.cmd', …)` falla con EINVAL desde Node 20 (un .cmd exige
  // shell), y pasar `shell: true` hace que Node concatene los argumentos sin
  // escaparlos y avise de ello (DEP0190). Resolviendo el entry point se evitan
  // las dos cosas y, de paso, el arranque de npx — que era casi un minuto.
  const requerir = createRequire(path.join(raizApi, 'package.json'));
  const cliPrisma = path.join(
    path.dirname(requerir.resolve('prisma/package.json')),
    'build',
    'index.js',
  );

  execFileSync(process.execPath, [cliPrisma, 'migrate', 'deploy'], {
    cwd: raizApi,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
