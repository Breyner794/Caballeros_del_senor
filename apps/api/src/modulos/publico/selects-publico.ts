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

/**
 * La cita tal como la emite `aReservaPublica`, y nada más. El `include` de
 * `ReservasService` es el del panel: trae la sede sin `ciudad`, `telefono` ni
 * `mapsUrl` y el barbero sin `bio`, así que tras escribir se relee con este
 * `select`. `tokenGestion` se pide para las respuestas que lo devuelven (crear
 * y reprogramar); el mapeador no lo emite, así que `miReserva` no lo expone.
 */
export const SELECT_RESERVA_PUBLICA = {
  codigo: true,
  estado: true,
  inicioEn: true,
  finEn: true,
  total: true,
  tokenGestion: true,
  sede: { select: SELECT_SEDE },
  barbero: { select: SELECT_BARBERO_PUBLICO },
  servicios: {
    select: { nombreSnapshot: true, precioSnapshot: true, duracionSnapshot: true },
    orderBy: { orden: 'asc' },
  },
} as const;
