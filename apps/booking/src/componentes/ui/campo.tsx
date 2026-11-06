import * as React from 'react';
import { cn } from '@/lib/utils';

const estiloControl =
  // 16 px como mínimo: con menos, Safari en iPhone amplía la pantalla al enfocar el campo.
  'border-input bg-background placeholder:text-muted-foreground/70 w-full rounded-lg border px-3.5 text-base shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/25 disabled:cursor-not-allowed disabled:opacity-50';

export const Entrada = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(estiloControl, 'h-12', className)} {...props} />
  ),
);
Entrada.displayName = 'Entrada';

export const AreaTexto = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(estiloControl, 'min-h-24 py-3', className)} {...props} />
  ),
);
AreaTexto.displayName = 'AreaTexto';

export const Selector = React.forwardRef<HTMLSelectElement, React.ComponentProps<'select'>>(
  ({ className, ...props }, ref) => (
    // El `<select>` nativo, a propósito: en el móvil abre el selector del sistema, que es el más cómodo.
    <select ref={ref} className={cn(estiloControl, 'h-12', className)} {...props} />
  ),
);
Selector.displayName = 'Selector';

interface PropsControl {
  id: string;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
}

/**
 * Agrupa etiqueta, control, ayuda y error, y enlaza todo con `id` y
 * `aria-describedby` para que el lector de pantalla lea el error del campo.
 */
export function Campo({
  etiqueta,
  error,
  ayuda,
  requerido,
  children,
}: {
  etiqueta: string;
  error?: string;
  ayuda?: string;
  requerido?: boolean;
  children: (props: PropsControl) => React.ReactNode;
}) {
  const id = React.useId();
  const idMensaje = `${id}-mensaje`;
  const mensaje = error ?? ayuda;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {etiqueta}
        {requerido ? <span className="text-destructive ml-0.5">*</span> : null}
      </label>
      {children({
        id,
        ...(error ? { 'aria-invalid': true as const } : {}),
        ...(mensaje ? { 'aria-describedby': idMensaje } : {}),
      })}
      {mensaje ? (
        <p
          id={idMensaje}
          className={cn('text-sm', error ? 'text-destructive font-medium' : 'text-muted-foreground')}
        >
          {mensaje}
        </p>
      ) : null}
    </div>
  );
}
