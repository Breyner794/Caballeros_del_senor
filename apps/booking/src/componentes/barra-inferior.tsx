import type { ReactNode } from 'react';

/**
 * Barra fija al pie con el total y la acción principal.
 *
 * Va abajo, no al final del contenido, por el pulgar: con una mano el borde
 * inferior de la pantalla es lo único que se alcanza sin cambiar el agarre.
 * El relleno inferior respeta la franja de gestos de iOS y Android.
 */
export function BarraInferior({ children }: { children: ReactNode }) {
  return (
    <footer className="bg-background/95 fixed inset-x-0 bottom-0 z-10 border-t backdrop-blur">
      <div className="mx-auto flex w-full max-w-lg items-center gap-4 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {children}
      </div>
    </footer>
  );
}
