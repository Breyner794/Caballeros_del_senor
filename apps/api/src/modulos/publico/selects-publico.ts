/**
 * Los `select` piden solo las columnas que emite el mapeador correspondiente:
 * una fuga tendría que atravesar dos barreras (el `select` y el mapeador).
 * Si el mapeador gana un campo, hay que añadirlo en el `select` de su entidad
 * (aquí) o saldrá `undefined` sin que la prueba de claves exactas lo vea.
 */
export const SELECT_SEDE = {
  id: true,
  nombre: true,
  direccion: true,
  ciudad: true,
  telefono: true,
  mapsUrl: true,
} as const;

export const SELECT_SERVICIO = {
  id: true,
  nombre: true,
  descripcion: true,
  incluye: true,
  precio: true,
  duracionMinutos: true,
} as const;

/** Los cinco campos que emite `aBarberoPublico`. */
export const SELECT_BARBERO_PUBLICO = {
  id: true,
  nombre: true,
  alias: true,
  bio: true,
  fotoUrl: true,
} as const;

/**
 * Barbero para `opciones`: `sedeId` y `sedesPermitidas` solo sirven para
 * agrupar por sede y no salen en la respuesta.
 */
export const SELECT_BARBERO = {
  ...SELECT_BARBERO_PUBLICO,
  sedeId: true,
  sedesPermitidas: { select: { sedeId: true } },
} as const;
