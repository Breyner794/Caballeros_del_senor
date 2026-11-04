import { PrismaClient } from '@prisma/client';

/**
 * Conexión a la base de datos de pruebas.
 *
 * Nunca la de desarrollo: se deriva un nombre aparte (`…_test`) porque esta
 * suite trunca tablas entre casos. Borrar la agenda de desarrollo a mitad de
 * una demostración es el tipo de accidente que hace que nadie vuelva a correr
 * las pruebas.
 *
 * El orden de precedencia es: `DATABASE_URL_TEST` si está definida (lo que
 * usará CI, apuntando a su propio servicio de Postgres), y si no, la
 * `DATABASE_URL` del `.env` con el nombre de base cambiado.
 */

/** Cambia el nombre de la base en una URL de conexión, conservando el resto. */
export function derivarUrlDePruebas(url: string, sufijo = '_test'): string {
  const parsed = new URL(url);
  const nombre = parsed.pathname.replace(/^\//, '');
  if (!nombre) throw new Error(`La URL de conexión no indica ninguna base de datos: ${url}`);
  if (nombre.endsWith(sufijo)) return url;
  parsed.pathname = `/${nombre}${sufijo}`;
  return parsed.toString();
}

/** URL de la base de pruebas, ya derivada. */
export function urlDePruebas(): string {
  const explicita = process.env['DATABASE_URL_TEST'];
  if (explicita) return explicita;

  const desarrollo = process.env['DATABASE_URL'];
  if (!desarrollo) {
    throw new Error(
      'Falta DATABASE_URL. Copia .env.example a .env en la raíz del monorepo, o define DATABASE_URL_TEST.',
    );
  }
  return derivarUrlDePruebas(desarrollo);
}

/** URL de la base de mantenimiento (`postgres`), para crear la de pruebas. */
export function urlDeMantenimiento(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = '/postgres';
  parsed.search = '';
  return parsed.toString();
}

/** Nombre de la base que contiene la URL. */
export function nombreDeBase(url: string): string {
  return new URL(url).pathname.replace(/^\//, '');
}

let cliente: PrismaClient | null = null;

/**
 * Cliente de Prisma compartido por toda la suite.
 *
 * Uno solo, reutilizado: abrir una conexión por archivo agotaría el pool de
 * Postgres mucho antes de que las pruebas aporten algo.
 */
export function prisma(): PrismaClient {
  cliente ??= new PrismaClient({ datasourceUrl: urlDePruebas(), log: [] });
  return cliente;
}

export async function cerrarConexion(): Promise<void> {
  if (cliente) {
    await cliente.$disconnect();
    cliente = null;
  }
}
