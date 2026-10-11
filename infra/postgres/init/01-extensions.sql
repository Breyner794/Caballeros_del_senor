-- Extensiones que necesita el esquema. En desarrollo este script se ejecuta
-- al crear el volumen por primera vez; en produccion las crea la migracion
-- 20261011190000_reglas_negocio_sql, que es la fuente de verdad.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gist;
