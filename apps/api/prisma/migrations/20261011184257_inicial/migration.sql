-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('ADMIN', 'RECEPCIONISTA', 'BARBERO', 'CONTADOR');

-- CreateEnum
CREATE TYPE "EstadoReserva" AS ENUM ('PENDIENTE', 'CONFIRMADA', 'EN_CURSO', 'COMPLETADA', 'CANCELADA', 'NO_ASISTIO');

-- CreateEnum
CREATE TYPE "CanalReserva" AS ENUM ('PANEL', 'WEB', 'WALK_IN');

-- CreateEnum
CREATE TYPE "TipoBloqueAgenda" AS ENUM ('ALMUERZO', 'DESCANSO', 'ADMINISTRATIVO');

-- CreateEnum
CREATE TYPE "TipoExcepcionAgenda" AS ENUM ('CERRADO', 'HORARIO_ESPECIAL');

-- CreateEnum
CREATE TYPE "TipoDiaEspecial" AS ENUM ('FESTIVO_CERRADO', 'FESTIVO_ABIERTO', 'HORARIO_ESPECIAL');

-- CreateEnum
CREATE TYPE "TipoMovimientoInventario" AS ENUM ('ENTRADA', 'SALIDA', 'VENTA', 'AJUSTE', 'DEVOLUCION');

-- CreateEnum
CREATE TYPE "TipoItemVenta" AS ENUM ('SERVICIO', 'PRODUCTO');

