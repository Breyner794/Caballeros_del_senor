import path from 'node:path';
import { config as cargarEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Única fuente de verdad para las variables de entorno: el .env de la raíz del
// monorepo. Así docker-compose, la API y la CLI de Prisma leen lo mismo.
cargarEnv({ path: path.resolve(__dirname, '../../.env'), quiet: true });

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
});
