import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Mensaje destacado. `role="alert"` hace que el lector de pantalla lo lea en
 * cuanto aparece, que es lo que se necesita cuando algo falló al enviar.
 */
export function Aviso({
  tono = 'error',
  children,
  className,
}: {
  tono?: 'error' | 'aviso';
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'rounded-lg border px-4 py-3 text-base',
        tono === 'error'
          ? 'border-destructive/40 bg-destructive/5 text-foreground'
          : 'border-aviso/50 bg-aviso/10 text-foreground',
        className,
      )}
    >
      {children}
    </div>
  );
}
