# Caballeros del Señor — Sistema de reservas

Sistema de reservas y gestión para una barbería con 3 sedes: panel administrativo,
web pública de reservas y API.

## Puesta en marcha

```bash
pnpm install
cp .env.example .env
pnpm db:up
pnpm --filter @cds/shared build
pnpm db:migrate
pnpm db:seed
```

Arrancar todo (API + panel + web pública):

```bash
pnpm dev          # las tres a la vez
pnpm dev:api      # solo la API
pnpm dev:panel    # solo el panel
pnpm dev:booking  # solo la web pública de reservas
```

- Panel administrativo: http://localhost:5173
- Web pública de reservas: http://localhost:5174 (puerto fijo: `BOOKING_ORIGIN` y el CORS de la API lo esperan ahí)
- API: http://localhost:3001/api/v1
- Documentación (solo fuera de producción): http://localhost:3001/api/v1/docs
- Salud: `/api/v1/salud` (proceso vivo) y `/api/v1/salud/listo` (incluye base de datos)

### Usuarios de ejemplo

Todos con la contraseña `Barberia2026!`, y el panel obliga a cambiarla en el
primer acceso.

| Correo                           | Rol                                    |
| -------------------------------- | -------------------------------------- |
| admin@caballerosdelsenor.com     | Administrador                          |
| recepcion@caballerosdelsenor.com | Recepcionista                          |
| andres@caballerosdelsenor.com    | Barbero (Centro)                       |
| camilo@caballerosdelsenor.com    | Barbero (Norte, slot propio de 20 min) |
| jeison@caballerosdelsenor.com    | Barbero (Sur)                          |
| contador@caballerosdelsenor.com  | Contador                               |

## Verificación

Cuatro comandos, en este orden. Son los mismos que corre CI
(`.github/workflows/ci.yml`) en cada push y cada pull request:

```bash
pnpm -r typecheck     # tipos de api, panel, booking y shared
pnpm lint             # ESLint 10, configuración plana única en eslint.config.mjs
pnpm -r test          # 477 pruebas de la API + 131 de la web pública
pnpm --filter @cds/api test:integracion   # 68 contra Postgres de verdad
```

El `typecheck` de la API resuelve los tipos de `@cds/shared` en su `dist`, así
que si vienes de un clon limpio hace falta `pnpm --filter @cds/shared build`
antes (o `pnpm dev`, que ya lo construye).

Las de integración necesitan Postgres levantado (`pnpm db:up`) y la
`DATABASE_URL` del `.env`: la suite deriva de ella un nombre con sufijo
`_test`, crea esa base si falta y le aplica las migraciones. Nunca toca la de
desarrollo. Para apuntar a otro servidor, `DATABASE_URL_TEST` tiene
preferencia.

`pnpm lint` revisa el monorepo completo de una pasada; para una parte,
`pnpm --filter @cds/panel lint` o `pnpm exec eslint apps/api/src`. `pnpm
lint:fix` aplica lo autocorregible.

## Estructura

```
apps/
  api/        NestJS + Prisma + PostgreSQL
  panel/      Panel administrativo (React + Vite + shadcn), puerto 5173
  booking/    Web pública de reservas del cliente final (React + Vite), puerto 5174
packages/
  shared/     Tipos, esquemas Zod y reglas de dominio compartidas
infra/
  postgres/   Extensiones de base de datos para desarrollo
```

El paquete `@cds/shared` es el centro de gravedad: el mismo esquema de Zod que
valida un formulario en el navegador valida la petición en la API y normaliza
los datos (un teléfono entra como «300 123 4567» y se guarda como
`+573001234567`). No hay dos listas de reglas que se puedan desincronizar.

Se compila a `dist`, así que al cambiar algo en `packages/shared` hay que
recompilarlo (`pnpm --filter @cds/shared dev` lo deja en modo vigilancia).

## Decisiones que conviene conocer antes de tocar el código

