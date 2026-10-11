/**
 * Convierte un texto en un identificador apto para URL.
 * "Caballeros del Señor — Centro" → "caballeros-del-senor-centro"
 */
export function aSlug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita los acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140);
}
