# Web pública de reservas — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un cliente reserve, vea, cancele y reprograme su cita desde el móvil sin cuenta y sin llamar a la barbería.

**Architecture:** Un módulo `publico` nuevo en la API expone `/api/v1/publico/*` y orquesta los servicios de dominio que ya existen, traduciendo cada respuesta a un DTO público escrito a mano. Una app Vite nueva en `apps/booking` consume esa fachada. Ninguna regla de reserva se reimplementa: el dominio ya tiene el camino del cliente web escrito y sin ejecutar.

**Tech Stack:** NestJS 11 · Prisma 6 · PostgreSQL 17 · Zod 3 · React 19 · Vite · shadcn · TanStack Query · vitest · Cloudflare Turnstile · Brevo

**Spec:** `docs/superpowers/specs/2026-11-04-web-reservas-publica-design.md`

## Global Constraints

- Las reglas de reserva **no se reimplementan**: toda escritura pasa por `ReservasService` con `desdeWeb: true` u `origen: 'CLIENTE'`.
- Los límites de comportamiento se leen de `ConfiguracionGlobal`, nunca se escriben como constantes.
- Toda respuesta pública se construye con un mapeador manual de `dto-publico.ts`. Prohibido devolver una entidad de Prisma directamente.
- El esquema público se escribe desde cero en `@cds/shared`; **no** se deriva de `crearReservaSchema`.
- Español con acentuación correcta en identificadores, comentarios y mensajes, como el resto del repositorio.
- `@cds/shared` compila a `dist`: tras tocarlo, `pnpm --filter @cds/shared build`.
- Unitarias sin base de datos (dobles de `test/soporte/dobles.ts`); lo que necesita Postgres va a `test/integracion/` con su propia configuración.
- `vitest` con `globals: false`: hay que importar `describe`, `it`, `expect`, `vi` de `vitest`.
- Zona horaria del negocio: `America/Bogota`. Las horas de plantilla son minutos desde medianoche; los instantes son UTC.
- Puerto de booking: 5174 (`BOOKING_ORIGIN` ya lo declara por defecto).

## Review Focus

Cinco entradas que la spec implica y que ninguna tarea cubriría por defecto. Cada una tiene su prueba asignada a la tarea dueña del código.

1. **Un `servicioId` o `barberoId` oculto en web, pasado a mano.** `resolverServicios` solo filtra `activo`, no `visibleWeb`: hoy un cliente podría reservar un servicio oculto o con un barbero que no quiere aparecer. Debe rechazarse con `RECURSO_NO_ENCONTRADO`. → Tarea 9.
2. **Cloudflare `siteverify` caído o lento.** Sin decisión explícita, el fetch se queda colgado y toda reserva se bloquea indefinidamente. Timeout de 5 s y fallo cerrado con `SERVICIO_EXTERNO_CAIDO`, cuyo mensaje ya existe. → Tarea 4.
3. **Sede sin ningún barbero visible en web.** `/publico/opciones` la ofrecería y el cliente llegaría a un día sin huecos sin explicación. La disponibilidad debe responder no laborable, no reventar al calcular la unión de un conjunto vacío. → Tarea 6.
4. **Teléfono de una ficha con `eliminadoEn`.** `ClientesService.crear` reactiva la ficha. Hay que fijar que reservar desde la web reutiliza y reactiva ese cliente —es el mismo que vuelve— sin perder sus notas. → Tarea 8.
5. **Dos cancelaciones simultáneas con el mismo token.** La segunda debe dar `ESTADO_RESERVA_INVALIDO`, no un 500 ni una segunda cancelación. → Tarea 10.

---

## Mapa de archivos

**Nuevos, API** (`apps/api/src/modulos/publico/`):

| Archivo | Responsabilidad |
| --- | --- |
| `dto-publico.ts` | Mapeadores manuales de entidad a respuesta pública. La frontera. |
| `guard-token-gestion.ts` | Resuelve `X-Token-Gestion` a una reserva. |
| `guard-turnstile.ts` | Verifica el captcha contra Cloudflare. |
| `publico.service.ts` | Orquesta los servicios de dominio y elige barbero. |
| `publico.controller.ts` | Rutas, esquemas y límites de peticiones. |
| `publico.module.ts` | Cableado. |

**Nuevos, notificaciones** (`apps/api/src/modulos/notificaciones/`): `notificaciones.service.ts`, `adaptador-email.ts`.

**Nuevos, shared:** `packages/shared/src/validaciones/publico.ts`.

**Nuevos, booking** (`apps/booking/`): andamiaje Vite, `src/lib/api.ts`, `src/paginas/reservar/reductor.ts`, pantallas del asistente y `src/paginas/cita.tsx`.

**Modificados:** `packages/shared/src/index.ts`, `packages/shared/src/validaciones/reservas.ts`, `apps/api/src/app.module.ts`, `apps/api/src/main.ts`, `apps/api/src/comun/configuracion/entorno.ts`, `apps/api/src/modulos/reservas/reservas.service.ts`, `apps/api/src/modulos/notificaciones/notificaciones.module.ts`, `apps/api/prisma/seed.ts`, `.env.example`.

---

### Task 1: Esquemas del canal público

**Files:**
- Create: `packages/shared/src/validaciones/publico.ts`
- Modify: `packages/shared/src/index.ts` (añadir `export * from './validaciones/publico.js';`)
- Modify: `packages/shared/src/validaciones/reservas.ts` (`clienteNuevoEnReservaSchema`: añadir `email: emailOpcionalSchema.optional()`)
- Test: `apps/api/src/modulos/publico/esquemas.spec.ts`

