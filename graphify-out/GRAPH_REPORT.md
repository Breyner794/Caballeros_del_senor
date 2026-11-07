# Graph Report - Caballeros-del-senor  (2026-11-04)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1607 nodes · 4998 edges · 74 communities (52 shown, 22 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 209 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `54352540`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- cn
- reservas.service.spec.ts
- reservas-coherencia.spec.ts
- AutenticacionService
- PrismaService
- app.module.ts
- ErrorNegocio
- disponibilidad.service.ts
- scripts
- RequierePermisos
- api/package.json
- @nestjs/common
- UsuarioAutenticado
- sedes.service.ts
- InventarioService
- compilerOptions
- ClientesController
- index.ts
- auditoria.controller.ts
- usuarios.service.ts
- postgres
- compilerOptions
- ConfiguracionService
- ContabilidadService
- usuarios.controller.ts
- UsuariosService
- reservas.controller.spec.ts
- components.json
- devDependencies
- agenda.ts
- compilerOptions
- comunes.ts
- dependencies
- devDependencies
- inventario.service.ts
- catalogo.ts
- auth.ts
- reservas.ts
- compilerOptions
- seed.ts
- scripts
- panel/package.json
- compilerOptions
- inventario.controller.ts
- disponibilidad.controller.ts
- allowBuilds
- GuardAutenticacion
- nest-cli.json
- codigos.ts
- .actualizar
- .oxlintrc.json
- scripts
- PaginaEntrar
- entorno.ts
- contabilidad.controller.ts
- @cds/shared
- date-fns
- reflect-metadata
- vite-env.d.ts
- panel/tsconfig.json
- clsx
- @hookform/resolvers@^3.10.0
- radix-ui@^1.7.0
- @radix-ui/react-avatar@^1.1.2
- @radix-ui/react-checkbox@^1.1.4
- @radix-ui/react-dropdown-menu@^2.1.6
- @radix-ui/react-label
- @radix-ui/react-scroll-area@^1.2.3
- @radix-ui/react-slot
- @radix-ui/react-switch@^1.1.3
- @radix-ui/react-tooltip@^1.1.8
- react-hook-form@^7.54.2
- sonner@^1.7.4
- tailwind-merge

## God Nodes (most connected - your core abstractions)
1. `UsuarioAutenticado` - 121 edges
2. `RequierePermisos()` - 97 edges
3. `cn()` - 70 edges
4. `Boton` - 65 edges
5. `UsuarioActual` - 62 edges
6. `@nestjs/common` - 61 edges
7. `PrismaService` - 57 edges
8. `ErrorNegocio` - 56 edges
9. `Entrada` - 40 edges
10. `Esqueleto()` - 38 edges

## Surprising Connections (you probably didn't know these)
- `typescript@^5.7.3` --declares--> `typescript`  [EXTRACTED]
  apps/panel/package.json → package.json
- `ReservaAgenda` --references--> `EstadoReserva`  [EXTRACTED]
  apps/panel/src/paginas/hoy.tsx → packages/shared/src/validaciones/reservas.ts
- `UsuarioPanel` --references--> `Rol`  [EXTRACTED]
  apps/panel/src/paginas/usuarios.tsx → packages/shared/src/dominio/roles.ts
- `UsuarioAutenticado` --references--> `Permiso`  [EXTRACTED]
  apps/api/src/comun/autenticacion/tipos.ts → packages/shared/src/dominio/roles.ts
- `UsuarioAutenticado` --references--> `Rol`  [EXTRACTED]
  apps/api/src/comun/autenticacion/tipos.ts → packages/shared/src/dominio/roles.ts

## Import Cycles
- None detected.

## Communities (74 total, 22 thin omitted)

### Community 0 - "cn"
Cohesion: 0.05
Nodes (202): App(), Arrancando(), SoloConSesion(), Armazon(), Encabezado(), ENLACES, etiquetaRol(), TITULOS_GRUPO (+194 more)

### Community 1 - "reservas.service.spec.ts"
Cohesion: 0.08
Nodes (45): Entorno, escenarioBase(), escenarioCalendario(), montar(), ocupacion(), barberoValido(), datosCrear(), Entorno (+37 more)

### Community 2 - "reservas-coherencia.spec.ts"
Cohesion: 0.07
Nodes (28): RegistroErroresService, FiltroGlobalExcepciones, insertar(), montarFiltro(), viola(), DIEZ_A_ONCE, esSolape(), cerrarConexion() (+20 more)