**Las horas de las plantillas semanales se guardan como minutos desde
medianoche.** «El martes trabajo de 8 a 20» no depende de ninguna fecha, así
que guardar un `Date` obligaría a inventar un día y arrastrar la zona horaria
a sitios donde no aporta nada. Los instantes reales (`Reserva.inicioEn`) sí son
fechas, en UTC, y la conversión a hora local ocurre solo al presentar.

**La base de datos impone las reglas que no pueden fallar.** Una restricción de
exclusión hace físicamente imposible que dos reservas del mismo barbero se
solapen, incluso si dos recepcionistas guardan en el mismo milisegundo. La
validación en la API es la que da el mensaje bonito; la del motor es la que
garantiza que no ocurra. Lo mismo con el stock negativo, los bloques de agenda
cruzados y los porcentajes de comisión con vigencias solapadas.

**Las tablas transaccionales guardan snapshots.** `ReservaServicio` copia el
nombre, el precio y la duración del servicio al reservar. Si mañana sube el
precio del corte, los cierres del contador del mes pasado no cambian.

**El inventario y la caja son libros de solo inserción.** Un movimiento de
inventario no se edita nunca: para corregir se registra un ajuste. Es lo que
permite que el contador audite.

**Todo listado va paginado.** No hay ningún `findMany` sin límite; el tope por
página es 100 (1000 en las exportaciones del contador).

### Registro de visitas y fidelidad

El programa de sellos (7 visitas → la 8ª gratis, configurable) se deriva de la
tabla `SelloFidelidad`, con un sello por reserva completada. No es un contador
que se incrementa, y eso es deliberado: cuando un cliente dice que vino ocho
veces y el sistema tiene seis, la auditoría muestra qué barbero registró qué y
cuándo. Si el barbero no registra la visita, el sistema no puede inventarla —
pero sí deja constancia de quién atendió sin crear ficha.

## Seguridad

- Contraseñas con **Argon2id** (19 MiB, 2 iteraciones, el perfil que recomienda OWASP).
- **Access token de 15 min** en el cuerpo de la respuesta (el frontend lo guarda
  en memoria) y **refresh token de 7 días** en cookie `httpOnly` + `SameSite=Strict`.
  Un XSS no puede leer el refresh token.
- **Rotación con detección de reutilización**: el refresh token sirve una sola
  vez. Si llega uno ya usado, se revoca toda la familia de sesiones — el
  atacante y el usuario legítimo quedan fuera, y el usuario vuelve a entrar.
- El guard de autenticación **relee el usuario en cada petición**: desactivar a
  un empleado le corta el acceso al instante, sin esperar a que caduque su token.
- Bloqueo de cuenta 15 min tras 5 intentos fallidos, más límite por IP en
  `login` (5/min) y recuperación de contraseña (3 cada 5 min).
- El formulario de recuperación responde lo mismo exista o no el correo, y el
  login iguala el tiempo de respuesta, para que no se puedan enumerar cuentas.
- Las rutas son privadas por defecto: hay que marcar explícitamente `@Publico()`.
  Olvidarse de proteger una ruta nueva no es posible por descuido.
- Ni contraseñas, ni tokens, ni códigos llegan nunca a la auditoría ni al
  registro de errores: se filtran antes de escribir.

## Base de datos

```bash
pnpm db:up          # levanta PostgreSQL 17 y Redis
pnpm db:migrate     # aplica migraciones (desarrollo)
pnpm db:seed        # datos iniciales (idempotente)
pnpm db:studio      # explorador visual de datos
```

Los puertos son 5433 (PostgreSQL) y 6380 (Redis) para no chocar con
instalaciones locales en los puertos estándar.

## Despliegue

Imagen de la API, construida desde la raíz del monorepo:

```bash
docker build -f apps/api/Dockerfile -t cds-api .
```

