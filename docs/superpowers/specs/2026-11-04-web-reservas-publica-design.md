# Web pública de reservas — diseño

Fecha: 2026-11-04
Estado: aprobado en conversación, pendiente de plan de implementación

## El problema

La barbería pierde citas porque alguien tiene que contestar el teléfono. Hoy el
sistema es un panel interno: solo un empleado autenticado puede crear una
reserva. El cliente no tiene ninguna puerta.

Esta entrega abre esa puerta: un cliente reserva desde su móvil, sin cuenta y
sin hablar con nadie, y después puede ver, cancelar o reprogramar su cita.

**Éxito:** las citas entran solas, sin huecos fantasma en la agenda y sin
trabajo nuevo para recepción.

## Lo que ya existe y no hay que escribir

Este es el hallazgo que define el tamaño del trabajo. El dominio fue escrito
contemplando al cliente web desde el principio, y ese camino nunca se ha
ejecutado:

| Pieza | Estado |
| --- | --- |
| `ReservasService.crear(datos, actor, desdeWeb)` | Pone `canal: 'WEB'`, `creadoPorId: null` y decide el estado con `config.requiereConfirmacion`. |
| `DisponibilidadService.validarHueco({ aplicarReglasCliente })` | Aplica antelación mínima y anticipación máxima solo al cliente. |
| `ReservasService.verificarLimiteReservas(clienteId, desdeWeb)` | Tope de citas activas por cliente. |
| `ReservasService.cancelar(..., origen: 'CLIENTE')` | Valida `horasLimiteCancelacion`. |
| `ReservasService.reprogramar(..., desdeCliente)` | Valida `horasLimiteReprogramacion`. |
| `ReservasService.resolverCliente` | Reutiliza la ficha si el teléfono ya existe: exactamente lo que necesita una web sin cuentas. |
| `DisponibilidadService.delDia` sin `barberoId` | Devuelve los huecos de todos los barberos de la sede. |
| `ConfiguracionGlobal` | `minAntelacionMinutos`, `maxDiasAnticipacion`, `horasLimiteCancelacion`, `horasLimiteReprogramacion`, `permiteElegirBarbero`, `requiereConfirmacion`, `maxReservasActivasCliente`. |
| `Reserva` | `tokenGestion` (único), `canceladaPor`, `reprogramadaDeId`, `canal: WEB`. |
| `Servicio.visibleWeb`, `Usuario.visibleWeb` + `alias`/`bio`/`fotoUrl`, `DiaEspecial.visibleWeb` | Marcas de visibilidad pública. |
| `CODIGOS_ERROR` + `MENSAJES_ERROR` | Mensajes ya redactados para el cliente final: «Ese horario acaba de ocuparse. Elige otro hueco disponible», «Ya pasó el plazo para cancelar. Llama a la barbería». |
| `AuditoriaService` | Acepta `actor: null` y ya filtra `tokenGestion` en `CAMPOS_SENSIBLES`. |
| `entorno.ts` | `BOOKING_ORIGIN` con defecto `http://localhost:5174`. |
| `main.ts` | CORS ya incluye `BOOKING_ORIGIN`; `referrerPolicy: no-referrer` ya activo. |
| `Notificacion` / `PlantillaNotificacion` / `CanalNotificacion` | Modelados y sin usar. Documentan la convención: `clave: 'reserva.confirmada'`, placeholders `{{cliente}}`, `plantillaMeta` y `plantillaBrevo` separados. |

**Las reglas de negocio están escritas y probadas. Falta la puerta y la cara.**
El trabajo es fachada HTTP y frontend, no dominio. Ninguna regla de reserva se
reimplementa en esta entrega.

## Decisiones tomadas

1. **Sin cuenta de cliente.** Nombre y teléfono. La cita se gestiona con el
   `tokenGestion` que ya genera `reservas.service.ts`.
2. **Confirmación en pantalla, correo opcional.** El cliente sale con su código
   y su enlace a la vista. Si da un correo, se le envía por Brevo, que ya está
   integrado. El correo es una comodidad, no el recibo.
3. **WhatsApp no se implementa, pero se deja la costura.** Está planificado
   para después.