### Community 3 - "AutenticacionService"
Cohesion: 0.08
Nodes (11): Publico(), SaludController, AutenticacionController, AutenticacionService, DatosDispositivo, ContextoSesion, CambiarPasswordDto, LoginDto (+3 more)

### Community 4 - "PrismaService"
Cohesion: 0.07
Nodes (8): AuditoriaService, ConfiguracionNegocioService, PrismaService, ClientesService, FidelidadController, FidelidadService, ComisionesService, VentasService

### Community 5 - "app.module.ts"
Cohesion: 0.07
Nodes (16): AppModule, ComunModule, AgendaModule, AutenticacionModule, ClientesModule, ConfiguracionModule, ContabilidadModule, DisponibilidadModule (+8 more)

### Community 6 - "ErrorNegocio"
Cohesion: 0.13
Nodes (5): ErrorNegocio, fechaLegible(), AgendaService, ReservasService, puedeTransicionar()

### Community 7 - "disponibilidad.service.ts"
Cohesion: 0.10
Nodes (25): aFechaLocal(), aFechaPura(), aHoraLocal(), aInstante(), aMinutosDelDia(), diaSemanaLocal(), hoyLocal(), limitesDelDia() (+17 more)

### Community 8 - "scripts"
Cohesion: 0.05
Nodes (41): typescript@^5.7.3, devDependencies, prettier@^3.4.2, typescript@^5.7.3, engines, node, typescript, name (+33 more)

### Community 9 - "RequierePermisos"
Cohesion: 0.11
Nodes (4): RequierePermisos(), UsuarioActual, AgendaController, ReservasController

### Community 10 - "api/package.json"
Cohesion: 0.07
Nodes (40): dependencies, cookie-parser@^1.4.7, date-fns-tz@^3.2.0, helmet@^8.0.0, ioredis@^5.4.2, @nestjs/common@^11.0.8, @nestjs/config@^4.0.0, @nestjs/core@^11.0.8 (+32 more)

### Community 11 - "@nestjs/common"
Cohesion: 0.16
Nodes (20): CAMPOS_SENSIBLES, DatosRegistroError, CODIGOS_POSTGRES, CitaAfectada, ClienteBusqueda, FichaCliente, ImpactoSlot, FiltrosCierre (+12 more)

### Community 12 - "UsuarioAutenticado"
Cohesion: 0.11
Nodes (4): DatosAuditoria, UsuarioAutenticado, ServiciosController, ServiciosService

### Community 13 - "sedes.service.ts"
Cohesion: 0.10
Nodes (9): aSlug(), SedesController, SedesModule, INCLUDE_SEDE, SedesService, ActualizarSedeDto, actualizarSedeSchema, CrearSedeDto (+1 more)

### Community 15 - "compilerOptions"
Cohesion: 0.06
Nodes (31): compilerOptions, incremental, rootDir, exclude, extends, compilerOptions, incremental, module (+23 more)

### Community 16 - "ClientesController"
Cohesion: 0.08
Nodes (5): ClientesController, actualizarClienteSchema, buscarClientesSchema, crearClienteSchema, listarClientesSchema

### Community 17 - "index.ts"
Cohesion: 0.14
Nodes (17): CLAVE_PERMISOS, CLAVE_PUBLICO, CLAVE_ROLES, ContextoPeticion, express, PayloadAccessToken, PayloadRefreshToken, Request (+9 more)

### Community 18 - "auditoria.controller.ts"
Cohesion: 0.11
Nodes (7): AuditoriaConsultaService, ACCIONES, AuditoriaController, ErroresController, filtrosAuditoria, filtrosErrores, AuditoriaConsultaModule

### Community 19 - "usuarios.service.ts"
Cohesion: 0.09
Nodes (6): TokensService, CorreoService, EnvioCorreo, CitaPendiente, SELECCION_USUARIO, UsuarioPanel

### Community 20 - "postgres"
Cohesion: 0.08
Nodes (28): POSTGRES_DB, POSTGRES_PASSWORD, POSTGRES_USER, TZ, interval, retries, test, timeout (+20 more)

### Community 21 - "compilerOptions"
Cohesion: 0.07
Nodes (26): compilerOptions, allowSyntheticDefaultImports, baseUrl, declaration, emitDecoratorMetadata, esModuleInterop, experimentalDecorators, forceConsistentCasingInFileNames (+18 more)

### Community 22 - "ConfiguracionService"
Cohesion: 0.10
Nodes (4): ConfiguracionController, ConfiguracionService, actualizarConfiguracionSchema, crearDiaEspecialSchema

