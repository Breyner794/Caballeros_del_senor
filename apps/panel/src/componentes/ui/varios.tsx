import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as SeparatorPrimitive from '@radix-ui/react-separator';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cva, type VariantProps } from 'class-variance-authority';
import { Check, ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================== Insignia ===================================

const variantesInsignia = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      variante: {
        neutra: 'bg-secondary text-secondary-foreground border-transparent',
        contorno: 'border-border text-foreground',
        primaria: 'bg-primary/10 text-primary border-primary/25',
        exito: 'bg-exito/10 text-exito border-exito/30',
        info: 'bg-sky-600/10 text-sky-700 border-sky-600/30 dark:text-sky-400',
        aviso: 'bg-aviso/10 text-aviso border-aviso/30',
        peligro: 'bg-destructive/10 text-destructive border-destructive/30',
      },
    },
    defaultVariants: { variante: 'neutra' },
  },
);

export function Insignia({
  className,
  variante,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof variantesInsignia>) {
  return <span className={cn(variantesInsignia({ variante }), className)} {...props} />;
}

// ============================== Esqueleto ==================================

/** Marcador de carga: mantiene la altura para que la pantalla no salte. */
export function Esqueleto({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('bg-muted animate-pulse rounded-md', className)} {...props} />;
}

// ============================== Separador ==================================

export const Separador = React.forwardRef<
  React.ComponentRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(({ className, orientation = 'horizontal', decorative = true, ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    decorative={decorative}
    orientation={orientation}
    className={cn(
      'bg-border shrink-0',
      orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
      className,
    )}
    {...props}
  />
));
Separador.displayName = 'Separador';

// =============================== Diálogo ===================================

export const Dialogo = DialogPrimitive.Root;
export const DialogoDisparador = DialogPrimitive.Trigger;
export const DialogoCerrar = DialogPrimitive.Close;

export const DialogoContenido = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { anchoMaximo?: string }
>(({ className, children, anchoMaximo = 'max-w-lg', ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'bg-card data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-1/2 left-1/2 z-50 flex max-h-[92vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-xl border p-6 shadow-2xl duration-150',
        anchoMaximo,
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="hover:bg-accent absolute top-4 right-4 rounded-md p-1 opacity-60 transition-opacity hover:opacity-100">
        <X className="size-4" />
        <span className="sr-only">Cerrar</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogoContenido.displayName = 'DialogoContenido';

export function DialogoCabecera({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1.5 pr-8', className)} {...props} />;
}

export const DialogoTitulo = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg leading-none font-semibold tracking-tight', className)}
    {...props}
  />
));
DialogoTitulo.displayName = 'DialogoTitulo';

export const DialogoDescripcion = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-muted-foreground text-sm', className)}
    {...props}
  />
));
DialogoDescripcion.displayName = 'DialogoDescripcion';

export function DialogoPie({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

// ============================== Selector ===================================

export const Selector = SelectPrimitive.Root;
export const SelectorValor = SelectPrimitive.Value;

export const SelectorDisparador = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      'border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 flex h-9 w-full items-center justify-between gap-2 rounded-md border px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 [&>span]:truncate',
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="size-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectorDisparador.displayName = 'SelectorDisparador';

export const SelectorContenido = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      className={cn(
        'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 relative z-50 max-h-72 min-w-[8rem] overflow-y-auto rounded-md border shadow-lg',
        position === 'popper' && 'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectorContenido.displayName = 'SelectorContenido';

export const SelectorOpcion = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'focus:bg-accent focus:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    <span className="absolute right-2 flex size-4 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="size-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
  </SelectPrimitive.Item>
));
SelectorOpcion.displayName = 'SelectorOpcion';

// ============================== Pestañas ===================================

export const Pestanas = TabsPrimitive.Root;

export const PestanasLista = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn('bg-muted text-muted-foreground inline-flex h-9 items-center gap-1 rounded-lg p-1', className)}
    {...props}
  />
));
PestanasLista.displayName = 'PestanasLista';

export const PestanaDisparador = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'data-[state=active]:bg-background data-[state=active]:text-foreground inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium whitespace-nowrap transition-all data-[state=active]:shadow-sm',
      className,
    )}
    {...props}
  />
));
PestanaDisparador.displayName = 'PestanaDisparador';

export const PestanaContenido = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn('outline-none', className)} {...props} />
));
PestanaContenido.displayName = 'PestanaContenido';

// =============================== Avatar ====================================

export function Avatar({
  nombre,
  url,
  className,
}: {
  nombre: string;
  url?: string | null;
  className?: string;
}) {
  const iniciales = nombre
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <span
      className={cn(
        'bg-secondary text-secondary-foreground inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold select-none',
        className,
      )}
    >
      {url ? <img src={url} alt={nombre} className="size-full object-cover" /> : iniciales}
    </span>
  );
}

// ============================ Estado vacío =================================

/**
 * Lo que se ve cuando una lista está vacía.
 *
 * Siempre con una acción: una pantalla vacía sin salida deja al usuario sin
 * saber qué hacer, y en un panel nuevo (recién instalado, sin datos) eso es
 * justo lo primero que se encuentra.
 */
export function EstadoVacio({
  icono: Icono,
  titulo,
  descripcion,
  children,
}: {
  icono: React.ComponentType<{ className?: string }>;
  titulo: string;
  descripcion?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <span className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
        <Icono className="size-6" />
      </span>
      <div className="space-y-1">
        <p className="font-medium">{titulo}</p>
        {descripcion ? (
          <p className="text-muted-foreground mx-auto max-w-sm text-sm">{descripcion}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/**
 * Qué variante de insignia le toca a cada estado de una cita.
 *
 * Va aquí, como dato tipado, y no como clases CSS en la capa "components":
 * las utilidades de Tailwind tienen más precedencia que esa capa, así que una
 * clase "estado-X" quedaría pisada por el fondo que la propia insignia aplica
 * como utilidad, y todos los estados se verían iguales.
 *
 * El criterio de color: solo lo lleva el estado que pide una reacción
 * distinta. Una cita confirmada es lo normal y va en neutro.
 */
export const VARIANTE_POR_ESTADO = {
  PENDIENTE: 'aviso',
  CONFIRMADA: 'neutra',
  EN_CURSO: 'info',
  COMPLETADA: 'exito',
  CANCELADA: 'neutra',
  NO_ASISTIO: 'peligro',
} as const satisfies Record<string, VariantProps<typeof variantesInsignia>['variante']>;