4. **Alcance: solo el flujo.** Reservar, ver, cancelar, reprogramar. Sin portada
   informativa ni catálogo público de precios: eso es una entrega futura.
5. **Cloudflare Turnstile** en el formulario, además de límites por IP y del
   tope de citas activas por teléfono.
6. **App Vite nueva en `apps/booking`**, mismo stack que el panel (React 19 +
   Vite + shadcn + `@cds/shared`). No se añaden rutas públicas al panel: eso
   mezclaría dos niveles de confianza en un mismo bundle y obligaría a que el
   guard de sesión conviviera con rutas anónimas, justo el condicional que el
   repositorio evita a propósito.
7. **Módulo `publico` nuevo en la API**, no `@Publico()` sobre los controladores
   del panel. Dos razones: la respuesta pública se construye a mano, así que un
   campo nuevo en el panel no se filtra por herencia; y la autenticación por
   token vive en su propio guard sin tocar `GuardAutenticacion`.

## Arquitectura

```
apps/booking (Vite + React 19 + shadcn)
        │  fetch sin cookies de sesión; token de gestión en cabecera
        ▼
/api/v1/publico/*   ← PublicoModule: @Publico() + GuardTurnstile + GuardTokenGestion
        │  orquesta, no reimplementa
        ▼
DisponibilidadService · ReservasService · ConfiguracionService · NotificacionesService
        ▼
PostgreSQL — la restricción de exclusión es la última palabra
```

`PublicoModule` no contiene lógica de negocio. Valida la entrada con los
esquemas de `@cds/shared`, llama a los servicios existentes con `desdeWeb: true`
u `origen: 'CLIENTE'`, y traduce el resultado a un DTO público escrito a mano.

### Por qué la traducción es manual

`delDia` devuelve, por cada hueco ocupado, el motivo: `OCUPADO`, `ALMUERZO`,
`DESCANSO`. Eso es la agenda personal de un empleado y no es asunto del público.
La fachada colapsa esos tres a «no disponible» y conserva solo `ANTELACION` y
`NO_CABE`, que sí le explican al cliente por qué no puede elegir esa hora.

Lo mismo con la reserva: el panel ve `notaInterna`, `bufferMinutos`,
`creadoPorId` y la ficha completa del cliente. El público ve su código, su hora,
sus servicios y el nombre de su barbero.

## La fachada pública

Base: `/api/v1/publico`. Todas las rutas llevan el decorador `@Publico()` que ya
existe, de modo que el principio «las rutas son privadas por defecto» se respeta
explícitamente y no por omisión.

### `GET /publico/opciones`

Lo que el asistente necesita para que el cliente elija, en una sola llamada
cacheable:

- Sedes con `activa: true` y `eliminadoEn: null`: `id`, `nombre`, `direccion`,
  `ciudad`, `telefono`, `mapsUrl`.
- Servicios con `activo` y `visibleWeb`: `id`, `nombre`, `descripcion`,
  `incluye`, `precio`, `duracionMinutos`. **Nunca `bufferMinutos`**: es tiempo
  interno de limpieza y el cliente no lo ve (el modelo lo dice explícitamente).
- Barberos con `activo`, `visibleWeb` y rol `BARBERO`, agrupados por sede:
  `id`, `alias` o `nombre`, `bio`, `fotoUrl`. Sin correo, sin teléfono, sin rol.
- La configuración que el frontend necesita para comportarse igual que la API:
  `permiteElegirBarbero`, `maxDiasAnticipacion`, `minAntelacionMinutos`,
  `zonaHoraria`, `moneda`, `nombreNegocio`.

Se llama `opciones` y no `catalogo` a propósito: no es el catálogo público de la
barbería (esa es otra entrega), son las opciones del asistente.

### `GET /publico/calendario?sedeId&desde&hasta&servicioIds[]`

Qué días tienen al menos un hueco para la duración elegida, para que el selector
de fecha solo deje pulsar días reservables. Reusa `DisponibilidadService.calendario`
y reduce cada día a `{ fecha, hayHueco: boolean }`. El rango se limita a
`maxDiasAnticipacion` y el servicio ya tope a 92 días.