### Community 24 - "usuarios.controller.ts"
Cohesion: 0.14
Nodes (6): UsuariosController, actualizarPerfilSchema, actualizarUsuarioSchema, crearUsuarioSchema, listarUsuariosSchema, resetearPasswordUsuarioSchema

### Community 26 - "reservas.controller.spec.ts"
Cohesion: 0.16
Nodes (14): ValidacionZod, validar(), rangoOpcional, agendaDelDiaSchema, capturarValidacion(), cuerpoCrear(), montar(), validarCon() (+6 more)

### Community 27 - "components.json"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 28 - "devDependencies"
Cohesion: 0.11
Nodes (19): @types/node@^22.13.1, @types/node, devDependencies, tailwindcss@^4.0.3, @tailwindcss/vite@^4.0.3, tw-animate-css@^1.2.3, @types/node@^22.13.1, @types/react@^19.0.8 (+11 more)

### Community 29 - "agenda.ts"
Cohesion: 0.11
Nodes (18): guardarConForzar, Bloque, ActualizarConfiguracionDto, ActualizarProgramaFidelidadDto, bloqueAgendaSchema, CrearDiaEspecialDto, CrearExcepcionDto, crearExcepcionSchema (+10 more)

### Community 30 - "compilerOptions"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, baseUrl, jsx, lib, module, moduleDetection, moduleResolution (+11 more)

### Community 31 - "comunes.ts"
Cohesion: 0.13
Nodes (16): CursorRespuesta, LIMITE_DEFECTO, LIMITE_MAXIMO, LIMITE_MAXIMO_EXPORTACION, MetaPagina, ParametrosPagina, INDICATIVO_DEFECTO, normalizarTelefono() (+8 more)

### Community 32 - "dependencies"
Cohesion: 0.11
Nodes (19): dependencies, cn@^0.4.0, @fontsource-variable/inter@^5.3.0, lucide-react@^0.474.0, @radix-ui/react-dialog@^1.1.6, @radix-ui/react-popover@^1.1.6, @radix-ui/react-select@^2.1.6, @radix-ui/react-separator@^1.1.2 (+11 more)

### Community 33 - "devDependencies"
Cohesion: 0.11
Nodes (18): devDependencies, @nestjs/cli@^11.0.2, @nestjs/schematics@^11.0.0, @nestjs/testing@^11.0.8, pino-pretty@^13.0.0, tsx@^4.19.2, @types/cookie-parser@^1.4.8, @types/express@^5.0.0 (+10 more)

### Community 34 - "inventario.service.ts"
Cohesion: 0.21
Nodes (8): DatosMovimiento, DatosProducto, FiltrosServicios, ServicioConUsos, UsoServicio, calcularSalto(), construirMeta(), PaginaRespuesta

### Community 35 - "catalogo.ts"
Cohesion: 0.13
Nodes (13): reordenarSchema, ActualizarClienteDto, ActualizarServicioDto, actualizarServicioSchema, ActualizarUsuarioDto, CrearClienteDto, CrearServicioDto, crearServicioSchema (+5 more)

### Community 36 - "auth.ts"
Cohesion: 0.13
Nodes (15): PERMISOS, ROLES, tieneAlgunPermiso(), tienePermiso(), ActualizarPerfilDto, cambiarPasswordSchema, loginSchema, restablecerPasswordSchema (+7 more)

### Community 37 - "reservas.ts"
Cohesion: 0.12
Nodes (15): ActualizarReservaDto, actualizarReservaSchema, baseReservaSchema, CANALES_RESERVA, CancelarReservaDto, clienteNuevoEnReservaSchema, CompletarReservaDto, ConsultarDisponibilidadDto (+7 more)

### Community 38 - "compilerOptions"
Cohesion: 0.12
Nodes (15): compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution (+7 more)

### Community 39 - "seed.ts"
Cohesion: 0.18
Nodes (11): argon2@^0.41.1, dotenv@^16.4.7, prisma@^6.3.1, aSlug(), hora(), main(), OPCIONES_ARGON, prisma (+3 more)

### Community 40 - "scripts"
Cohesion: 0.14
Nodes (14): scripts, build, dev, lint, prisma:deploy, prisma:generate, prisma:migrate, prisma:seed (+6 more)

### Community 41 - "panel/package.json"
Cohesion: 0.15
Nodes (12): class-variance-authority@^0.7.1, @radix-ui/react-tabs@^1.1.3, react-dom@^19.0.0, shadcn@^4.21.4, name, private, type, version (+4 more)

### Community 42 - "compilerOptions"
Cohesion: 0.17
Nodes (11): compilerOptions, lib, module, moduleResolution, noEmit, skipLibCheck, strict, target (+3 more)