**Interfaces:**
- Consumes: de `./comunes.js`: `idSchema`, `fechaSchema`, `fechaHoraSchema`, `telefonoSchema`, `textoRequerido`, `textoOpcional`, `arrayDeQuery`. De `./catalogo.js`: `emailOpcionalSchema`.
- Produces:
  - `crearReservaPublicaSchema` → `CrearReservaPublicaDto` con `sedeId`, `servicioIds` (1 a 6), `inicioEn`, `barberoId?`, `cliente: { nombreCompleto, telefono, email? }`, `notaCliente?`, `tokenTurnstile: string`.
  - `consultarDisponibilidadPublicaSchema` → `sedeId`, `fecha`, `servicioIds`, `barberoId?`.
  - `consultarCalendarioPublicoSchema` → `sedeId`, `desde`, `hasta`, `servicioIds`.
  - `cancelarReservaPublicaSchema` → `motivo?`, `tokenTurnstile`.
  - `reprogramarReservaPublicaSchema` → `inicioEn`, `barberoId?`, `tokenTurnstile`.
  - Tipos de respuesta: `OpcionesPublicas`, `SedePublica`, `ServicioPublico`, `BarberoPublico`, `ReservaPublica`, `HuecoPublico`, `DiaCalendarioPublico`.

- [ ] **Step 1: Write the failing test**

En `apps/api/src/modulos/publico/esquemas.spec.ts`, contra `crearReservaPublicaSchema`:

```ts
it('rechaza los campos que solo puede usar el panel', () => {
  // clienteId, descuento, notaInterna, confirmar, aplicarPremioFidelidad
  // no existen en el esquema: el parseo los descarta en vez de aceptarlos.
  const salida = crearReservaPublicaSchema.parse({ ...base, clienteId: ID.cliente, descuento: 5000 });
  expect(salida).not.toHaveProperty('clienteId');
  expect(salida).not.toHaveProperty('descuento');
});

it('normaliza el teléfono a E.164', () => {
  expect(crearReservaPublicaSchema.parse({ ...base, cliente: { nombreCompleto: 'Juan Pérez', telefono: '300 123 4567' } }).cliente.telefono)
    .toBe('+573001234567');
});

it('exige el token de Turnstile', () => {
  expect(crearReservaPublicaSchema.safeParse({ ...base, tokenTurnstile: undefined }).success).toBe(false);
});

it('acepta el correo como opcional y lo omite si no viene', () => { /* ambos casos */ });
it('exige entre 1 y 6 servicios', () => { /* 0 falla, 7 falla */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cds/api test -- esquemas.spec.ts`
Expected: FAIL — `crearReservaPublicaSchema` no existe.

- [ ] **Step 3: Implement `publico.ts`, exportarlo en `index.ts` y añadir `email` a `clienteNuevoEnReservaSchema`**

Los esquemas se declaran campo a campo. No usar `crearReservaSchema.omit(...)` ni `.pick(...)`: la razón está en la spec y es el motivo de la primera prueba.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cds/api test -- esquemas.spec.ts` → PASS
Run: `pnpm --filter @cds/shared build && pnpm --filter @cds/shared typecheck` → sin errores

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src apps/api/src/modulos/publico/esquemas.spec.ts
git commit -m "feat(shared): esquemas del canal publico de reservas"
```

---

### Task 2: Mapeadores públicos — la frontera contra fugas

Es la tarea más valiosa del plan y va antes que cualquier endpoint: fija por contrato qué sale a internet, de modo que un campo nuevo en el panel no pueda filtrarse por descuido meses después.

**Files:**
- Create: `apps/api/src/modulos/publico/dto-publico.ts`
- Test: `apps/api/src/modulos/publico/dto-publico.spec.ts`

**Interfaces:**
- Consumes: tipos de respuesta de la Tarea 1; fixtures `reserva()`, `servicio()`, `ID` de `apps/api/test/soporte/datos.ts`.
- Produces: `aReservaPublica(reserva, zona): ReservaPublica`, `aServicioPublico(servicio): ServicioPublico`, `aSedePublica(sede): SedePublica`, `aBarberoPublico(usuario): BarberoPublico`, `aHuecoPublico(hueco): HuecoPublico`.

- [ ] **Step 1: Write the failing test**

El patrón de cada prueba es el conjunto **exacto** de claves, no una lista de ausencias: así un campo nuevo rompe la prueba aunque nadie lo haya previsto.

```ts
it('la reserva pública tiene exactamente estas claves', () => {
  expect(Object.keys(aReservaPublica(reserva(), ZONA)).sort()).toEqual([
    'barbero', 'codigo', 'estado', 'finEn', 'inicioEn', 'sede', 'servicios', 'total',
  ]);
});

it('el servicio público no expone el buffer interno', () => {
  // bufferMinutos es tiempo de limpieza: el modelo dice explícitamente que el
  // cliente no lo ve.
  expect(Object.keys(aServicioPublico(servicio())).sort()).toEqual([
    'descripcion', 'duracionMinutos', 'id', 'incluye', 'nombre', 'precio',
  ]);
});

it('el barbero público no expone contacto ni rol', () => {
  expect(Object.keys(aBarberoPublico(/* usuario con email, telefono, rol */)).sort())
    .toEqual(['bio', 'fotoUrl', 'id', 'nombre']);
});

it('colapsa los motivos internos de ocupación', () => {
  for (const motivo of ['OCUPADO', 'ALMUERZO', 'DESCANSO'] as const) {
    const salida = aHuecoPublico({ inicioEn: '…', hora: '09:30', disponible: false, motivo });
    expect(salida.disponible).toBe(false);
    expect(salida.motivo).toBeUndefined();
  }
});

it('conserva los motivos que ayudan al cliente', () => {
  // ANTELACION y NO_CABE sí le explican por qué no puede elegir esa hora.
  expect(aHuecoPublico({ …, motivo: 'ANTELACION' }).motivo).toBe('ANTELACION');
  expect(aHuecoPublico({ …, motivo: 'NO_CABE' }).motivo).toBe('NO_CABE');
});
```