-- CreateEnum
CREATE TYPE "MetodoPago" AS ENUM ('EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'NEQUI', 'DAVIPLATA', 'OTRO', 'CORTESIA');

-- CreateEnum
CREATE TYPE "AlcanceComision" AS ENUM ('USUARIO', 'SEDE', 'GLOBAL');

-- CreateEnum
CREATE TYPE "CanalNotificacion" AS ENUM ('WHATSAPP', 'EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "EstadoNotificacion" AS ENUM ('PENDIENTE', 'ENVIADA', 'FALLIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "NivelError" AS ENUM ('WARN', 'ERROR', 'FATAL');

-- CreateEnum
CREATE TYPE "AccionAuditoria" AS ENUM ('CREAR', 'ACTUALIZAR', 'ELIMINAR', 'INICIAR_SESION', 'CERRAR_SESION', 'INICIO_SESION_FALLIDO', 'CAMBIAR_PASSWORD', 'RESTABLECER_PASSWORD', 'CANJEAR_FIDELIDAD', 'CANCELAR_RESERVA', 'REPROGRAMAR_RESERVA', 'COMPLETAR_RESERVA', 'ANULAR_VENTA', 'AJUSTAR_INVENTARIO', 'EXPORTAR_DATOS');

-- CreateTable
CREATE TABLE "sedes" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(140) NOT NULL,
    "direccion" VARCHAR(255) NOT NULL,
    "ciudad" VARCHAR(120),
    "telefono" VARCHAR(30),
    "mapsUrl" VARCHAR(500),
    "notas" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "eliminadoEn" TIMESTAMP(3),

    CONSTRAINT "sedes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sede_horarios" (
    "id" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "diaSemana" SMALLINT NOT NULL,
    "horaInicio" SMALLINT NOT NULL,
    "horaFin" SMALLINT NOT NULL,
    "cerrado" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "sede_horarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "apellido" VARCHAR(120),
    "email" VARCHAR(180) NOT NULL,
    "telefono" VARCHAR(30) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "rol" "Rol" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "debeCambiarPassword" BOOLEAN NOT NULL DEFAULT false,
    "sedeId" UUID,
    "alias" VARCHAR(60),
    "bio" TEXT,
    "fotoUrl" VARCHAR(500),
    "visibleWeb" BOOLEAN NOT NULL DEFAULT true,
    "slotMinutos" SMALLINT,
    "ultimoAccesoEn" TIMESTAMP(3),
    "intentosFallidos" INTEGER NOT NULL DEFAULT 0,
    "bloqueadoHasta" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "eliminadoEn" TIMESTAMP(3),

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuario_sedes" (
    "usuarioId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuario_sedes_pkey" PRIMARY KEY ("usuarioId","sedeId")
);

-- CreateTable
CREATE TABLE "sesiones" (
    "id" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "familiaId" UUID NOT NULL,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "revocadaEn" TIMESTAMP(3),
    "motivoRevoca" VARCHAR(120),
    "ip" VARCHAR(64),
    "userAgent" VARCHAR(300),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sesiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tokens_recuperacion" (
    "id" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "codigoHash" VARCHAR(64) NOT NULL,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "usadoEn" TIMESTAMP(3),
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "ip" VARCHAR(64),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tokens_recuperacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clientes" (
    "id" UUID NOT NULL,
    "nombreCompleto" VARCHAR(160) NOT NULL,
    "telefono" VARCHAR(20) NOT NULL,
    "email" VARCHAR(180),
    "documento" VARCHAR(30),
    "fechaNacimiento" DATE,
    "notas" TEXT,
    "esGenerico" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "aceptaWhatsapp" BOOLEAN NOT NULL DEFAULT true,
    "aceptaEmail" BOOLEAN NOT NULL DEFAULT false,
    "totalVisitas" INTEGER NOT NULL DEFAULT 0,
    "totalGastado" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "primeraVisitaEn" TIMESTAMP(3),
    "ultimaVisitaEn" TIMESTAMP(3),
    "promedioDiasRegreso" SMALLINT,
    "regresoEstimadoEn" TIMESTAMP(3),
    "totalCancelaciones" INTEGER NOT NULL DEFAULT 0,
    "totalNoAsistio" INTEGER NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "eliminadoEn" TIMESTAMP(3),

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "servicios" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(140) NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "descripcion" TEXT,
    "incluye" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "precio" DECIMAL(12,2) NOT NULL,
    "duracionMinutos" SMALLINT NOT NULL,
    "bufferMinutos" SMALLINT,
    "color" VARCHAR(9),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "visibleWeb" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "cuentaFidelidad" BOOLEAN NOT NULL DEFAULT true,
    "canjeableFidelidad" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "eliminadoEn" TIMESTAMP(3),

    CONSTRAINT "servicios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservas" (
    "id" UUID NOT NULL,
    "codigo" VARCHAR(20) NOT NULL,
    "clienteId" UUID,
    "sedeId" UUID NOT NULL,
    "barberoId" UUID NOT NULL,
    "creadoPorId" UUID,
    "estado" "EstadoReserva" NOT NULL DEFAULT 'CONFIRMADA',
    "canal" "CanalReserva" NOT NULL DEFAULT 'PANEL',
    "inicioEn" TIMESTAMP(3) NOT NULL,
    "finEn" TIMESTAMP(3) NOT NULL,
    "finConBufferEn" TIMESTAMP(3) NOT NULL,
    "duracionMinutos" SMALLINT NOT NULL,
    "bufferMinutos" SMALLINT NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "descuento" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "notaCliente" TEXT,
    "notaInterna" TEXT,
    "turnoWalkIn" SMALLINT,
    "nombreContacto" VARCHAR(160),
    "telefonoContacto" VARCHAR(20),
    "confirmadaEn" TIMESTAMP(3),
    "iniciadaEn" TIMESTAMP(3),
    "completadaEn" TIMESTAMP(3),
    "canceladaEn" TIMESTAMP(3),
    "canceladaPor" VARCHAR(20),
    "motivoCancelacion" TEXT,
    "reprogramadaDeId" UUID,
    "tokenGestion" VARCHAR(64),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reserva_servicios" (
    "id" UUID NOT NULL,
    "reservaId" UUID NOT NULL,
    "servicioId" UUID NOT NULL,
    "nombreSnapshot" VARCHAR(140) NOT NULL,
    "precioSnapshot" DECIMAL(12,2) NOT NULL,
    "duracionSnapshot" SMALLINT NOT NULL,
    "cubiertoPorCanje" BOOLEAN NOT NULL DEFAULT false,
    "orden" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "reserva_servicios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agenda_dias" (
    "id" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "diaSemana" SMALLINT NOT NULL,
    "horaInicio" SMALLINT NOT NULL,
    "horaFin" SMALLINT NOT NULL,
    "slotMinutos" SMALLINT,
    "trabaja" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agenda_dias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agenda_bloques" (
    "id" UUID NOT NULL,
    "agendaDiaId" UUID NOT NULL,
    "tipo" "TipoBloqueAgenda" NOT NULL DEFAULT 'ALMUERZO',
    "horaInicio" SMALLINT NOT NULL,
    "horaFin" SMALLINT NOT NULL,
    "etiqueta" VARCHAR(80),

    CONSTRAINT "agenda_bloques_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agenda_excepciones" (
    "id" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "sedeId" UUID,
    "fecha" DATE NOT NULL,
    "tipo" "TipoExcepcionAgenda" NOT NULL,
    "horaInicio" SMALLINT,
    "horaFin" SMALLINT,
    "motivo" VARCHAR(200),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agenda_excepciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracion_global" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "nombreNegocio" VARCHAR(140) NOT NULL DEFAULT 'Caballeros del Señor',
    "zonaHoraria" VARCHAR(60) NOT NULL DEFAULT 'America/Bogota',
    "moneda" VARCHAR(3) NOT NULL DEFAULT 'COP',
    "logoUrl" VARCHAR(500),
    "telefonoContacto" VARCHAR(30),
    "emailContacto" VARCHAR(180),
    "slotMinutosDefault" SMALLINT NOT NULL DEFAULT 30,
    "bufferMinutosDefault" SMALLINT NOT NULL DEFAULT 0,
    "minAntelacionMinutos" INTEGER NOT NULL DEFAULT 60,
    "maxDiasAnticipacion" INTEGER NOT NULL DEFAULT 45,
    "horasLimiteCancelacion" SMALLINT NOT NULL DEFAULT 4,
    "horasLimiteReprogramacion" SMALLINT NOT NULL DEFAULT 4,
    "permiteElegirBarbero" BOOLEAN NOT NULL DEFAULT true,
    "requiereConfirmacion" BOOLEAN NOT NULL DEFAULT false,
    "maxReservasActivasCliente" SMALLINT NOT NULL DEFAULT 2,
    "recordatorioWhatsappHoras" SMALLINT NOT NULL DEFAULT 24,
    "recordatorioEmailHoras" SMALLINT NOT NULL DEFAULT 24,
    "notificarNuevaReserva" BOOLEAN NOT NULL DEFAULT true,
    "notificarCancelacion" BOOLEAN NOT NULL DEFAULT true,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "actualizadoPorId" UUID,

    CONSTRAINT "configuracion_global_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dias_especiales" (
    "id" UUID NOT NULL,
    "sedeId" UUID,
    "fecha" DATE NOT NULL,
    "nombre" VARCHAR(140) NOT NULL,
    "tipo" "TipoDiaEspecial" NOT NULL,
    "horaInicio" SMALLINT,
    "horaFin" SMALLINT,
    "visibleWeb" BOOLEAN NOT NULL DEFAULT true,
    "notas" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dias_especiales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programa_fidelidad" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "nombre" VARCHAR(140) NOT NULL DEFAULT 'Tarjeta de cortes',
    "sellosRequeridos" SMALLINT NOT NULL DEFAULT 7,
    "diasValidezSello" INTEGER,
    "diasValidezPremio" INTEGER,
    "canjeGeneraSello" BOOLEAN NOT NULL DEFAULT false,
    "acumulaPorSede" BOOLEAN NOT NULL DEFAULT false,
    "mensajePremio" VARCHAR(255) NOT NULL DEFAULT '¡Felicidades! Tu próximo corte es gratis',
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "programa_fidelidad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sellos_fidelidad" (
    "id" UUID NOT NULL,
    "clienteId" UUID NOT NULL,
    "reservaId" UUID NOT NULL,
    "sedeId" UUID,
    "canjeId" UUID,
    "caducaEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sellos_fidelidad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canjes_fidelidad" (
    "id" UUID NOT NULL,
    "clienteId" UUID NOT NULL,
    "reservaId" UUID,
    "autorizadoPorId" UUID,
    "sellosConsumidos" SMALLINT NOT NULL,
    "valorCubierto" DECIMAL(12,2) NOT NULL,
    "notas" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canjes_fidelidad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categorias_producto" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(140) NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "categorias_producto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productos" (
    "id" UUID NOT NULL,
    "sku" VARCHAR(60),
    "codigoBarras" VARCHAR(60),
    "nombre" VARCHAR(160) NOT NULL,
    "descripcion" TEXT,
    "marca" VARCHAR(120),
    "categoriaId" UUID,
    "costoUnitario" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "precioVenta" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "unidadMedida" VARCHAR(20) NOT NULL DEFAULT 'UNIDAD',
    "esVendible" BOOLEAN NOT NULL DEFAULT true,
    "stockMinimo" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "imagenUrl" VARCHAR(500),
    "proveedorId" UUID,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "eliminadoEn" TIMESTAMP(3),

    CONSTRAINT "productos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proveedores" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(160) NOT NULL,
    "nit" VARCHAR(40),
    "telefono" VARCHAR(30),
    "email" VARCHAR(180),
    "notas" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proveedores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "producto_stock" (
    "productoId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "cantidad" INTEGER NOT NULL DEFAULT 0,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "producto_stock_pkey" PRIMARY KEY ("productoId","sedeId")
);

-- CreateTable
CREATE TABLE "movimientos_inventario" (
    "id" UUID NOT NULL,
    "productoId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "tipo" "TipoMovimientoInventario" NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "stockResultante" INTEGER NOT NULL,
    "costoUnitario" DECIMAL(12,2),
    "precioUnitario" DECIMAL(12,2),
    "total" DECIMAL(12,2),
    "proveedorId" UUID,
    "documento" VARCHAR(80),
    "motivo" TEXT,
    "ventaItemId" UUID,
    "registradoPorId" UUID,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimientos_inventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ventas" (
    "id" UUID NOT NULL,
    "numero" VARCHAR(24) NOT NULL,
    "sedeId" UUID NOT NULL,
    "barberoId" UUID,
    "clienteId" UUID,
    "reservaId" UUID,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "descuento" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "impuestos" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "totalCortesia" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "metodoPago" "MetodoPago" NOT NULL DEFAULT 'EFECTIVO',
    "comisionBarbero" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "porcentajeComision" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "notas" TEXT,
    "anuladaEn" TIMESTAMP(3),
    "motivoAnulacion" TEXT,
    "registradoPorId" UUID,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ventas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venta_items" (
    "id" UUID NOT NULL,
    "ventaId" UUID NOT NULL,
    "tipo" "TipoItemVenta" NOT NULL,
    "referenciaId" UUID,
    "nombre" VARCHAR(160) NOT NULL,
    "cantidad" INTEGER NOT NULL DEFAULT 1,
    "precioUnitario" DECIMAL(12,2) NOT NULL,
    "descuento" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "costoUnitario" DECIMAL(12,2),
    "esCortesia" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "venta_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_comisiones" (
    "id" UUID NOT NULL,
    "alcance" "AlcanceComision" NOT NULL,
    "usuarioId" UUID,
    "sedeId" UUID,
    "servicioId" UUID,
    "porcentaje" DECIMAL(5,2) NOT NULL,
    "porcentajeProducto" DECIMAL(5,2),
    "vigenteDesde" DATE NOT NULL,
    "vigenteHasta" DATE,
    "notas" TEXT,
    "creadoPorId" UUID,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "config_comisiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plantillas_notificacion" (
    "id" UUID NOT NULL,
    "clave" VARCHAR(80) NOT NULL,
    "canal" "CanalNotificacion" NOT NULL,
    "nombre" VARCHAR(140) NOT NULL,
    "asunto" VARCHAR(200),
    "cuerpo" TEXT NOT NULL,
    "plantillaMeta" VARCHAR(140),
    "plantillaBrevo" INTEGER,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plantillas_notificacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificaciones" (
    "id" UUID NOT NULL,
    "canal" "CanalNotificacion" NOT NULL,
    "plantillaId" UUID,
    "destino" VARCHAR(180) NOT NULL,
    "clienteId" UUID,
    "reservaId" UUID,
    "estado" "EstadoNotificacion" NOT NULL DEFAULT 'PENDIENTE',
    "payload" JSONB,
    "idExterno" VARCHAR(140),
    "error" TEXT,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "programadaPara" TIMESTAMP(3),
    "enviadaEn" TIMESTAMP(3),
    "entregadaEn" TIMESTAMP(3),
    "leidaEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria" (
    "id" UUID NOT NULL,
    "accion" "AccionAuditoria" NOT NULL,
    "entidad" VARCHAR(60) NOT NULL,
    "entidadId" VARCHAR(64),
    "usuarioId" UUID,
    "usuarioNombre" VARCHAR(160),
    "usuarioRol" VARCHAR(30),
    "antes" JSONB,
    "despues" JSONB,
    "resumen" VARCHAR(500),
    "ip" VARCHAR(64),
    "userAgent" VARCHAR(300),
    "requestId" VARCHAR(40),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registro_errores" (
    "id" UUID NOT NULL,
    "nivel" "NivelError" NOT NULL DEFAULT 'ERROR',
    "codigo" VARCHAR(80) NOT NULL,
    "mensaje" TEXT NOT NULL,
    "stack" TEXT,
    "huella" VARCHAR(64),
    "ocurrencias" INTEGER NOT NULL DEFAULT 1,
    "origen" VARCHAR(20),
    "ruta" VARCHAR(300),
    "metodo" VARCHAR(10),
    "statusHttp" SMALLINT,
    "contexto" JSONB,
    "usuarioId" UUID,
    "requestId" VARCHAR(40),
    "ip" VARCHAR(64),
    "resueltoEn" TIMESTAMP(3),
    "notas" TEXT,
    "primeraVezEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimaVezEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registro_errores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sedes_slug_key" ON "sedes"("slug");

-- CreateIndex
CREATE INDEX "sedes_activa_orden_idx" ON "sedes"("activa", "orden");

-- CreateIndex
CREATE UNIQUE INDEX "sede_horarios_sedeId_diaSemana_key" ON "sede_horarios"("sedeId", "diaSemana");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE INDEX "usuarios_rol_activo_idx" ON "usuarios"("rol", "activo");

-- CreateIndex
CREATE INDEX "usuarios_sedeId_activo_idx" ON "usuarios"("sedeId", "activo");

-- CreateIndex
CREATE UNIQUE INDEX "sesiones_tokenHash_key" ON "sesiones"("tokenHash");

-- CreateIndex
CREATE INDEX "sesiones_usuarioId_revocadaEn_idx" ON "sesiones"("usuarioId", "revocadaEn");

-- CreateIndex
CREATE INDEX "sesiones_familiaId_idx" ON "sesiones"("familiaId");

-- CreateIndex
CREATE INDEX "sesiones_expiraEn_idx" ON "sesiones"("expiraEn");

-- CreateIndex
CREATE INDEX "tokens_recuperacion_usuarioId_usadoEn_idx" ON "tokens_recuperacion"("usuarioId", "usadoEn");

-- CreateIndex
CREATE INDEX "tokens_recuperacion_expiraEn_idx" ON "tokens_recuperacion"("expiraEn");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_telefono_key" ON "clientes"("telefono");

-- CreateIndex
CREATE INDEX "clientes_activo_ultimaVisitaEn_idx" ON "clientes"("activo", "ultimaVisitaEn");

-- CreateIndex
CREATE INDEX "clientes_regresoEstimadoEn_idx" ON "clientes"("regresoEstimadoEn");

-- CreateIndex
CREATE UNIQUE INDEX "servicios_slug_key" ON "servicios"("slug");

-- CreateIndex
CREATE INDEX "servicios_activo_orden_idx" ON "servicios"("activo", "orden");

-- CreateIndex
CREATE UNIQUE INDEX "reservas_codigo_key" ON "reservas"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "reservas_tokenGestion_key" ON "reservas"("tokenGestion");

-- CreateIndex
CREATE INDEX "reservas_barberoId_inicioEn_idx" ON "reservas"("barberoId", "inicioEn");

-- CreateIndex
CREATE INDEX "reservas_sedeId_inicioEn_idx" ON "reservas"("sedeId", "inicioEn");

-- CreateIndex
CREATE INDEX "reservas_clienteId_inicioEn_idx" ON "reservas"("clienteId", "inicioEn");

-- CreateIndex
CREATE INDEX "reservas_estado_inicioEn_idx" ON "reservas"("estado", "inicioEn");

-- CreateIndex
CREATE INDEX "reservas_inicioEn_idx" ON "reservas"("inicioEn");

-- CreateIndex
CREATE INDEX "reserva_servicios_servicioId_idx" ON "reserva_servicios"("servicioId");

-- CreateIndex
CREATE UNIQUE INDEX "reserva_servicios_reservaId_servicioId_key" ON "reserva_servicios"("reservaId", "servicioId");

-- CreateIndex
CREATE INDEX "agenda_dias_sedeId_diaSemana_idx" ON "agenda_dias"("sedeId", "diaSemana");

-- CreateIndex
CREATE UNIQUE INDEX "agenda_dias_usuarioId_sedeId_diaSemana_key" ON "agenda_dias"("usuarioId", "sedeId", "diaSemana");

-- CreateIndex
CREATE INDEX "agenda_bloques_agendaDiaId_idx" ON "agenda_bloques"("agendaDiaId");

-- CreateIndex
CREATE INDEX "agenda_excepciones_fecha_idx" ON "agenda_excepciones"("fecha");

-- CreateIndex
CREATE UNIQUE INDEX "agenda_excepciones_usuarioId_fecha_sedeId_key" ON "agenda_excepciones"("usuarioId", "fecha", "sedeId");

-- CreateIndex
CREATE INDEX "dias_especiales_fecha_idx" ON "dias_especiales"("fecha");

-- CreateIndex
CREATE UNIQUE INDEX "dias_especiales_fecha_sedeId_key" ON "dias_especiales"("fecha", "sedeId");

-- CreateIndex
CREATE UNIQUE INDEX "sellos_fidelidad_reservaId_key" ON "sellos_fidelidad"("reservaId");

-- CreateIndex
CREATE INDEX "sellos_fidelidad_clienteId_canjeId_idx" ON "sellos_fidelidad"("clienteId", "canjeId");

-- CreateIndex
CREATE INDEX "sellos_fidelidad_caducaEn_idx" ON "sellos_fidelidad"("caducaEn");

-- CreateIndex
CREATE UNIQUE INDEX "canjes_fidelidad_reservaId_key" ON "canjes_fidelidad"("reservaId");

-- CreateIndex
CREATE INDEX "canjes_fidelidad_clienteId_creadoEn_idx" ON "canjes_fidelidad"("clienteId", "creadoEn");

-- CreateIndex
CREATE UNIQUE INDEX "categorias_producto_nombre_key" ON "categorias_producto"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "categorias_producto_slug_key" ON "categorias_producto"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "productos_sku_key" ON "productos"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "productos_codigoBarras_key" ON "productos"("codigoBarras");

-- CreateIndex
CREATE INDEX "productos_activo_nombre_idx" ON "productos"("activo", "nombre");

-- CreateIndex
CREATE INDEX "productos_categoriaId_idx" ON "productos"("categoriaId");

-- CreateIndex
CREATE INDEX "producto_stock_sedeId_cantidad_idx" ON "producto_stock"("sedeId", "cantidad");

-- CreateIndex
CREATE INDEX "movimientos_inventario_productoId_fecha_idx" ON "movimientos_inventario"("productoId", "fecha");

-- CreateIndex
CREATE INDEX "movimientos_inventario_sedeId_fecha_idx" ON "movimientos_inventario"("sedeId", "fecha");

-- CreateIndex
CREATE INDEX "movimientos_inventario_tipo_fecha_idx" ON "movimientos_inventario"("tipo", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "ventas_numero_key" ON "ventas"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "ventas_reservaId_key" ON "ventas"("reservaId");

-- CreateIndex
CREATE INDEX "ventas_sedeId_fecha_idx" ON "ventas"("sedeId", "fecha");

-- CreateIndex
CREATE INDEX "ventas_barberoId_fecha_idx" ON "ventas"("barberoId", "fecha");

-- CreateIndex
CREATE INDEX "ventas_fecha_idx" ON "ventas"("fecha");

-- CreateIndex
CREATE INDEX "venta_items_ventaId_idx" ON "venta_items"("ventaId");

-- CreateIndex
CREATE INDEX "venta_items_tipo_referenciaId_idx" ON "venta_items"("tipo", "referenciaId");

-- CreateIndex
CREATE INDEX "config_comisiones_alcance_vigenteDesde_idx" ON "config_comisiones"("alcance", "vigenteDesde");

-- CreateIndex
CREATE INDEX "config_comisiones_usuarioId_vigenteDesde_idx" ON "config_comisiones"("usuarioId", "vigenteDesde");

-- CreateIndex
CREATE UNIQUE INDEX "plantillas_notificacion_clave_key" ON "plantillas_notificacion"("clave");

-- CreateIndex
CREATE INDEX "notificaciones_estado_programadaPara_idx" ON "notificaciones"("estado", "programadaPara");

-- CreateIndex
CREATE INDEX "notificaciones_reservaId_idx" ON "notificaciones"("reservaId");

-- CreateIndex
CREATE INDEX "notificaciones_idExterno_idx" ON "notificaciones"("idExterno");

-- CreateIndex
CREATE INDEX "auditoria_entidad_entidadId_idx" ON "auditoria"("entidad", "entidadId");

-- CreateIndex
CREATE INDEX "auditoria_usuarioId_creadoEn_idx" ON "auditoria"("usuarioId", "creadoEn");

-- CreateIndex
CREATE INDEX "auditoria_creadoEn_idx" ON "auditoria"("creadoEn");

-- CreateIndex
CREATE INDEX "auditoria_accion_creadoEn_idx" ON "auditoria"("accion", "creadoEn");

-- CreateIndex
CREATE INDEX "registro_errores_nivel_ultimaVezEn_idx" ON "registro_errores"("nivel", "ultimaVezEn");

-- CreateIndex
CREATE INDEX "registro_errores_huella_idx" ON "registro_errores"("huella");

-- CreateIndex
CREATE INDEX "registro_errores_resueltoEn_idx" ON "registro_errores"("resueltoEn");

-- AddForeignKey
ALTER TABLE "sede_horarios" ADD CONSTRAINT "sede_horarios_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_sedes" ADD CONSTRAINT "usuario_sedes_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_sedes" ADD CONSTRAINT "usuario_sedes_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens_recuperacion" ADD CONSTRAINT "tokens_recuperacion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_barberoId_fkey" FOREIGN KEY ("barberoId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_reprogramadaDeId_fkey" FOREIGN KEY ("reprogramadaDeId") REFERENCES "reservas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserva_servicios" ADD CONSTRAINT "reserva_servicios_reservaId_fkey" FOREIGN KEY ("reservaId") REFERENCES "reservas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserva_servicios" ADD CONSTRAINT "reserva_servicios_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_dias" ADD CONSTRAINT "agenda_dias_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_dias" ADD CONSTRAINT "agenda_dias_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_bloques" ADD CONSTRAINT "agenda_bloques_agendaDiaId_fkey" FOREIGN KEY ("agendaDiaId") REFERENCES "agenda_dias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_excepciones" ADD CONSTRAINT "agenda_excepciones_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_excepciones" ADD CONSTRAINT "agenda_excepciones_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dias_especiales" ADD CONSTRAINT "dias_especiales_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sellos_fidelidad" ADD CONSTRAINT "sellos_fidelidad_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sellos_fidelidad" ADD CONSTRAINT "sellos_fidelidad_reservaId_fkey" FOREIGN KEY ("reservaId") REFERENCES "reservas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sellos_fidelidad" ADD CONSTRAINT "sellos_fidelidad_canjeId_fkey" FOREIGN KEY ("canjeId") REFERENCES "canjes_fidelidad"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canjes_fidelidad" ADD CONSTRAINT "canjes_fidelidad_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canjes_fidelidad" ADD CONSTRAINT "canjes_fidelidad_reservaId_fkey" FOREIGN KEY ("reservaId") REFERENCES "reservas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canjes_fidelidad" ADD CONSTRAINT "canjes_fidelidad_autorizadoPorId_fkey" FOREIGN KEY ("autorizadoPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productos" ADD CONSTRAINT "productos_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "categorias_producto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productos" ADD CONSTRAINT "productos_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "proveedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producto_stock" ADD CONSTRAINT "producto_stock_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "productos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producto_stock" ADD CONSTRAINT "producto_stock_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "proveedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_ventaItemId_fkey" FOREIGN KEY ("ventaItemId") REFERENCES "venta_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_registradoPorId_fkey" FOREIGN KEY ("registradoPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ventas" ADD CONSTRAINT "ventas_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ventas" ADD CONSTRAINT "ventas_barberoId_fkey" FOREIGN KEY ("barberoId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ventas" ADD CONSTRAINT "ventas_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ventas" ADD CONSTRAINT "ventas_reservaId_fkey" FOREIGN KEY ("reservaId") REFERENCES "reservas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ventas" ADD CONSTRAINT "ventas_registradoPorId_fkey" FOREIGN KEY ("registradoPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venta_items" ADD CONSTRAINT "venta_items_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "ventas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config_comisiones" ADD CONSTRAINT "config_comisiones_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config_comisiones" ADD CONSTRAINT "config_comisiones_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config_comisiones" ADD CONSTRAINT "config_comisiones_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config_comisiones" ADD CONSTRAINT "config_comisiones_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_plantillaId_fkey" FOREIGN KEY ("plantillaId") REFERENCES "plantillas_notificacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_reservaId_fkey" FOREIGN KEY ("reservaId") REFERENCES "reservas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_errores" ADD CONSTRAINT "registro_errores_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