### Community 43 - "inventario.controller.ts"
Cohesion: 0.18
Nodes (10): categoriaSchema, conteoSchema, filtrosMovimientos, filtrosProductos, movimientoSchema, productoSchema, proveedorSchema, booleanoDeQuery (+2 more)

### Community 44 - "disponibilidad.controller.ts"
Cohesion: 0.29
Nodes (3): DisponibilidadController, consultarCalendarioSchema, consultarDisponibilidadSchema

### Community 45 - "allowBuilds"
Cohesion: 0.20
Nodes (9): allowBuilds, argon2, esbuild, prisma, @prisma/client, @prisma/engines, @scarf/scarf, onlyBuiltDependencies (+1 more)

### Community 47 - "nest-cli.json"
Cohesion: 0.29
Nodes (6): collection, compilerOptions, deleteOutDir, webpack, $schema, sourceRoot

### Community 48 - "codigos.ts"
Cohesion: 0.38
Nodes (6): nanoid@^5.0.9, codigoReserva(), generar, generarToken, tokenGestion(), nanoid

### Community 50 - ".oxlintrc.json"
Cohesion: 0.33
Nodes (5): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema

### Community 51 - "scripts"
Cohesion: 0.33
Nodes (6): scripts, build, dev, lint, preview, typecheck

### Community 52 - "PaginaEntrar"
Cohesion: 0.73
Nodes (6): PaginaEntrar(), entrar(), limpiar(), manejarError(), pedirCodigo(), restablecer()

### Community 53 - "entorno.ts"
Cohesion: 0.50
Nodes (4): Entorno, entornoSchema, secretoSchema(), validarEntorno()

### Community 54 - "contabilidad.controller.ts"
Cohesion: 0.40
Nodes (4): filtros, simulacion, idSchema, porcentajeSchema

### Community 55 - "@cds/shared"
Cohesion: 0.67
Nodes (3): @cds/shared@workspace:*, @cds/shared, @cds/shared@workspace:*

### Community 56 - "date-fns"
Cohesion: 0.67
Nodes (3): date-fns@^4.1.0, date-fns, date-fns@^4.1.0

## Knowledge Gaps
- **22 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `UsuarioAutenticado` connect `UsuarioAutenticado` to `reservas.service.spec.ts`, `AutenticacionService`, `ErrorNegocio`, `disponibilidad.service.ts`, `RequierePermisos`, `@nestjs/common`, `sedes.service.ts`, `InventarioService`, `ClientesController`, `index.ts`, `auditoria.controller.ts`, `usuarios.service.ts`, `ConfiguracionService`, `usuarios.controller.ts`, `UsuariosService`, `reservas.controller.spec.ts`, `agenda.ts`, `inventario.service.ts`, `catalogo.ts`, `inventario.controller.ts`, `disponibilidad.controller.ts`, `.actualizar`?**
  _High betweenness centrality (0.124) - this node is a cross-community bridge._
- **Should `cn` be split into smaller, more focused modules?**
  _Cohesion score 0.05005018400802944 - nodes in this community are weakly interconnected._
- **Why does `@nestjs/common` connect `@nestjs/common` to `inventario.service.ts`, `catalogo.ts`, `PrismaService`, `app.module.ts`, `disponibilidad.service.ts`, `api/package.json`, `inventario.controller.ts`, `disponibilidad.controller.ts`, `sedes.service.ts`, `index.ts`, `auditoria.controller.ts`, `usuarios.service.ts`, `contabilidad.controller.ts`, `usuarios.controller.ts`, `reflect-metadata`, `reservas.controller.spec.ts`, `agenda.ts`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **Should `reservas.service.spec.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08106473079249849 - nodes in this community are weakly interconnected._
- **Why does `RequierePermisos()` connect `RequierePermisos` to `catalogo.ts`, `inventario.controller.ts`, `disponibilidad.controller.ts`, `sedes.service.ts`, `InventarioService`, `UsuarioAutenticado`, `ClientesController`, `index.ts`, `auditoria.controller.ts`, `.actualizar`, `ContabilidadService`, `ConfiguracionService`, `contabilidad.controller.ts`, `usuarios.controller.ts`, `reservas.controller.spec.ts`, `agenda.ts`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **Should `reservas-coherencia.spec.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06688311688311688 - nodes in this community are weakly interconnected._
- **Should `AutenticacionService` be split into smaller, more focused modules?**
  _Cohesion score 0.0841799709724238 - nodes in this community are weakly interconnected._