`nombre` del barbero es `alias ?? nombre`. `inicioEn` y `finEn` salen en ISO; `hora` ya viene formateada en la zona del negocio.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cds/api test -- dto-publico.spec.ts`
Expected: FAIL — módulo no encontrado.

- [ ] **Step 3: Implement los cinco mapeadores en `dto-publico.ts`**

Cada mapeador construye un objeto literal campo a campo. Prohibido el *spread* de la entidad y prohibido `delete`: lo que no se escribe, no sale.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cds/api test -- dto-publico.spec.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modulos/publico/dto-publico.ts apps/api/src/modulos/publico/dto-publico.spec.ts
git commit -m "feat(api): mapeadores del canal publico con contrato de claves exactas"
```

---

### Task 3: `GuardTokenGestion`

**Files:**
- Create: `apps/api/src/modulos/publico/guard-token-gestion.ts`
- Test: `apps/api/src/modulos/publico/guard-token-gestion.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`; `ErrorNegocio` de `../../comun/excepciones/error-negocio.js`; `CODIGOS_ERROR`; `crearPrismaDoble()` de `test/soporte/dobles.ts`.
- Produces: `GuardTokenGestion` (implementa `CanActivate`), que deja la reserva resuelta en `peticion.reservaPublica`. El controlador la lee con un decorador `@ReservaPorToken()` declarado en el mismo archivo.

- [ ] **Step 1: Write the failing test**

```ts
it('rechaza la petición sin cabecera', async () => {
  await expect(guard.canActivate(contexto({}))).rejects.toMatchObject({ codigo: CODIGOS_ERROR.TOKEN_INVALIDO });
});

it('rechaza un token que no existe', async () => { /* findUnique → null */ });

it('rechaza el token de una cita ya cancelada', async () => {
  // Al cancelar, tokenGestion queda en null, así que findUnique no la encuentra:
  // la prueba fija que no hay ninguna otra vía de acceso.
});

it('resuelve la reserva y la deja en la petición', async () => {
  const peticion = {};
  await expect(guard.canActivate(contexto({ 'x-token-gestion': 'abc' }, peticion))).resolves.toBe(true);
  expect(peticion.reservaPublica.id).toBe(ID.reserva);
});

it('consulta por el campo único y no por un barrido', () => {
  expect(prisma.reserva.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenGestion: 'abc' } }));
});
```

El status de `TOKEN_INVALIDO` es 401.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cds/api test -- guard-token-gestion.spec.ts` → FAIL

- [ ] **Step 3: Implement `GuardTokenGestion` y el decorador `@ReservaPorToken()`**

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cds/api test -- guard-token-gestion.spec.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modulos/publico/guard-token-gestion.ts apps/api/src/modulos/publico/guard-token-gestion.spec.ts
git commit -m "feat(api): guard de token de gestion para el canal publico"
```

---

### Task 4: `GuardTurnstile` y la variable de entorno

Cubre el punto 2 de Review Focus.

**Files:**
- Create: `apps/api/src/modulos/publico/guard-turnstile.ts`
- Test: `apps/api/src/modulos/publico/guard-turnstile.spec.ts`
- Modify: `apps/api/src/comun/configuracion/entorno.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `ConfigService`; `ErrorNegocio`; `CODIGOS_ERROR`.
- Produces: `GuardTurnstile` (implementa `CanActivate`). Lee `tokenTurnstile` del cuerpo. URL: `https://challenges.cloudflare.com/turnstile/v0/siteverify`.

- [ ] **Step 1: Write the failing test**

Con `vi.stubGlobal('fetch', …)`:

```ts
it('sin secreto configurado deja pasar y avisa en el log', async () => {
  // Misma convención que CorreoService: permite desarrollar y probar sin credenciales.
  await expect(guardSinSecreto.canActivate(ctx)).resolves.toBe(true);
});

it('deja pasar cuando Cloudflare responde success', async () => { /* { success: true } */ });

it('rechaza con VALIDACION cuando Cloudflare responde success false', async () => {
  await expect(guard.canActivate(ctx)).rejects.toMatchObject({
    codigo: CODIGOS_ERROR.VALIDACION,
  });
  // El campo señalado permite al frontend reiniciar el widget.
});

it('falla cerrado si Cloudflare no responde', async () => {
  // fetch rechaza: SERVICIO_EXTERNO_CAIDO, no un cuelgue ni un paso libre.
  await expect(guard.canActivate(ctx)).rejects.toMatchObject({
    codigo: CODIGOS_ERROR.SERVICIO_EXTERNO_CAIDO,
  });
});

it('aborta la verificación a los 5 segundos', async () => { /* AbortSignal.timeout */ });

it('envía la IP real del cliente a Cloudflare', async () => { /* remoteip */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cds/api test -- guard-turnstile.spec.ts` → FAIL

- [ ] **Step 3: Implement `GuardTurnstile`**

`AbortSignal.timeout(5_000)` para el corte. El fallo cerrado es deliberado: un control de seguridad que se abre cuando su proveedor se cae no es un control.

- [ ] **Step 4: Add `TURNSTILE_SECRET_KEY` a `entorno.ts`**

`z.string().optional()` en el objeto, y dentro del `superRefine` existente —en la rama `NODE_ENV === 'production'`— exigir que esté presente. Mismo criterio que los secretos de JWT: en producción la API no arranca sin ella. Añadirla también a `.env.example` con valor vacío y un comentario.

- [ ] **Step 5: Run the whole suite**

Run: `pnpm --filter @cds/api test` → PASS (la validación de entorno tiene consumidores)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modulos/publico/guard-turnstile.* apps/api/src/comun/configuracion/entorno.ts .env.example
git commit -m "feat(api): guard de Turnstile con fallo cerrado y secreto obligatorio en produccion"
```

---

### Task 5: `PublicoModule` y `GET /publico/opciones`

**Files:**
- Create: `apps/api/src/modulos/publico/publico.service.ts`, `publico.controller.ts`, `publico.module.ts`
- Test: `apps/api/src/modulos/publico/publico.service.spec.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/main.ts`

**Interfaces:**
- Consumes: mapeadores de la Tarea 2; `PrismaService`; `ConfiguracionNegocioService`.
- Produces: `PublicoService.opciones(): Promise<OpcionesPublicas>`; `PublicoController` con prefijo `publico` y `@Publico()` en cada ruta.

- [ ] **Step 1: Write the failing test**

```ts
it('solo ofrece sedes activas y no eliminadas', () => { /* where: activa true, eliminadoEn null */ });

