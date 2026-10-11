/**
 * Normalización de teléfonos.
 *
 * El teléfono es la llave natural del cliente: es lo único que la recepción
 * pide y lo que se usa para buscarlo y para notificarle por WhatsApp. Si se
 * guarda tal cual lo escriben, el mismo cliente acaba tres veces en la base
 * ("3001234567", "300 123 4567", "+57 300-123-4567"). Todo entra en E.164.
 */

/** Indicativo por defecto (Colombia). Configurable si algún día hace falta. */
export const INDICATIVO_DEFECTO = '57';

/** Longitud del número nacional colombiano de celular, sin indicativo. */
const LONGITUD_NACIONAL_CO = 10;

export interface ResultadoTelefono {
  valido: boolean;
  /** Formato canónico para guardar y enviar a WhatsApp: +573001234567 */
  e164?: string;
  /** Formato legible para mostrar en pantalla: 300 123 4567 */
  visible?: string;
  motivo?: string;
}

export function normalizarTelefono(
  entrada: string | null | undefined,
  indicativo = INDICATIVO_DEFECTO,
): ResultadoTelefono {
  if (!entrada) return { valido: false, motivo: 'El teléfono es obligatorio' };

  const soloDigitos = entrada.replace(/\D/g, '');
  if (soloDigitos.length === 0) {
    return { valido: false, motivo: 'El teléfono no contiene dígitos' };
  }

  let nacional: string;
  if (soloDigitos.startsWith(indicativo) && soloDigitos.length > LONGITUD_NACIONAL_CO) {
    nacional = soloDigitos.slice(indicativo.length);
  } else if (soloDigitos.startsWith('0' + indicativo)) {
    nacional = soloDigitos.slice(indicativo.length + 1);
  } else {
    nacional = soloDigitos;
  }

  if (nacional.length !== LONGITUD_NACIONAL_CO) {
    return {
      valido: false,
      motivo: `El número debe tener ${LONGITUD_NACIONAL_CO} dígitos (recibidos ${nacional.length})`,
    };
  }

  if (!nacional.startsWith('3')) {
    return { valido: false, motivo: 'Un celular colombiano empieza por 3' };
  }

  return {
    valido: true,
    e164: `+${indicativo}${nacional}`,
    visible: `${nacional.slice(0, 3)} ${nacional.slice(3, 6)} ${nacional.slice(6)}`,
  };
}

/** Para mostrar: +573001234567 → 300 123 4567 */
export function telefonoVisible(e164: string | null | undefined): string {
  if (!e164) return '—';
  const resultado = normalizarTelefono(e164);
  return resultado.visible ?? e164;
}

/** Enlace directo a WhatsApp con un mensaje opcional prerrellenado. */
export function enlaceWhatsapp(e164: string, mensaje?: string): string {
  const numero = e164.replace(/\D/g, '');
  const base = `https://wa.me/${numero}`;
  return mensaje ? `${base}?text=${encodeURIComponent(mensaje)}` : base;
}