### `GET /publico/disponibilidad?sedeId&fecha&servicioIds[]&barberoId?`

Huecos de un día. Reusa `delDia` con `aplicarReglasCliente`.

- Con `barberoId`: los huecos de ese barbero.
- Sin `barberoId`: la **unión** de huecos libres de la sede, sin revelar de
  quién es cada uno. Un hueco está en la unión si algún barbero visible lo
  tiene libre.

### `POST /publico/reservas`

Crea la cita. Protegida por `GuardTurnstile` y por `@Throttle`.

Cuerpo: `sedeId`, `servicioIds`, `inicioEn`, `barberoId` *(opcional)*,
`clienteNuevo { nombreCompleto, telefono, email? }`, `notaCliente` *(opcional)*,
`tokenTurnstile`.

El canal público **nunca acepta `clienteId`**: un identificador de ficha que
viaja desde internet permitiría reservar a nombre de otro, o sondear qué
identificadores existen. La identidad del cliente es su teléfono, y
`resolverCliente` ya reutiliza la ficha correcta a partir de él. Tampoco acepta
`descuento`, `notaInterna`, `confirmar` ni `aplicarPremioFidelidad`: el esquema
público se escribe desde cero en `@cds/shared`, no se deriva de
`crearReservaSchema` quitando campos, porque un campo nuevo en el esquema del
panel entraría solo en el público.

Llama a `ReservasService.crear(datos, null, true)`: no hay actor, porque no hay
empleado. Ver «El actor nulo» más abajo.

Respuesta: `codigo`, `inicioEn`, `finEn`, `estado`, sede, barbero (alias),
servicios con nombre y precio, `total`, y el `tokenGestion` **una sola vez**,
para que el frontend construya el enlace.

**Asignación automática de barbero.** Si `barberoId` viene ausente, la API elige
en el momento de crear, no antes: entre los barberos visibles de la sede con ese
hueco libre, el que menos minutos tenga ocupados ese día, y a igualdad el de
`orden` menor para que la elección sea determinista y testeable. Se decide en el
servidor y no en el navegador porque un `barberoId` elegido tres minutos antes
puede estar ya ocupado. Si todos se ocupan entre la consulta y el envío, el
error es `RESERVA_SOLAPADA`, y la restricción de exclusión de PostgreSQL sigue
siendo la red final.

### `GET /publico/mi-reserva`

La cita del cliente, autenticada por `GuardTokenGestion`. Devuelve el mismo DTO
público, más qué puede hacer todavía: `puedeCancelar` y `puedeReprogramar`,
calculados con `horasLimiteCancelacion` y `horasLimiteReprogramacion`. El
frontend desactiva los botones en vez de ofrecer una acción que la API
rechazará.

### `POST /publico/mi-reserva/cancelar`

`ReservasService.cancelar(id, datos, null, 'CLIENTE')`. Al cancelar, el
`tokenGestion` se pone a `null`: el enlace deja de servir.

### `POST /publico/mi-reserva/reprogramar`

`ReservasService.reprogramar(id, datos, null, true)`. **El token se rota** y el
nuevo se devuelve en la respuesta: el enlace viejo, que pudo quedar en un correo
o en un historial de WhatsApp, deja de valer.

## El actor nulo

`crear` y `reprogramar` declaran hoy `actor: UsuarioAutenticado` no nulo, pero
no lo necesitan cuando la reserva viene de la web: `creadoPorId` ya se pone a
`null` con `desdeWeb`, `AuditoriaService` ya declara `actor?: UsuarioAutenticado | null`,
y `ClientesService.crear` ya declara `actor?: UsuarioAutenticado | null`.

El cambio es relajar la firma de `crear`, `reprogramar` y `resolverCliente` a
`UsuarioAutenticado | null`. No hace falta inventar un actor sintético, y
conviene no inventarlo: una fila de auditoría con un usuario falso es peor que
una con usuario vacío, porque miente. Con `actor: null`, `usuarioId`,
`usuarioNombre` y `usuarioRol` quedan nulos y el `canal: WEB` de la reserva es
lo que explica quién la creó.

