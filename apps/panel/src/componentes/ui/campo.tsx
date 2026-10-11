import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cn } from '@/lib/utils';

export const Etiqueta = React.forwardRef<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn('select-none text-sm font-medium leading-none', className)}
    {...props}
  />
));
Etiqueta.displayName = 'Etiqueta';

const estiloControl =
  'border-input bg-background placeholder:text-muted-foreground/70 w-full rounded-md border px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/25 disabled:cursor-not-allowed disabled:opacity-50';

export const Entrada = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => (
    <input ref={ref} type={type} className={cn(estiloControl, 'h-9 py-1', className)} {...props} />
  ),
);
Entrada.displayName = 'Entrada';

export const AreaTexto = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(estiloControl, 'min-h-[72px] resize-y py-2', className)}
      {...props}
    />
  ),
);
AreaTexto.displayName = 'AreaTexto';

export function ErrorCampo({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <p className="text-destructive text-xs font-medium">{children}</p>;
}

/**
 * Agrupa etiqueta, control, ayuda y error.
 *
 * El error se pinta debajo del control concreto porque la API devuelve los
 * mensajes por campo (`campos: { telefono: [...] }`), así que el formulario
 * puede señalar exactamente qué hay que corregir en lugar de mostrar un aviso
 * genérico arriba.
 */
export function Campo({
  etiqueta,
  error,
  ayuda,
  requerido,
  children,
  className,
}: {
  etiqueta?: string;
  error?: string;
  ayuda?: string;
  requerido?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {etiqueta ? (
        <Etiqueta>
          {etiqueta}
          {requerido ? <span className="text-destructive ml-0.5">*</span> : null}
        </Etiqueta>
      ) : null}
      {children}
      {ayuda && !error ? <p className="text-muted-foreground text-xs">{ayuda}</p> : null}
      <ErrorCampo>{error}</ErrorCampo>
    </div>
  );
}
