/**
 * Catálogo de errores de negocio.
 *
 * Cada error tiene un código estable que el frontend puede usar para decidir
 * qué hacer (abrir un diálogo, resaltar un campo) y un mensaje en español ya
 * escrito para el usuario final. El frontend nunca construye el texto a partir
 * de un status HTTP suelto, y el módulo de errores globales agrupa por código.
 */

export const CODIGOS_ERROR = {
  // --- Autenticación ---
  CREDENCIALES_INVALIDAS: 'CREDENCIALES_INVALIDAS',
  USUARIO_INACTIVO: 'USUARIO_INACTIVO',
  USUARIO_BLOQUEADO: 'USUARIO_BLOQUEADO',
  SESION_EXPIRADA: 'SESION_EXPIRADA',
  TOKEN_INVALIDO: 'TOKEN_INVALIDO',
  TOKEN_REUTILIZADO: 'TOKEN_REUTILIZADO',
  CODIGO_INVALIDO: 'CODIGO_INVALIDO',
  CODIGO_EXPIRADO: 'CODIGO_EXPIRADO',
  DEMASIADOS_INTENTOS: 'DEMASIADOS_INTENTOS',
  SIN_PERMISO: 'SIN_PERMISO',
  PASSWORD_ACTUAL_INCORRECTA: 'PASSWORD_ACTUAL_INCORRECTA',

  // --- Reservas ---
  RESERVA_SOLAPADA: 'RESERVA_SOLAPADA',
  HORARIO_FUERA_DE_JORNADA: 'HORARIO_FUERA_DE_JORNADA',
  BARBERO_NO_TRABAJA_ESE_DIA: 'BARBERO_NO_TRABAJA_ESE_DIA',
  BARBERO_NO_PERTENECE_A_SEDE: 'BARBERO_NO_PERTENECE_A_SEDE',
  SEDE_CERRADA: 'SEDE_CERRADA',
  DIA_NO_LABORABLE: 'DIA_NO_LABORABLE',
  ANTELACION_INSUFICIENTE: 'ANTELACION_INSUFICIENTE',
  FECHA_DEMASIADO_LEJANA: 'FECHA_DEMASIADO_LEJANA',
  RESERVA_EN_EL_PASADO: 'RESERVA_EN_EL_PASADO',
  LIMITE_RESERVAS_ACTIVAS: 'LIMITE_RESERVAS_ACTIVAS',
  ESTADO_RESERVA_INVALIDO: 'ESTADO_RESERVA_INVALIDO',
  FUERA_DE_PLAZO_CANCELACION: 'FUERA_DE_PLAZO_CANCELACION',
  FUERA_DE_PLAZO_REPROGRAMACION: 'FUERA_DE_PLAZO_REPROGRAMACION',
  SIN_SERVICIOS: 'SIN_SERVICIOS',

  // --- Agenda ---
  DIA_CON_RESERVAS: 'DIA_CON_RESERVAS',
  BLOQUE_FUERA_DE_JORNADA: 'BLOQUE_FUERA_DE_JORNADA',
  BLOQUES_SOLAPADOS: 'BLOQUES_SOLAPADOS',
  CAMBIO_SEDE_CON_RESERVAS: 'CAMBIO_SEDE_CON_RESERVAS',

  // --- Fidelidad ---
  SELLOS_INSUFICIENTES: 'SELLOS_INSUFICIENTES',
  PROGRAMA_FIDELIDAD_INACTIVO: 'PROGRAMA_FIDELIDAD_INACTIVO',
  SERVICIO_NO_CANJEABLE: 'SERVICIO_NO_CANJEABLE',
  CANJE_YA_APLICADO: 'CANJE_YA_APLICADO',

  // --- Inventario ---
  STOCK_INSUFICIENTE: 'STOCK_INSUFICIENTE',
  PRODUCTO_NO_VENDIBLE: 'PRODUCTO_NO_VENDIBLE',
  MOVIMIENTO_INMUTABLE: 'MOVIMIENTO_INMUTABLE',

  // --- Ventas / contabilidad ---
  VENTA_YA_ANULADA: 'VENTA_YA_ANULADA',
  PERIODO_CERRADO: 'PERIODO_CERRADO',
  COMISION_SOLAPADA: 'COMISION_SOLAPADA',

  // --- Genéricos ---
  RECURSO_NO_ENCONTRADO: 'RECURSO_NO_ENCONTRADO',
  DUPLICADO: 'DUPLICADO',
  VALIDACION: 'VALIDACION',
  CONFLICTO: 'CONFLICTO',
  ERROR_INTERNO: 'ERROR_INTERNO',
  SERVICIO_EXTERNO_CAIDO: 'SERVICIO_EXTERNO_CAIDO',
  /** Solo la genera el cliente HTTP del frontend: la petición no llegó a la API. */
  ERROR_RED: 'ERROR_RED',
} as const;

export type CodigoError = (typeof CODIGOS_ERROR)[keyof typeof CODIGOS_ERROR];