### Deuda a corregir en el camino

`reservas.service.ts:770` construye el cliente nuevo así:

```ts
} as never,
```

…con un campo fantasma `incluye: undefined` dentro del objeto. `crearClienteSchema`
no tiene ningún campo `incluye`, y el resto del objeto encaja con `CrearClienteDto`
sin necesidad de casteo: es un resto de copiar y pegar que desactiva el chequeo
de tipos exactamente en la ruta por la que esta entrega va a hacer pasar el
correo del cliente. Se elimina el `as never` y el campo fantasma antes de tocar
nada más ahí. No es refactor gratuito: es la línea que hay que modificar.

## Autenticación por token de gestión

El enlace es `https://<booking>/cita#<token>`: **el token viaja en el fragmento
de la URL**, no en la ruta ni en la query. Un fragmento no se envía nunca al
servidor, así que no aparece en los logs de acceso, ni en el proxy, ni en la
cabecera `Referer` si el cliente pulsa un enlace externo desde esa página.

El frontend lo lee de `location.hash` y lo manda en la cabecera
`X-Token-Gestion`. `GuardTokenGestion` lo resuelve contra `Reserva.tokenGestion`
—único, 48 caracteres alfanuméricos de `nanoid`— y deja la reserva resuelta en la
petición para el controlador.

Si no existe o ya fue invalidado: `TOKEN_INVALIDO`, cuyo mensaje ya está escrito
(«El enlace o el token no es válido»). La comparación debe ser una consulta
indexada por el campo único, y el token nunca se escribe en un log ni en la
auditoría: `CAMPOS_SENSIBLES` ya lo filtra.

**Cambio necesario en `main.ts`:** `allowedHeaders` del CORS debe incluir
`x-token-gestion`. Hoy el navegador rechazaría la petición en el preflight.

## Turnstile

`GuardTurnstile` verifica el token contra el `siteverify` de Cloudflare antes de
dejar pasar un `POST`. Solo en los `POST`: poner captcha en las consultas de
disponibilidad rompería la navegación del calendario.

Sigue la convención que ya usa `CorreoService`: **si falta
`TURNSTILE_SECRET_KEY`, el guard deja pasar y escribe un aviso en el log**, para
poder desarrollar y correr las pruebas sin credenciales. Y como con los secretos
de JWT, `entorno.ts` hace que en **producción la API no arranque** sin esa clave.

Variables nuevas:

- API: `TURNSTILE_SECRET_KEY` (obligatoria en producción, opcional fuera).
- Booking: `VITE_TURNSTILE_SITE_KEY`, `VITE_API_URL`.

Además, `@Throttle` estricto en `POST /publico/reservas`: 5 por hora y por IP.
Turnstile para los bots; el límite por IP para el humano insistente. El tope de
citas activas por teléfono (`maxReservasActivasCliente`) ya lo aplica el
dominio.

## El flujo del cliente

Una sola ruta con pasos, y el paso en la query (`?paso=hora`), para que el botón
atrás de Android retroceda un paso en vez de salir de la web. Diseño móvil
primero, con los componentes shadcn que ya usa el panel.

1. **Servicio** — tarjetas con precio y duración; la suma de precio y duración
   visible al pie. Si hay más de una sede activa, la sede se elige aquí.
2. **Fecha** — calendario que solo habilita días con hueco real para la duración
   elegida.
3. **Hora** — huecos en rejilla. «Cualquier barbero» por defecto; un desplegable
   permite elegir uno si `permiteElegirBarbero` está activo.
4. **Datos** — nombre, teléfono, correo *(opcional)*, nota. Turnstile invisible.
5. **Listo** — código `CDS-7F3K2M` grande, enlace de gestión con botón de
   copiar, y botón de añadir al calendario que genera un `.ics` en el navegador
   (sin endpoint nuevo).

`/cita` es la pantalla de gestión: ver la cita, cancelar y reprogramar.
Reprogramar reutiliza los pasos 2 y 3.

### Validación compartida

