import { customAlphabet } from 'nanoid';

/**
 * Codigo de reserva legible para el cliente: CDS-7F3K2M.
 *
 * Se excluyen las letras y numeros que se confunden al dictarlos por telefono
 * (0/O, 1/I/L, 5/S, 8/B): el cliente llama diciendo "mi codigo es ..." y la
 * recepcion tiene que poder teclearlo sin equivocarse.
 */
const alfabetoLegible = '234679ACDEFGHJKMNPQRTUVWXYZ';
const generar = customAlphabet(alfabetoLegible, 6);

export function codigoReserva(): string {
  return `CDS-${generar()}`;
}

/** Token opaco para que el cliente gestione su reserva sin iniciar sesion. */
const generarToken = customAlphabet('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 48);

export function tokenGestion(): string {
  return generarToken();
}