/** Mensajes por defecto. La API puede enriquecerlos con datos concretos. */
export const MENSAJES_ERROR: Record<CodigoError, string> = {
  CREDENCIALES_INVALIDAS: 'El correo o la contraseña no son correctos.',
  USUARIO_INACTIVO: 'Esta cuenta está desactivada. Habla con el administrador.',
  USUARIO_BLOQUEADO:
    'La cuenta quedó bloqueada temporalmente por varios intentos fallidos. Inténtalo más tarde.',
  SESION_EXPIRADA: 'Tu sesión expiró. Vuelve a iniciar sesión.',
  TOKEN_INVALIDO: 'El enlace o el token no es válido.',
  TOKEN_REUTILIZADO:
    'Se detectó un uso sospechoso de tu sesión y se cerraron todas por seguridad. Vuelve a iniciar sesión.',
  CODIGO_INVALIDO: 'El código de verificación no es correcto.',
  CODIGO_EXPIRADO: 'El código de verificación ya expiró. Solicita uno nuevo.',
  DEMASIADOS_INTENTOS: 'Demasiados intentos. Espera unos minutos antes de volver a probar.',
  SIN_PERMISO: 'Tu rol no tiene permiso para hacer esto.',
  PASSWORD_ACTUAL_INCORRECTA: 'La contraseña actual no es correcta.',

  RESERVA_SOLAPADA: 'Ese horario acaba de ocuparse. Elige otro hueco disponible.',
  HORARIO_FUERA_DE_JORNADA: 'La hora elegida está fuera de la jornada del barbero.',
  BARBERO_NO_TRABAJA_ESE_DIA: 'El barbero no atiende ese día.',
  BARBERO_NO_PERTENECE_A_SEDE: 'El barbero no está habilitado en esa sede.',
  SEDE_CERRADA: 'La sede está cerrada a esa hora.',
  DIA_NO_LABORABLE: 'Ese día la barbería no abre.',
  ANTELACION_INSUFICIENTE: 'Hay que reservar con más antelación.',
  FECHA_DEMASIADO_LEJANA: 'Todavía no se pueden reservar fechas tan lejanas.',
  RESERVA_EN_EL_PASADO: 'No se puede reservar en una fecha que ya pasó.',
  LIMITE_RESERVAS_ACTIVAS: 'Este cliente ya alcanzó el máximo de reservas activas.',
  ESTADO_RESERVA_INVALIDO: 'La reserva no está en un estado que permita esta acción.',
  FUERA_DE_PLAZO_CANCELACION: 'Ya pasó el plazo para cancelar. Llama a la barbería.',
  FUERA_DE_PLAZO_REPROGRAMACION: 'Ya pasó el plazo para reprogramar. Llama a la barbería.',
  SIN_SERVICIOS: 'Hay que elegir al menos un servicio.',

  DIA_CON_RESERVAS:
    'Ese día ya tiene reservas. Habla con los clientes para reprogramarlas o cancelarlas antes de cerrar el día.',
  BLOQUE_FUERA_DE_JORNADA: 'El bloque tiene que estar dentro de la jornada del día.',
  BLOQUES_SOLAPADOS: 'Ese bloque se cruza con otro ya configurado.',
  CAMBIO_SEDE_CON_RESERVAS:
    'Tienes reservas pendientes en tu sede actual. Reprográmalas o muévelas antes de cambiarte.',

  SELLOS_INSUFICIENTES: 'El cliente todavía no tiene sellos suficientes para el premio.',
  PROGRAMA_FIDELIDAD_INACTIVO: 'El programa de fidelidad está desactivado.',
  SERVICIO_NO_CANJEABLE: 'Ese servicio no se puede pagar con el premio de fidelidad.',
  CANJE_YA_APLICADO: 'Esta reserva ya tiene un premio aplicado.',

  STOCK_INSUFICIENTE: 'No hay suficiente stock de ese producto en esta sede.',
  PRODUCTO_NO_VENDIBLE: 'Ese producto es de consumo interno y no se vende.',
  MOVIMIENTO_INMUTABLE:
    'Los movimientos de inventario no se editan. Registra un ajuste para corregir.',

  VENTA_YA_ANULADA: 'Esa venta ya estaba anulada.',
  PERIODO_CERRADO: 'El periodo contable ya está cerrado.',
  COMISION_SOLAPADA: 'Ya existe un porcentaje vigente para ese barbero en esas fechas.',

  RECURSO_NO_ENCONTRADO: 'No encontramos lo que buscabas.',
  DUPLICADO: 'Ya existe un registro con esos datos.',
  VALIDACION: 'Revisa los datos del formulario.',
  CONFLICTO: 'Otro usuario modificó esta información. Recarga y vuelve a intentarlo.',
  ERROR_INTERNO: 'Ocurrió un error inesperado. Ya quedó registrado para revisarlo.',
  SERVICIO_EXTERNO_CAIDO: 'Un servicio externo no respondió. Inténtalo en un momento.',
  ERROR_RED: 'No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.',
};

/** Forma del cuerpo de error que devuelve siempre la API. */
export interface RespuestaError {
  ok: false;
  codigo: CodigoError | string;
  mensaje: string;
  /** Errores por campo, para pintarlos junto al input correspondiente. */
  campos?: Record<string, string[]>;
  /** Datos extra útiles al frontend (p. ej. horarios alternativos libres). */
  detalle?: unknown;
  statusHttp: number;
  /** Id de correlación: el usuario puede dictarlo al soporte. */
  requestId?: string;
  marcaTiempo: string;
}