Los mismos esquemas Zod de `@cds/shared` validan el formulario y la petición. El
teléfono entra como «300 123 4567» y lo normaliza a `+573001234567` el mismo
`telefonoSchema` en ambos lados. No hay dos listas de reglas que puedan
desincronizarse. Los esquemas nuevos del canal público viven también en
`@cds/shared`, junto a los existentes.

### Estado del asistente

Un `useReducer` a nivel de ruta, con el paso espejado en la query. TanStack
Query para las consultas al servidor, con la misma configuración que el panel
(`retry: 1`: un error de negocio no mejora al reintentarlo).

## Notificación de confirmación, y la costura de WhatsApp

Se añade `NotificacionesService.encolar({ reservaId, clienteId, clave, canal, destino, variables })`:

1. Escribe una fila en `Notificacion` con `estado: PENDIENTE`.
2. Resuelve la `PlantillaNotificacion` por `clave` y `canal`.
3. Despacha con el adaptador del canal y marca `ENVIADA` con su `idExterno`, o
   `FALLIDA` con el `error` y `intentos + 1`.

**Hoy solo existe el adaptador `EMAIL`**, encima del `CorreoService` que ya habla
con Brevo. El adaptador se elige por el enum `CanalNotificacion`; cuando llegue
WhatsApp será un adaptador nuevo más una fila en `PlantillaNotificacion` con su
`plantillaMeta`. Las variables de entorno `WHATSAPP_*` ya están declaradas en
`entorno.ts`. **Ni una línea de `ReservasService` cambia cuando eso ocurra.**

La plantilla `reserva.confirmada` (canal `EMAIL`) se añade al seed, que es
idempotente.

El envío **nunca bloquea la reserva**: se encola después de que la transacción
confirme, y un fallo de Brevo deja la notificación en `FALLIDA` sin afectar a la
cita. El cliente ya tiene su código en pantalla.

### Por dónde entra el correo

`clienteNuevoEnReservaSchema` (en `@cds/shared`) hoy lleva solo
`nombreCompleto`, `telefono` y `notas`. Se le añade `email` opcional, y
`resolverCliente` lo pasa a la ficha con `aceptaEmail: Boolean(email)`.

Esto encaja con lo que el modelo ya anticipaba: `Cliente.email` existe y su
comentario dice «preparados para el futuro: opcionales y ocultos en el
formulario actual». El campo estaba esperando precisamente a este canal. Añadirlo
al esquema compartido no cambia el formulario del panel, donde sigue siendo
opcional y oculto.

El correo solo se intenta si el cliente dio una dirección. Si no la dio, no se
encola nada: no hay notificación `FALLIDA` por un correo que nunca existió.

## Errores

El frontend ramifica por `codigo`, nunca por status HTTP. Todos los códigos que
el flujo necesita ya existen con su mensaje redactado:
`ANTELACION_INSUFICIENTE`, `FECHA_DEMASIADO_LEJANA`, `RESERVA_EN_EL_PASADO`,
`LIMITE_RESERVAS_ACTIVAS`, `RESERVA_SOLAPADA`, `DIA_NO_LABORABLE`,
`SEDE_CERRADA`, `FUERA_DE_PLAZO_CANCELACION`, `FUERA_DE_PLAZO_REPROGRAMACION`,
`TOKEN_INVALIDO`.

**El caso que hay que cuidar es `RESERVA_SOLAPADA`**: dos clientes pulsando el
mismo hueco a la vez. El segundo no debe quedarse con un error y un formulario
vacío. La fachada adjunta en el campo `detalle` de `RespuestaError` —que existe
justo para esto— los huecos libres recalculados de ese día, y el frontend
muestra «Ese horario acaba de ocuparse» con la rejilla ya actualizada debajo.

Si el captcha falla: `VALIDACION` con el campo señalado, para que el frontend
pueda reiniciar el widget de Turnstile.

## Pruebas

Primero la prueba, después el código.

**La más valiosa: que la fachada no filtre.** Un test que afirma el conjunto
**exacto** de claves de cada respuesta pública. Si alguien añade `notaInterna` o
`bufferMinutos` al select de un servicio del panel, ese test se pone rojo. Es la
única defensa automática contra una fuga por descuido, y por eso se escribe
primero.

