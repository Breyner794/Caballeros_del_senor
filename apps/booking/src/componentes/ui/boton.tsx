import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Botón de la web pública.
 *
 * Mismo lenguaje visual que el del panel, pero pensado para el pulgar: la
 * altura mínima es de 48 px (el panel usa 36), por encima de los 44 px que
 * recomiendan las guías de accesibilidad táctil.
 */
const VARIANTES = {
  primario: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary/95',
  contorno: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
  fantasma: 'hover:bg-accent hover:text-accent-foreground',
  enlace: 'text-primary underline underline-offset-4',
} as const;

export interface PropsBoton extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: keyof typeof VARIANTES;
}

/** Las clases del botón, para dárselas también a un enlace `<a>` que debe verse como botón. */
export const claseBoton = (variante: keyof typeof VARIANTES = 'primario', className?: string) =>
  cn(
    'inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-lg px-5 text-base font-medium outline-none transition-colors',
    'focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50',
    VARIANTES[variante],
    className,
  );

export const Boton = React.forwardRef<HTMLButtonElement, PropsBoton>(
  ({ variante = 'primario', className, type = 'button', ...props }, ref) => (
    <button ref={ref} type={type} className={claseBoton(variante, className)} {...props} />
  ),
);
Boton.displayName = 'Boton';
