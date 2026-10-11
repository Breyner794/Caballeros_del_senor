import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const variantes = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium outline-none transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
  {
    variants: {
      variante: {
        primario:
          'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary/95',
        secundario: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        contorno: 'border border-input bg-transparent hover:bg-accent hover:text-accent-foreground',
        fantasma: 'hover:bg-accent hover:text-accent-foreground',
        destructivo: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
        enlace: 'text-primary underline-offset-4 hover:underline',
      },
      tamano: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-4',
        lg: 'h-11 px-6 text-base',
        icono: 'size-9',
        iconoSm: 'size-8',
      },
    },
    defaultVariants: { variante: 'primario', tamano: 'md' },
  },
);

export interface PropsBoton
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof variantes> {
  comoHijo?: boolean;
  cargando?: boolean;
}

export const Boton = React.forwardRef<HTMLButtonElement, PropsBoton>(
  (
    { className, variante, tamano, comoHijo = false, cargando = false, children, disabled, ...props },
    ref,
  ) => {
    const Comp = comoHijo ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(variantes({ variante, tamano }), className)}
        disabled={disabled || cargando}
        {...props}
      >
        {cargando ? <Loader2 className="animate-spin" /> : null}
        {children}
      </Comp>
    );
  },
);
Boton.displayName = 'Boton';

export { variantes as variantesBoton };