La imagen aplica las migraciones pendientes al arrancar (`prisma migrate
deploy`, que nunca borra datos) y corre como usuario sin privilegios. En
producción la API **no arranca** si falta un secreto o si sigue el valor de
ejemplo: es preferible que el contenedor no levante a descubrirlo semanas
después.

Genera los secretos así:

```bash
openssl rand -base64 48
```

### En orden, lo que hay que hacer en cada despliegue

**1. Variables de entorno.** Además de las que ya pide `.env.example`
(`DATABASE_URL`, `REDIS_URL`, los dos secretos JWT, `ENCRYPTION_KEY`,
`BREVO_*`), la web pública de reservas necesita estas cuatro:

| Variable                  | Dónde              | Si falta                                                                                                                                                                                                                 |
| ------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TURNSTILE_SECRET_KEY`    | API                | En producción la API **no arranca** (y así debe ser: sin ella el canal público quedaría sin captcha). Fuera de producción el canal levanta sin captcha y lo avisa una vez, con nivel `error`, al arrancar.               |
| `BOOKING_ORIGIN`          | API                | El CORS rechaza al navegador del cliente y el enlace de gestión del correo se construye contra `http://localhost:5174`. Es el origen público de la web (`https://reservas.tudominio.com`).                               |
| `VITE_API_URL`            | Web (en **build**) | Cae al valor de desarrollo (`http://localhost:3001/api/v1`) y la web no carga nada. Es una variable de compilación: cambiarla exige reconstruir, no reiniciar. **Dejarla creada pero vacía cuenta como no configurada.** |
| `VITE_TURNSTILE_SITE_KEY` | Web (en **build**) | El widget del captcha no se pinta y ninguna reserva se puede enviar, porque la API exige el token.                                                                                                                       |

**2. Migraciones y siembra.**

```bash
pnpm db:migrate     # desarrollo (prisma migrate dev)
pnpm --filter @cds/api prisma:deploy  # producción fuera del contenedor
                                      # (la imagen ya las aplica al arrancar)
pnpm db:seed        # idempotente: usa `upsert` y NO reactiva lo que el dueño desactivó
```

La siembra es obligatoria, no opcional: **las plantillas de notificación solo
las crea el seed**. Sin ellas, la cita se guarda bien y el correo no sale —
`NotificacionesService` deja la fila `FALLIDA`, hoy nadie reintenta esas filas,
y el cliente se queda sin el enlace de gestión, que es la única llave de su
cita. El único rastro es una línea `error` en el log de la API.

> **Cuidado con `prisma migrate dev` sobre una base con datos.** `migrate diff`
> no conoce `clientes_telefono_trgm_idx`: ese índice lo crea con SQL en crudo la
> migración `20261011190000_reglas_negocio_sql` y `schema.prisma` no lo declara,
> así que Prisma propone **eliminarlo** en cada diff. Quien acepte el diff
> propuesto borra el índice y la búsqueda de clientes por teléfono en el panel
> se degrada en silencio: sigue funcionando, cada vez más lenta. En producción
> se usa `prisma migrate deploy`, que no propone diffs.

**3. El _fallback_ de SPA del host estático.** `/cita#<token>` es una ruta de
cliente, no un archivo: el servidor tiene que reescribir cualquier ruta
desconocida a `index.html`. **En un host estático sin esa reescritura, abrir el
enlace de la cita devuelve 404** — y ese enlace es la única llave de la cita y
lo que va en el correo del cliente. En desarrollo funciona porque lo resuelve
Vite, así que el fallo aparecería solo en producción y solo para quien abra su
correo: es la trampa menos evidente de toda la entrega. En Nginx es
`try_files $uri /index.html;`; en Netlify, Vercel, Cloudflare Pages o S3 +
CloudFront, la regla equivalente de «SPA fallback».

El token viaja en el **fragmento**, que el navegador no manda al servidor: la
reescritura no lo ve ni lo registra, y eso sigue siendo cierto con el fallback
puesto.