it('solo ofrece servicios activos y visibles en web', () => {
  expect(prisma.servicio.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ activo: true, visibleWeb: true, eliminadoEn: null }) }),
  );
});

it('solo ofrece barberos visibles con rol BARBERO', () => { /* rol, activo, visibleWeb */ });

it('agrupa los barberos por sede', () => { /* un barbero habilitado en dos sedes aparece en las dos */ });

it('devuelve la configuración que el frontend necesita para comportarse igual que la API', () => {
  expect(opciones.config).toEqual({
    permiteElegirBarbero: true, maxDiasAnticipacion: 45, minAntelacionMinutos: 60,
    zonaHoraria: 'America/Bogota', moneda: 'COP', nombreNegocio: 'Caballeros del Señor',
  });
});

it('no revienta con una sede sin barberos visibles', () => {
  // Review Focus 3: la sede sale con la lista vacía, no se cae ni se omite en silencio.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cds/api test -- publico.service.spec.ts` → FAIL

- [ ] **Step 3: Implement `opciones()` y la ruta `@Get('opciones')`**

Los `select` de Prisma piden solo las columnas que el mapeador necesita: así una fuga tendría que atravesar dos barreras.

- [ ] **Step 4: Registrar el módulo y abrir la cabecera en CORS**

En `app.module.ts`, `PublicoModule` en `imports`. En `main.ts`, añadir `'x-token-gestion'` a `allowedHeaders`: sin eso el navegador rechaza la petición en el *preflight* y la pantalla de gestión no funciona.

- [ ] **Step 5: Run tests and the API**

Run: `pnpm --filter @cds/api test` → PASS
Run: `pnpm --filter @cds/api typecheck` → sin errores

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modulos/publico apps/api/src/app.module.ts apps/api/src/main.ts
git commit -m "feat(api): modulo publico con endpoint de opciones del asistente"
```

---

### Task 6: Disponibilidad y calendario públicos

Cubre el punto 3 de Review Focus.

**Files:**
- Modify: `apps/api/src/modulos/publico/publico.service.ts`, `publico.controller.ts`
- Test: `apps/api/src/modulos/publico/publico.service.spec.ts`

**Interfaces:**
- Consumes: `DisponibilidadService.delDia` y `.calendario`; `aHuecoPublico`.
- Produces: `PublicoService.disponibilidad(filtros): Promise<{ fecha, laborable, huecos: HuecoPublico[] }>` y `.calendario(filtros): Promise<DiaCalendarioPublico[]>`.

- [ ] **Step 1: Write the failing test**

```ts
it('pide la disponibilidad con las reglas del cliente activadas', () => {
  expect(disponibilidad.delDia).toHaveBeenCalledWith(expect.objectContaining({ aplicarReglasCliente: true }));
});

it('sin barbero elegido devuelve la unión de huecos libres de la sede', () => {
  // 09:00 libre solo en el barbero A y 10:00 libre solo en B → ambas salen.
});

it('un hueco ocupado en todos los barberos sale como no disponible', () => { /* y sin motivo */ });

it('con barbero elegido devuelve solo los huecos de ese barbero', () => { /* … */ });

it('no revela de quién es cada hueco en la unión', () => {
  // Ninguna clave del hueco contiene barberoId.
});

it('con una sede sin barberos visibles responde laborable false y huecos vacíos', () => {
  // Review Focus 3: la unión de un conjunto vacío no es un error.
});

it('el calendario reduce cada día a fecha y si hay hueco', () => {
  expect(Object.keys(dias[0]).sort()).toEqual(['fecha', 'hayHueco']);
});

it('recorta el rango del calendario a maxDiasAnticipacion', () => { /* hasta más allá del tope se recorta */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cds/api test -- publico.service.spec.ts` → FAIL

- [ ] **Step 3: Implement `disponibilidad()` y `calendario()` más sus dos rutas `@Get`**

La unión: un instante está disponible si algún barbero visible lo tiene disponible. Para los no disponibles, el motivo se conserva solo si **todos** coinciden en `ANTELACION` o `NO_CABE`; en cualquier otro caso se omite, porque mezclar motivos de varios barberos deja de ser información útil y empieza a ser una pista sobre sus agendas.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cds/api test -- publico.service.spec.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modulos/publico
git commit -m "feat(api): disponibilidad y calendario publicos con union de huecos"
```

---

### Task 7: Asignación automática de barbero

**Files:**
- Modify: `apps/api/src/modulos/publico/publico.service.ts`
- Test: `apps/api/src/modulos/publico/publico.service.spec.ts`

**Interfaces:**
- Produces: `PublicoService.elegirBarbero({ sedeId, inicioEn, servicioIds }): Promise<string>`. Lanza `ErrorNegocio(CODIGOS_ERROR.RESERVA_SOLAPADA, 409)` si no queda ninguno libre.

- [ ] **Step 1: Write the failing test**

```ts
it('elige al barbero con menos minutos ocupados ese día', () => { /* A: 180, B: 60 → B */ });

it('a igualdad de carga elige el de orden menor, de forma determinista', () => {
  // Dos llamadas con el mismo estado devuelven el mismo barbero: sin esto la
  // prueba de integración sería intermitente.
});

it('ignora a los barberos que no tienen ese hueco libre', () => { /* el menos cargado está ocupado → el otro */ });

it('ignora a los barberos no visibles en web', () => { /* … */ });

it('lanza RESERVA_SOLAPADA si ninguno está libre', () => { /* … */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cds/api test -- publico.service.spec.ts` → FAIL

- [ ] **Step 3: Implement `elegirBarbero`**

La carga del día se calcula sumando `duracionMinutos` de las reservas en estados que ocupan (`ESTADOS_QUE_OCUPAN`, ya exportado) en la fecha local del hueco. La decisión se toma aquí y no en el navegador porque un `barberoId` elegido tres minutos antes puede estar ya ocupado.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cds/api test -- publico.service.spec.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modulos/publico
git commit -m "feat(api): asignacion automatica de barbero en el canal publico"
```

---

### Task 8: El actor nulo, el correo y la rotación del token

Cubre el punto 4 de Review Focus. Es la única tarea que toca el dominio, y solo para lo que la spec justifica.

**Files:**
- Modify: `apps/api/src/modulos/reservas/reservas.service.ts`
- Test: `apps/api/src/modulos/reservas/reservas.service.spec.ts` (añadir un `describe`)

**Interfaces:**
- Produces: firmas relajadas a `actor: UsuarioAutenticado | null` en `crear`, `reprogramar` y `resolverCliente`. `cancelar` ya la acepta.

- [ ] **Step 1: Write the failing test**

```ts
it('crea con actor nulo y audita sin usuario', async () => {
  await servicio.crear(datosCrear(), null, true);
  expect(auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({ actor: null }));
  // Una fila de auditoría con usuario vacío dice la verdad; una con un usuario
  // inventado miente. El canal WEB de la reserva explica quién la creó.
});

it('pasa el correo a la ficha y marca aceptaEmail', async () => {
  await servicio.crear(datosCrear({ clienteNuevo: { …, email: 'juan@ejemplo.com' } }), null, true);
  expect(clientes.crear).toHaveBeenCalledWith(
    expect.objectContaining({ email: 'juan@ejemplo.com', aceptaEmail: true }), null,
  );
});

it('sin correo no marca aceptaEmail', async () => { /* aceptaEmail: false */ });

it('reutiliza y reactiva la ficha de un teléfono eliminado', async () => {
  // Review Focus 4: es el mismo cliente que vuelve. Sus notas no se pierden.
});

it('invalida el token de gestión al cancelar', async () => {
  expect(prisma.reserva.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ tokenGestion: null }) }),
  );
});