- **Colapso de motivos**: ningún `ALMUERZO` ni `DESCANSO` sale por `/publico`.
- **`GuardTokenGestion`**: token inexistente, token de una cita ya cancelada,
  token viejo tras reprogramar (debe fallar), token nuevo tras reprogramar
  (debe funcionar).
- **`GuardTurnstile`**: con secreto y respuesta de rechazo; sin secreto,
  pasa y avisa.
- **Asignación automática de barbero**: elige al menos cargado; a igualdad, el
  de `orden` menor; si ninguno está libre, `RESERVA_SOLAPADA`.
- **Unión de huecos**: un hueco libre en un solo barbero aparece; ocupado en
  todos, no.
- **Integración contra PostgreSQL real**, siguiendo el patrón de
  `apps/api/test/integracion/`: antelación mínima, anticipación máxima, tope de
  citas activas por teléfono, plazos de cancelación y reprogramación, e
  invalidación del token al cancelar.
- **Frontend**: vitest + Testing Library sobre el reductor del asistente.
  `apps/booking` estrena el script `test`; el panel hoy no tiene ninguno.

### Fuera de las pruebas de esta entrega

Playwright de punta a punta: monta más de lo que aporta ahora. Queda anotado
como seguimiento junto a la ausencia de CI, que es el hueco que de verdad
duele (nada ejecuta hoy lint, typecheck ni pruebas al hacer push).

## Archivos

**Nuevos en la API** (`apps/api/src/modulos/publico/`):
`publico.module.ts`, `publico.controller.ts`, `publico.service.ts`,
`dto-publico.ts` (los mapeadores manuales), `guard-token-gestion.ts`,
`guard-turnstile.ts`, más sus `.spec.ts`.

**Nuevos en notificaciones** (`apps/api/src/modulos/notificaciones/`):
`notificaciones.service.ts`, `adaptador-email.ts`.

**Modificados en la API:**

- `app.module.ts` — registrar `PublicoModule`.
- `main.ts` — `x-token-gestion` en `allowedHeaders` del CORS.
- `entorno.ts` — `TURNSTILE_SECRET_KEY`, obligatoria en producción.
- `prisma/seed.ts` — plantilla `reserva.confirmada` (el seed es idempotente).
- `reservas.service.ts` — cuatro cambios acotados: firmas a
  `UsuarioAutenticado | null`, rotar el `tokenGestion` al reprogramar e
  invalidarlo al cancelar, pasar el `email` a la ficha, y quitar el `as never`
  con su campo fantasma.
- `notificaciones.module.ts` — exportar el servicio nuevo.

**Nuevos y modificados en shared:**

- `packages/shared/src/validaciones/publico.ts` *(nuevo)* — esquemas de entrada
  del canal público y tipos de las respuestas públicas.
- `packages/shared/src/validaciones/reservas.ts` — `email` opcional en
  `clienteNuevoEnReservaSchema`.

Recordatorio operativo: `@cds/shared` compila a `dist`, así que al tocarlo hay
que recompilarlo (`pnpm --filter @cds/shared build`) o tenerlo en modo
vigilancia, o la API y el booking seguirán leyendo la versión vieja.

**Nuevos en booking** (`apps/booking/`): andamiaje Vite equivalente al del
panel —`package.json`, `vite.config.ts` en el puerto 5174, `tsconfig`,
`components.json` de shadcn, `index.html`, `src/main.tsx`— y las pantallas del
asistente, la pantalla de gestión, el cliente HTTP y el reductor.

El cliente HTTP de booking es **más simple** que el del panel: no hay access
token, ni refresco, ni rotación. Solo `fetch` con la cabecera del token de
gestión cuando la hay, y el mismo `ErrorApi` que ya traduce `RespuestaError`.

## Fuera de alcance

Portada informativa y catálogo público de precios · WhatsApp (solo la costura) ·
OTP y verificación de teléfono · cuentas de cliente · recordatorios programados,
que necesitan el `@Cron` que hoy no existe · lista de espera · anticipos y
pasarela de pago · Playwright · despliegue de booking (no hay Dockerfile para
frontends todavía, el panel tampoco lo tiene).
