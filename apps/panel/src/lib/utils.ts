import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formato de moneda colombiana, sin centavos: los precios son redondos. */
export function pesos(valor: number | string | null | undefined): string {
  if (valor === null || valor === undefined) return '—';
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number(valor));
}

/** "14:30" a partir de un instante ISO, en la zona del navegador. */
export function hora(iso: string | Date): string {
  return new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false }).format(
    new Date(iso),
  );
}

/** "mar 14 oct" */
export function fechaCorta(iso: string | Date): string {
  return new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short' }).format(
    new Date(iso),
  );
}

/** "martes 14 de octubre" */
export function fechaLarga(iso: string | Date): string {
  return new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(iso),
  );
}

/** "hace 3 días", "en 2 semanas" — para la última visita del cliente. */
export function tiempoRelativo(iso: string | Date | null | undefined): string {
  if (!iso) return 'nunca';
  const dias = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat('es-CO', { numeric: 'auto' });
  if (Math.abs(dias) < 31) return rtf.format(dias, 'day');
  if (Math.abs(dias) < 365) return rtf.format(Math.round(dias / 30), 'month');
  return rtf.format(Math.round(dias / 365), 'year');
}

/** AAAA-MM-DD de una fecha, en hora local (no en UTC). */
export function aFechaISO(fecha: Date): string {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function iniciales(nombre: string): string {
  return nombre
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}
