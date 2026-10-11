# =============================================================================
#  API — imagen de producción
#
#  Multi-stage: las dependencias de compilación (CLI de Nest, TypeScript,
#  toolchain de argon2) se quedan en las etapas intermedias y la imagen final
#  solo lleva el JavaScript compilado y las dependencias de ejecución.
#
#  Construir desde la RAÍZ del monorepo, no desde esta carpeta:
#    docker build -f apps/api/Dockerfile -t cds-api .
# =============================================================================

FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache libc6-compat openssl
WORKDIR /app

# --------------------------------------------------------------- dependencias
FROM base AS deps
# argon2 se compila de forma nativa: hacen falta las herramientas de build.
RUN apk add --no-cache python3 make g++
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

# ------------------------------------------------------------------ compilado
FROM deps AS build
COPY . .
# El paquete compartido primero: la API depende de su salida compilada.
RUN pnpm --filter @cds/shared build \
  && pnpm --filter @cds/api exec prisma generate \
  && pnpm --filter @cds/api exec nest build

# Se poda a dependencias de producción para no arrastrar TypeScript ni la CLI.
RUN pnpm --filter @cds/api --prod deploy /salida \
  && cp -r apps/api/dist /salida/dist \
  && cp -r apps/api/prisma /salida/prisma \
  && cp apps/api/prisma.config.ts /salida/prisma.config.ts

# -------------------------------------------------------------------- runtime
FROM base AS runtime
ENV NODE_ENV=production
ENV TZ=America/Bogota

# Usuario sin privilegios: si alguien escapa del proceso, no es root.
RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs api

COPY --from=build --chown=api:nodejs /salida /app

USER api
EXPOSE 3001

# Dokploy y el balanceador consultan esta ruta antes de enviar tráfico.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/v1/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Las migraciones se aplican al arrancar: un despliegue nuevo queda listo sin
# pasos manuales. `migrate deploy` solo aplica lo pendiente y nunca borra datos.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/main.js"]
