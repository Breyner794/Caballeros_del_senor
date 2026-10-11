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

Arrancar la API:

```bash
pnpm --filter @cds/api dev
```

- API: http://localhost:3001/api/v1
- Documentación (solo fuera de producción): http://localhost:3001/api/v1/docs
- Salud: `/api/v1/salud` (proceso vivo) y `/api/v1/salud/listo` (incluye base de datos)

### Usuarios de ejemplo

Todos con la contraseña `Barberia2026!`, y el panel obliga a cambiarla en el
primer acceso.

| Correo | Rol |
| --- | --- |
| admin@caballerosdelsenor.com | Administrador |
| recepcion@caballerosdelsenor.com | Recepcionista |
| andres@caballerosdelsenor.com | Barbero (Centro) |
| camilo@caballerosdelsenor.com | Barbero (Norte, slot propio de 20 min) |
| jeison@caballerosdelsenor.com | Barbero (Sur) |
| contador@caballerosdelsenor.com | Contador |

## Estructura

```
apps/
  api/        NestJS + Prisma + PostgreSQL
  panel/      Panel administrativo (React + Vite + shadcn)
  booking/    Web pública del cliente
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
