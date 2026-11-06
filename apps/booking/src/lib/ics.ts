import type { ReservaPublica } from '@cds/shared';

/**
 * Archivo `.ics` de la cita, generado en el navegador: no hace falta un
 * endpoint, porque todo lo que lleva ya está en la reserva que devolvió la API.
 */

/** RFC 5545: se escapan la barra, la coma, el punto y coma y los saltos de línea. */
function escapar(texto: string): string {
  return texto
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** `2026-11-10T14:30:00.000Z` → `20261110T143000Z` */
function enUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function generarIcs(reserva: ReservaPublica): string {
  const lugar = [reserva.sede.nombre, reserva.sede.direccion].filter(Boolean).join(', ');
  const descripcion = [
    `Código de tu cita: ${reserva.codigo}`,
    `Servicios: ${reserva.servicios.map((s) => s.nombre).join(', ')}`,
    `Barbero: ${reserva.barbero.nombre}`,
  ].join('\n');

  const lineas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Caballeros del Señor//Reservas//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${reserva.codigo}@caballerosdelsenor`,
    `DTSTAMP:${enUtc(new Date().toISOString())}`,
    `DTSTART:${enUtc(reserva.inicioEn)}`,
    `DTEND:${enUtc(reserva.finEn)}`,
    `SUMMARY:${escapar('Cita en Caballeros del Señor')}`,
    `LOCATION:${escapar(lugar)}`,
    `DESCRIPTION:${escapar(descripcion)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lineas.join('\r\n')}\r\n`;
}

/** Entrega el `.ics` al navegador como una descarga. */
export function descargarIcs(reserva: ReservaPublica): void {
  const blob = new Blob([generarIcs(reserva)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = `cita-${reserva.codigo}.ics`;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(url);
}
