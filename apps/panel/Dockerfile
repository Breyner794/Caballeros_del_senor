# =============================================================================
#  Panel de gestión — imagen de producción
#
#  Multi-stage: Node solo existe para compilar. La imagen final es nginx con el
#  `dist` estático dentro, sin Node ni node_modules.
#
#  Construir desde la RAÍZ del monorepo, no desde esta carpeta:
#    docker build -f apps/panel/Dockerfile \
#      --build-arg VITE_API_URL=https://api.midominio.com/api/v1 \
#      -t cds-panel .
# =============================================================================

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# --------------------------------------------------------------- dependencias
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/panel/package.json ./apps/panel/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

# ------------------------------------------------------------------ compilado
FROM deps AS build

# Las VITE_* se resuelven AL COMPILAR: Vite las sustituye por su valor literal
# dentro del JavaScript. No sirve de nada inyectarlas en el contenedor final,
# porque allí solo hay nginx sirviendo archivos ya escritos.
#
# `ARG` por sí solo no basta: Vite lee `process.env`, y un ARG no está en el
# entorno del proceso que ejecuta RUN. De ahí el paso a `ENV`. Si se omite,
# el build no falla: produce un bundle apuntando a localhost.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

COPY . .
# El paquete compartido primero: el panel importa su salida compilada.
RUN pnpm --filter @cds/shared build \
  && pnpm --filter @cds/panel build

# -------------------------------------------------------------------- runtime
# Imagen no-root del equipo de nginx: corre como uid 101 y escucha en 8080.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
ENV TZ=America/Bogota

COPY --chown=nginx:nginx infra/nginx/spa.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=nginx:nginx /app/apps/panel/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/_salud || exit 1
