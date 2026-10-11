-- ============================================================================
--  Reglas de negocio que viven en la base de datos.
--
--  Por qué aquí y no solo en la API: la validación en código tiene una ventana
--  de carrera. Dos recepcionistas que pulsan "Guardar" en el mismo milisegundo
--  pueden pasar los dos la comprobación "¿está libre este hueco?" y crear dos
--  reservas encima. Postgres cierra esa puerta: la segunda transacción falla.
--  La API traduce ese fallo a un mensaje legible para el usuario.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extensiones y utilidades de texto
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Normaliza texto para buscar sin acentos ni mayúsculas: "José" encuentra
-- "jose" y al revés.
--
-- Dos detalles que no son opcionales:
--   · unaccent() es STABLE, no IMMUTABLE, así que no puede usarse directamente
--     en un índice. Este envoltorio se declara IMMUTABLE pasándole el
--     diccionario de forma explícita (práctica estándar y segura mientras el
--     diccionario no se modifique).
--   · Se usa el cuerpo SQL estándar (RETURN ...) en lugar de $$ … $$ porque el
--     ejecutor de migraciones parte el archivo por punto y coma y rompería un
--     cuerpo delimitado por dólares.
CREATE OR REPLACE FUNCTION public.normalizar_texto(txt text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
RETURN lower(public.unaccent('public.unaccent'::regdictionary, coalesce(txt, '')));

-- ---------------------------------------------------------------------------
-- 2. Búsqueda de clientes por nombre o teléfono (el buscador del formulario)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS clientes_nombre_trgm_idx
  ON clientes USING gin (public.normalizar_texto("nombreCompleto") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS clientes_telefono_trgm_idx
  ON clientes USING gin ("telefono" gin_trgm_ops);

-- Un solo cliente genérico ("Consumidor final") para los walk-ins sin ficha.
CREATE UNIQUE INDEX IF NOT EXISTS clientes_unico_generico_idx
  ON clientes ("esGenerico") WHERE "esGenerico" = true;

-- ---------------------------------------------------------------------------
-- 3. Imposible solapar reservas del mismo barbero
--
--    Se compara el rango [inicioEn, finConBufferEn) — con el buffer incluido,
--    porque el tiempo de limpieza también ocupa la silla. Solo aplica a los
--    estados que realmente reservan tiempo: una cita cancelada o un no-show
--    liberan el hueco inmediatamente.
-- ---------------------------------------------------------------------------
ALTER TABLE reservas
  ADD CONSTRAINT reservas_sin_solape_barbero
  EXCLUDE USING gist (
    "barberoId" WITH =,
    tsrange("inicioEn", "finConBufferEn", '[)') WITH &&
  )
  WHERE (estado IN ('PENDIENTE', 'CONFIRMADA', 'EN_CURSO'));

-- Coherencia temporal básica de la reserva.
ALTER TABLE reservas
  ADD CONSTRAINT reservas_rango_valido
  CHECK ("finEn" > "inicioEn" AND "finConBufferEn" >= "finEn");

ALTER TABLE reservas
  ADD CONSTRAINT reservas_importes_no_negativos
  CHECK (subtotal >= 0 AND descuento >= 0 AND total >= 0 AND descuento <= subtotal);

-- ---------------------------------------------------------------------------
-- 4. Coherencia de horarios (minutos desde medianoche: 0 … 1440)
-- ---------------------------------------------------------------------------
ALTER TABLE sede_horarios
  ADD CONSTRAINT sede_horarios_rango_valido
  CHECK (
    "horaInicio" BETWEEN 0 AND 1440
    AND "horaFin" BETWEEN 0 AND 1440
    AND ("cerrado" = true OR "horaFin" > "horaInicio")
  );

ALTER TABLE sede_horarios
  ADD CONSTRAINT sede_horarios_dia_valido
  CHECK ("diaSemana" BETWEEN 0 AND 6);

ALTER TABLE agenda_dias
  ADD CONSTRAINT agenda_dias_rango_valido
  CHECK (
    "horaInicio" BETWEEN 0 AND 1440
    AND "horaFin" BETWEEN 0 AND 1440
    AND ("trabaja" = false OR "horaFin" > "horaInicio")
  );

ALTER TABLE agenda_dias
  ADD CONSTRAINT agenda_dias_dia_valido
  CHECK ("diaSemana" BETWEEN 0 AND 6);

ALTER TABLE agenda_dias
  ADD CONSTRAINT agenda_dias_slot_valido
  CHECK ("slotMinutos" IS NULL OR "slotMinutos" BETWEEN 5 AND 240);

-- Un almuerzo no puede solaparse con otro bloque del mismo día.
ALTER TABLE agenda_bloques
  ADD CONSTRAINT agenda_bloques_rango_valido
  CHECK ("horaFin" > "horaInicio" AND "horaInicio" >= 0 AND "horaFin" <= 1440);

ALTER TABLE agenda_bloques
  ADD CONSTRAINT agenda_bloques_sin_solape
  EXCLUDE USING gist (
    "agendaDiaId" WITH =,
    int4range("horaInicio", "horaFin", '[)') WITH &&
  );

-- ---------------------------------------------------------------------------
-- 5. Tablas de configuración de fila única
-- ---------------------------------------------------------------------------
ALTER TABLE configuracion_global
  ADD CONSTRAINT configuracion_global_fila_unica CHECK (id = 1);

ALTER TABLE programa_fidelidad
  ADD CONSTRAINT programa_fidelidad_fila_unica CHECK (id = 1);

ALTER TABLE programa_fidelidad
  ADD CONSTRAINT programa_fidelidad_sellos_validos
  CHECK ("sellosRequeridos" BETWEEN 1 AND 100);

ALTER TABLE configuracion_global
  ADD CONSTRAINT configuracion_global_slot_valido
  CHECK ("slotMinutosDefault" BETWEEN 5 AND 240 AND "bufferMinutosDefault" BETWEEN 0 AND 120);

-- ---------------------------------------------------------------------------
-- 6. Inventario y dinero
-- ---------------------------------------------------------------------------
ALTER TABLE movimientos_inventario
  ADD CONSTRAINT movimientos_cantidad_positiva CHECK (cantidad > 0);

ALTER TABLE producto_stock
  ADD CONSTRAINT producto_stock_no_negativo CHECK (cantidad >= 0);

ALTER TABLE venta_items
  ADD CONSTRAINT venta_items_cantidad_positiva CHECK (cantidad > 0);

ALTER TABLE ventas
  ADD CONSTRAINT ventas_importes_coherentes
  CHECK (subtotal >= 0 AND total >= 0 AND descuento >= 0 AND "totalCortesia" >= 0);

ALTER TABLE config_comisiones
  ADD CONSTRAINT config_comisiones_porcentaje_valido
  CHECK (
    porcentaje BETWEEN 0 AND 100
    AND ("porcentajeProducto" IS NULL OR "porcentajeProducto" BETWEEN 0 AND 100)
  );

-- Un barbero no puede tener dos comisiones vigentes a la vez para el mismo
-- alcance: el cálculo del cierre tiene que ser determinista.
ALTER TABLE config_comisiones
  ADD CONSTRAINT config_comisiones_sin_solape_usuario
  EXCLUDE USING gist (
    "usuarioId" WITH =,
    daterange("vigenteDesde", "vigenteHasta", '[)') WITH &&
  )
  WHERE (alcance = 'USUARIO' AND "servicioId" IS NULL);

ALTER TABLE servicios
  ADD CONSTRAINT servicios_valores_validos
  CHECK (
    precio >= 0
    AND "duracionMinutos" BETWEEN 5 AND 600
    AND ("bufferMinutos" IS NULL OR "bufferMinutos" BETWEEN 0 AND 120)
  );