it('rota el token de gestión al reprogramar y devuelve el nuevo', async () => {
  // El enlace viejo pudo quedar en un correo o en un historial de WhatsApp.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cds/api test -- reservas.service.spec.ts` → FAIL

- [ ] **Step 3: Relajar las firmas y limpiar la deuda de `resolverCliente`**

En `reservas.service.ts:760-770`, quitar el `as never` y el campo fantasma `incluye: undefined`: `crearClienteSchema` no tiene `incluye` y el objeto encaja con `CrearClienteDto` sin casteo. Ese casteo está desactivando el chequeo de tipos exactamente en la línea por la que ahora pasa el correo del cliente, así que se limpia antes de modificarla.

- [ ] **Step 4: Implement la rotación e invalidación del `tokenGestion`**

`cancelar` → `tokenGestion: null`. `reprogramar` → `tokenGestion: tokenGestion()`, y el valor nuevo viaja en el resultado.

- [ ] **Step 5: Run the whole suite**

Run: `pnpm --filter @cds/api test` → PASS (la suite de reservas es la más grande del repositorio; esta tarea no debe romper ninguno de sus casos)
Run: `pnpm --filter @cds/api typecheck` → sin errores

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modulos/reservas
git commit -m "feat(api): actor nulo, correo del cliente y rotacion del token de gestion"
```

---

### Task 9: `POST /publico/reservas`

Cubre el punto 1 de Review Focus.

**Files:**
- Modify: `apps/api/src/modulos/publico/publico.service.ts`, `publico.controller.ts`
- Test: `apps/api/src/modulos/publico/publico.controller.spec.ts` (nuevo), `publico.service.spec.ts`

**Interfaces:**
- Consumes: `ReservasService.crear`; `elegirBarbero` (Tarea 7); `GuardTurnstile` (Tarea 4); `aReservaPublica` (Tarea 2).
- Produces: `PublicoService.crearReserva(datos, ip): Promise<ReservaPublica & { tokenGestion: string }>`.
- **Traducción de nombres entre canal y dominio:** el esquema público llama al
  cliente `cliente`; `CrearReservaDto` lo llama `clienteNuevo`. `crearReserva`
  traduce `datos.cliente` a `clienteNuevo` al llamar al dominio. Pasarlo con la
  clave equivocada no da error: `resolverCliente` devolvería `null` y la cita
  quedaría sin ficha, como un walk-in anónimo, perdiendo el teléfono del cliente
  y sus sellos de fidelidad. La primera prueba de abajo lo fija.

- [ ] **Step 1: Write the failing test**

```ts
it('crea sin actor, con la ficha del cliente y marcando el canal web', () => {
  expect(reservas.crear).toHaveBeenCalledWith(
    expect.objectContaining({
      clienteNuevo: { nombreCompleto: 'Juan Pérez', telefono: '+573001234567', email: undefined },
    }),
    null,
    true,
  );
  // Con la clave equivocada la cita quedaría sin ficha y en silencio.
});

it('rechaza un servicio que no es visible en web', async () => {
  // Review Focus 1: resolverServicios solo filtra `activo`. Sin esto, pasar a
  // mano el id de un servicio oculto permitiría reservarlo.
  await expect(servicio.crearReserva({ …, servicioIds: [ID.servicioOculto] }))
    .rejects.toMatchObject({ codigo: CODIGOS_ERROR.RECURSO_NO_ENCONTRADO });
});

it('rechaza un barbero que no es visible en web', async () => { /* mismo código */ });

it('elige barbero cuando no viene en la petición', () => { /* elegirBarbero llamado */ });

it('respeta el barbero elegido cuando viene', () => { /* elegirBarbero no llamado */ });

it('devuelve el token de gestión una sola vez, al crear', () => { /* presente aquí */ });

it('adjunta los huecos recalculados cuando el horario se acaba de ocupar', async () => {
  // El segundo cliente no debe quedarse con un error y un formulario vacío.
  const error = await servicio.crearReserva(datos).catch((e) => e);
  expect(error.codigo).toBe(CODIGOS_ERROR.RESERVA_SOLAPADA);
  expect(error.detalle.huecos).toBeInstanceOf(Array);
});
```

Y en el controlador, con el pipe `validar()` real, como hace `reservas.controller.spec.ts`:

```ts
it('declara el límite estricto de peticiones en crear', () => { /* metadatos de @Throttle: 5 / hora */ });
it('declara el guard de Turnstile en crear', () => { /* metadatos de @UseGuards */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cds/api test -- publico` → FAIL

- [ ] **Step 3: Implement `crearReserva` y la ruta `@Post('reservas')`**

La validación de visibilidad web ocurre en `PublicoService`, no en `ReservasService`: es una regla del canal, no del dominio —la recepción sí puede reservar un servicio oculto en web desde el panel.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cds/api test -- publico` → PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modulos/publico
git commit -m "feat(api): crear reserva desde el canal publico"
```

---

### Task 10: `GET` y `POST /publico/mi-reserva`

Cubre el punto 5 de Review Focus.

**Files:**
- Modify: `apps/api/src/modulos/publico/publico.service.ts`, `publico.controller.ts`
- Test: `apps/api/src/modulos/publico/publico.service.spec.ts`, `publico.controller.spec.ts`

**Interfaces:**
- Consumes: `GuardTokenGestion` y `@ReservaPorToken()` (Tarea 3); `ReservasService.cancelar` y `.reprogramar`.
- Produces: `PublicoService.miReserva(reserva)`, `.cancelarPropia(reserva, datos)`, `.reprogramarPropia(reserva, datos)`.

- [ ] **Step 1: Write the failing test**

```ts
it('dice si todavía puede cancelar y reprogramar', () => {
  // Con horasLimiteCancelacion = 4 y la cita a 2 horas: puedeCancelar false.
  // El frontend desactiva el botón en vez de ofrecer algo que la API rechazará.
});

it('cancela declarando el origen CLIENTE', () => {
  expect(reservas.cancelar).toHaveBeenCalledWith(ID.reserva, expect.anything(), null, 'CLIENTE');
  // Un origen equivocado no da error: solo se salta el plazo del cliente, y eso
  // se descubre semanas después en una reclamación.
});

it('reprograma marcando que viene del cliente', () => {
  expect(reservas.reprogramar).toHaveBeenCalledWith(ID.reserva, expect.anything(), null, true);
});

it('devuelve el token nuevo al reprogramar', () => { /* el viejo deja de valer */ });

it('la segunda cancelación con el mismo token da ESTADO_RESERVA_INVALIDO', async () => {
  // Review Focus 5: no un 500, y no una segunda cancelación.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cds/api test -- publico` → FAIL

- [ ] **Step 3: Implement los tres métodos y las tres rutas bajo `mi-reserva`**

`puedeCancelar` y `puedeReprogramar` se calculan con las horas que faltan y los límites de `ConfiguracionGlobal`, el mismo cálculo que hace el dominio al rechazar.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cds/api test -- publico` → PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modulos/publico
git commit -m "feat(api): ver, cancelar y reprogramar la cita con el token de gestion"
```

---

### Task 11: Notificaciones con la costura de WhatsApp

**Files:**
- Create: `apps/api/src/modulos/notificaciones/notificaciones.service.ts`, `adaptador-email.ts`
- Test: `apps/api/src/modulos/notificaciones/notificaciones.service.spec.ts`
- Modify: `apps/api/src/modulos/notificaciones/notificaciones.module.ts`, `apps/api/prisma/seed.ts`
- Modify: `apps/api/src/modulos/publico/publico.service.ts` (encolar tras crear)

**Interfaces:**
- Consumes: `CorreoService.enviar`; `PrismaService`.
- Produces: `NotificacionesService.encolar({ reservaId, clienteId, clave, canal, destino, variables }): Promise<void>`; `AdaptadorEmail.enviar(plantilla, destino, variables): Promise<{ idExterno?: string }>`.

- [ ] **Step 1: Write the failing test**

```ts
it('registra la notificación antes de intentar enviarla', () => { /* estado PENDIENTE */ });

it('marca ENVIADA con el id externo del proveedor', () => { /* idExterno guardado para rastrear entregas */ });

it('marca FALLIDA con el error y cuenta el intento', () => {
  expect(prisma.notificacion.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ estado: 'FALLIDA', intentos: 1 }) }),
  );
});

it('no lanza si el proveedor falla', async () => {
  // La cita ya está en pantalla con su código: el correo es una comodidad, no el recibo.
  await expect(servicio.encolar(datos)).resolves.toBeUndefined();
});

it('deja en PENDIENTE un canal sin adaptador todavía', async () => {
  // WHATSAPP está en el enum y planificado: la fila queda encolada, no se pierde
  // ni revienta. Cuando llegue su adaptador, nada más cambia.
  await servicio.encolar({ …, canal: 'WHATSAPP' });
  expect(prisma.notificacion.update).not.toHaveBeenCalled();
});

it('resuelve la plantilla por clave y canal', () => { /* reserva.confirmada + EMAIL */ });

it('no encola nada si el cliente no dio correo', () => { /* desde publico.service */ });

it('un fallo de notificación no tumba la reserva', () => { /* crearReserva resuelve igual */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cds/api test -- notificaciones` → FAIL

- [ ] **Step 3: Implement `NotificacionesService` y `AdaptadorEmail`**

El adaptador se elige por el valor de `CanalNotificacion`. Hoy solo existe `EMAIL`; el registro es un mapa, de modo que añadir WhatsApp sea una entrada más y ni una línea de `ReservasService` cambie. Las variables se sustituyen en la plantilla con los placeholders `{{…}}` que el modelo ya documenta.

- [ ] **Step 4: Añadir la plantilla `reserva.confirmada` al seed**

Canal `EMAIL`, con asunto y cuerpo que incluyan `{{cliente}}`, `{{fecha}}`, `{{barbero}}`, `{{sede}}`, `{{codigo}}` y `{{enlace}}`. El seed es idempotente: usar `upsert` por la clave única.

- [ ] **Step 5: Encolar al crear desde la web**

En `PublicoService.crearReserva`, **después** de que la transacción confirme y solo si el cliente dio correo.

- [ ] **Step 6: Run tests and the seed**

Run: `pnpm --filter @cds/api test` → PASS
Run: `pnpm db:seed` dos veces seguidas → la segunda no duplica ni falla

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modulos/notificaciones apps/api/src/modulos/publico apps/api/prisma/seed.ts
git commit -m "feat(api): notificaciones con adaptador de correo y costura para WhatsApp"
```

---

### Task 12: Integración contra PostgreSQL

**Files:**
- Create: `apps/api/test/integracion/publico-reservas.spec.ts`

**Interfaces:**
- Consumes: `apps/api/test/integracion/soporte/conexion.ts` y `semilla.ts`, siguiendo el patrón de `reservas-solape.spec.ts`.

- [ ] **Step 1: Write the failing test**

Lo que solo se puede comprobar con el motor delante:

```ts
it('rechaza una reserva web por debajo de la antelación mínima', () => { /* ANTELACION_INSUFICIENTE */ });
it('rechaza una fecha más allá de maxDiasAnticipacion', () => { /* FECHA_DEMASIADO_LEJANA */ });
it('aplica el tope de reservas activas por teléfono', () => { /* LIMITE_RESERVAS_ACTIVAS a la tercera */ });
it('rechaza cancelar fuera de plazo', () => { /* FUERA_DE_PLAZO_CANCELACION */ });
it('deja el token inservible tras cancelar', () => { /* el token ya no resuelve ninguna reserva */ });
it('reutiliza la ficha del mismo teléfono en dos reservas', () => { /* un solo cliente en la tabla */ });
it('dos reservas web simultáneas en el mismo hueco: solo una entra', () => {
  // La restricción de exclusión es la última palabra, y con dobles de Prisma
  // esa regla simplemente no existe.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm db:up && pnpm --filter @cds/api test:integracion` → FAIL

- [ ] **Step 3: Ajustar lo que la integración destape**

Las unitarias usan dobles; aquí aparecen los desajustes con el esquema real (tipos `Decimal`, columnas obligatorias). Corregir en el código, no relajando la prueba.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cds/api test:integracion` → PASS
Run: `pnpm --filter @cds/api test` → PASS (no se ha roto nada)

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/integracion/publico-reservas.spec.ts apps/api/src
git commit -m "test(api): integracion del canal publico contra Postgres"
```

---

### Task 13: Andamiaje de `apps/booking` y su cliente HTTP

**Files:**
- Create: `apps/booking/package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `vitest.config.ts`, `components.json`, `index.html`, `.env.example`, `src/main.tsx`, `src/app.tsx`, `src/estilos.css`, `src/lib/api.ts`, `src/lib/utils.ts`
- Test: `apps/booking/src/lib/api.spec.ts`

**Interfaces:**
- Consumes: `@cds/shared` (`RespuestaError`, esquemas públicos).
- Produces: `peticion<T>(ruta, opciones)`, `guardarTokenGestion(token)`, `ErrorApi` con `codigo`, `mensaje`, `status`, `campos`, `detalle`.

- [ ] **Step 1: Write the failing test**

```ts
it('manda el token de gestión en la cabecera cuando lo hay', async () => {
  guardarTokenGestion('abc');
  await peticion('/publico/mi-reserva');
  expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
    headers: expect.objectContaining({ 'x-token-gestion': 'abc' }),
  }));
});

it('no manda la cabecera si no hay token', async () => { /* … */ });

it('traduce RespuestaError a ErrorApi conservando codigo y detalle', async () => {
  // El frontend ramifica por codigo, nunca por status HTTP. Y `detalle` lleva
  // los huecos recalculados cuando el horario se acaba de ocupar.
});

it('no intenta refrescar sesión ante un 401', async () => {
  // Este cliente es más simple que el del panel a propósito: no hay sesión.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cds/booking test` → FAIL

- [ ] **Step 3: Implement el andamiaje**

Copiar la forma del panel: `vite.config.ts` con `react()`, `tailwindcss()`, alias `@` y `server: { port: 5174, strictPort: true }`; `main.tsx` con `QueryClientProvider` (`retry: 1`, como el panel), `BrowserRouter` y `estilos.css`. `package.json` con `name: "@cds/booking"` y scripts `dev`, `build`, `typecheck`, `lint`, `test`. **Sin** `ProveedorSesion`: aquí no hay sesión.

`src/lib/api.ts` es deliberadamente más corto que el del panel: sin access token, sin refresco, sin rotación. Solo `fetch`, la cabecera del token cuando existe, y la traducción de `RespuestaError`.

- [ ] **Step 4: Run tests and the dev server**

Run: `pnpm --filter @cds/booking test` → PASS
Run: `pnpm --filter @cds/booking typecheck` → sin errores
Run: `pnpm --filter @cds/booking build` → compila

- [ ] **Step 5: Commit**

```bash
git add apps/booking
git commit -m "feat(booking): andamiaje de la web publica y cliente HTTP"
```

---

### Task 14: Reductor del asistente

**Files:**
- Create: `apps/booking/src/paginas/reservar/reductor.ts`
- Test: `apps/booking/src/paginas/reservar/reductor.spec.ts`

**Interfaces:**
- Produces: `estadoInicial`, `reductor(estado, accion)`, tipo `PasoReserva = 'servicio' | 'fecha' | 'hora' | 'datos' | 'listo'`, y los selectores `totalPrecio(estado)` y `totalDuracion(estado)`.

- [ ] **Step 1: Write the failing test**

```ts
it('empieza en el paso de servicio sin nada elegido', () => { /* … */ });
it('no avanza de servicio sin al menos uno elegido', () => { /* el paso no cambia */ });
it('suma el precio y la duración de los servicios elegidos', () => { /* dos servicios */ });
it('al quitar el último servicio vuelve a bloquear el avance', () => { /* … */ });
it('cambiar de sede limpia la fecha y la hora elegidas', () => {
  // Los huecos son de una sede: conservarlos reservaría en la sede equivocada.
});
it('cambiar de servicio limpia la hora elegida', () => {
  // La duración cambia, así que el hueco pudo dejar de caber.
});
it('retroceder desde datos vuelve a hora conservando lo elegido', () => { /* … */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cds/booking test -- reductor` → FAIL

- [ ] **Step 3: Implement el reductor**

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cds/booking test -- reductor` → PASS

- [ ] **Step 5: Commit**

```bash
git add apps/booking/src/paginas/reservar
git commit -m "feat(booking): reductor del asistente de reserva"
```

---

### Task 15: Pantallas del asistente

**Files:**
- Create: `apps/booking/src/paginas/reservar/index.tsx` y un componente por paso (`paso-servicio.tsx`, `paso-fecha.tsx`, `paso-hora.tsx`, `paso-datos.tsx`, `paso-listo.tsx`)
- Create: `apps/booking/src/componentes/` con los de shadcn que haga falta
- Test: `apps/booking/src/paginas/reservar/index.spec.tsx`

**Interfaces:**
- Consumes: `peticion` (Tarea 13); reductor y selectores (Tarea 14); esquemas públicos (Tarea 1).
- Produces: la ruta `/` con el paso espejado en la query (`?paso=hora`).

- [ ] **Step 1: Write the failing test**

Con Testing Library y `peticion` doblado:

```ts
it('pinta los servicios con su precio y duración', () => { /* … */ });
it('el botón de continuar está desactivado hasta elegir un servicio', () => { /* … */ });
it('espeja el paso en la query para que el botón atrás retroceda un paso', () => { /* ?paso=fecha */ });
it('solo habilita los días con hueco', () => { /* un día sin hueco queda deshabilitado */ });
it('ofrece «cualquier barbero» por defecto', () => { /* … */ });
it('oculta la elección de barbero si permiteElegirBarbero es false', () => { /* viene de opciones */ });
it('muestra el código y el enlace al confirmar', () => { /* CDS-… y el enlace con el token en el fragmento */ });
it('al ocuparse el horario muestra el aviso y refresca los huecos', () => {
  // RESERVA_SOLAPADA: el mensaje ya escrito, y la rejilla actualizada debajo
  // con los huecos que llegan en `detalle`.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cds/booking test -- reservar` → FAIL

- [ ] **Step 3: Implement las pantallas**

Móvil primero, con los componentes de shadcn que ya usa el panel. Los mensajes de error se toman de `MENSAJES_ERROR` por `codigo`: ya están redactados para el cliente final. El `.ics` del paso final se genera en el navegador, sin endpoint nuevo. Widget de Turnstile en el paso de datos, con `VITE_TURNSTILE_SITE_KEY`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cds/booking test` → PASS

- [ ] **Step 5: Verificar en el navegador**

Levantar API y booking, recorrer el flujo completo hasta una cita creada, y comprobarla en el panel: canal `WEB`, sin usuario creador.

- [ ] **Step 6: Commit**

```bash
git add apps/booking/src
git commit -m "feat(booking): asistente de reserva en cinco pasos"
```

---

### Task 16: Pantalla de gestión de la cita

**Files:**
- Create: `apps/booking/src/paginas/cita.tsx`
- Test: `apps/booking/src/paginas/cita.spec.tsx`

**Interfaces:**
- Consumes: `peticion` y `guardarTokenGestion` (Tarea 13); `/publico/mi-reserva` (Tarea 10); los pasos de fecha y hora (Tarea 15) para reprogramar.
- Produces: la ruta `/cita`.

- [ ] **Step 1: Write the failing test**

```ts
it('lee el token del fragmento de la URL', () => {
  // El fragmento no viaja al servidor: no aparece en logs ni en Referer.
});
it('desactiva cancelar cuando puedeCancelar es false', () => {
  // Con el motivo a la vista: «Ya pasó el plazo para cancelar. Llama a la barbería.»
});
it('avisa si el enlace no es válido', () => { /* TOKEN_INVALIDO */ });
it('pide confirmación antes de cancelar', () => { /* … */ });
it('guarda el token nuevo tras reprogramar', () => { /* el enlace viejo deja de valer */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cds/booking test -- cita` → FAIL

- [ ] **Step 3: Implement la pantalla**

El token sale de `location.hash`, nunca de la ruta ni de la query.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cds/booking test` → PASS

- [ ] **Step 5: Verificar el ciclo completo en el navegador**

Reservar, abrir el enlace, reprogramar, comprobar que el enlace viejo ya no vale, y cancelar.

- [ ] **Step 6: Run everything and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test` → todo en verde

```bash
git add apps/booking/src
git commit -m "feat(booking): pantalla de gestion de la cita con token"
```

---

## Qué queda fuera, y anotado

- Portada informativa y catálogo público de precios: entrega futura ya acordada.
- WhatsApp: solo la costura (Tarea 11). Las variables `WHATSAPP_*` ya están en `entorno.ts`.
- Recordatorios automáticos: necesitan el `@Cron` que el proyecto no tiene todavía, aunque `ScheduleModule` ya esté registrado.
- Playwright de punta a punta.
- Despliegue de booking: no hay Dockerfile para frontends; el panel tampoco lo tiene.
- **CI**: no existe `.github/`, así que nada ejecuta este plan de pruebas automáticamente al hacer push. Es el hueco más grande que deja esta entrega.
