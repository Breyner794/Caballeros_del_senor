import * as React from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  CalendarDays,
  CalendarRange,
  Clock,
  LogOut,
  Menu,
  Package,
  Scissors,
  Settings,
  ShieldAlert,
  Store,
  Users,
  UserRound,
  X,
} from 'lucide-react';
import type { Permiso } from '@cds/shared';
import { cn } from '@/lib/utils';
import { useSesion } from '@/hooks/sesion';
import { Boton } from '@/componentes/ui/boton';
import { Avatar, Separador } from '@/componentes/ui/varios';

interface Enlace {
  a: string;
  texto: string;
  icono: React.ComponentType<{ className?: string }>;
  permiso?: Permiso;
  /** Agrupación visual del menú. */
  grupo: 'operacion' | 'catalogo' | 'gestion';
}

/**
 * Menú del panel.
 *
 * El orden no es alfabético: es el del día de trabajo. Lo primero que abre un
 * barbero por la mañana es la agenda del día, y lo que menos toca es la
 * configuración. Cada entrada declara el permiso que necesita, así que el
 * mismo menú sirve para los cuatro roles sin condicionales repartidos.
 */
const ENLACES: Enlace[] = [
  { a: '/', texto: 'Hoy', icono: CalendarDays, grupo: 'operacion' },
  { a: '/reservas', texto: 'Reservas', icono: CalendarRange, permiso: 'reservas:ver', grupo: 'operacion' },
  { a: '/disponibilidad', texto: 'Disponibilidad', icono: Clock, permiso: 'disponibilidad:ver', grupo: 'operacion' },
  { a: '/clientes', texto: 'Clientes', icono: Users, permiso: 'clientes:ver', grupo: 'operacion' },

  { a: '/servicios', texto: 'Servicios', icono: Scissors, permiso: 'servicios:ver', grupo: 'catalogo' },
  { a: '/cronograma', texto: 'Cronograma', icono: Clock, permiso: 'agenda:ver', grupo: 'catalogo' },
  { a: '/inventario', texto: 'Inventario', icono: Package, permiso: 'inventario:ver', grupo: 'catalogo' },

  { a: '/contabilidad', texto: 'Contabilidad', icono: BarChart3, permiso: 'contabilidad:ver', grupo: 'gestion' },
  { a: '/sedes', texto: 'Sedes', icono: Store, permiso: 'sedes:ver', grupo: 'gestion' },
  { a: '/usuarios', texto: 'Usuarios', icono: UserRound, permiso: 'usuarios:gestionar', grupo: 'gestion' },
  { a: '/auditoria', texto: 'Auditoría', icono: ShieldAlert, permiso: 'auditoria:ver', grupo: 'gestion' },
  { a: '/configuracion', texto: 'Configuración', icono: Settings, permiso: 'configuracion:ver', grupo: 'gestion' },
];

const TITULOS_GRUPO: Record<Enlace['grupo'], string> = {
  operacion: 'Día a día',
  catalogo: 'Catálogo',
  gestion: 'Gestión',
};

export function Armazon() {
  const { usuario, cerrarSesion, puede } = useSesion();
  const navegar = useNavigate();
  const ubicacion = useLocation();
  const [menuAbierto, setMenuAbierto] = React.useState(false);

  // En móvil el menú se cierra al navegar: si no, tapa la pantalla a la que
  // acabas de llegar.
  React.useEffect(() => setMenuAbierto(false), [ubicacion.pathname]);

  const visibles = ENLACES.filter((e) => !e.permiso || puede(e.permiso));
  const grupos = ['operacion', 'catalogo', 'gestion'] as const;

  async function salir() {
    await cerrarSesion();
    navegar('/entrar', { replace: true });
  }

  return (
    <div className="bg-background flex min-h-screen">
      {/* Fondo oscuro del menú en móvil */}
      {menuAbierto ? (
        <button
          type="button"
          aria-label="Cerrar menú"
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMenuAbierto(false)}
        />
      ) : null}

      <aside
        className={cn(
          'bg-card fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r transition-transform duration-200 lg:static lg:translate-x-0',
          menuAbierto ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 items-center gap-2.5 px-5">
          <span className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-lg">
            <Scissors className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm leading-tight font-semibold">Caballeros</p>
            <p className="text-muted-foreground truncate text-xs leading-tight">del Señor</p>
          </div>
          <Boton
            variante="fantasma"
            tamano="iconoSm"
            className="lg:hidden"
            onClick={() => setMenuAbierto(false)}
          >
            <X />
          </Boton>
        </div>

        <Separador />

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {grupos.map((grupo) => {
            const delGrupo = visibles.filter((e) => e.grupo === grupo);
            if (delGrupo.length === 0) return null;

            return (
              <div key={grupo} className="mb-5">
                <p className="text-muted-foreground mb-1.5 px-2 text-[11px] font-semibold tracking-wider uppercase">
                  {TITULOS_GRUPO[grupo]}
                </p>
                <ul className="space-y-0.5">
                  {delGrupo.map((enlace) => (
                    <li key={enlace.a}>
                      <NavLink
                        to={enlace.a}
                        end={enlace.a === '/'}
                        className={({ isActive }) =>
                          cn(
                            'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                            isActive
                              ? 'bg-accent text-foreground font-semibold'
                              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                          )
                        }
                      >
                        <enlace.icono className="size-4 shrink-0" />
                        {enlace.texto}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>

        <Separador />

        <div className="p-3">
          <Link
            to="/perfil"
            className="hover:bg-accent flex items-center gap-2.5 rounded-md p-2 transition-colors"
          >
            <Avatar nombre={usuario?.nombre ?? '?'} url={usuario?.fotoUrl} className="size-8" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm leading-tight font-medium">
                {usuario?.alias ?? usuario?.nombre}
              </p>
              <p className="text-muted-foreground truncate text-xs leading-tight">
                {usuario?.sedeNombre ?? etiquetaRol(usuario?.rol)}
              </p>
            </div>
          </Link>
          <Boton
            variante="fantasma"
            tamano="sm"
            className="text-muted-foreground mt-1 w-full justify-start"
            onClick={() => void salir()}
          >
            <LogOut />
            Cerrar sesión
          </Boton>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/80 sticky top-0 z-20 flex h-16 items-center gap-3 border-b px-4 backdrop-blur lg:hidden">
          <Boton variante="fantasma" tamano="icono" onClick={() => setMenuAbierto(true)}>
            <Menu />
          </Boton>
          <span className="font-semibold">Caballeros del Señor</span>
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function etiquetaRol(rol?: string): string {
  const mapa: Record<string, string> = {
    ADMIN: 'Administrador',
    RECEPCIONISTA: 'Recepcionista',
    BARBERO: 'Barbero',
    CONTADOR: 'Contador',
  };
  return rol ? (mapa[rol] ?? rol) : '';
}

/** Encabezado de página, con título, descripción y acciones a la derecha. */
export function Encabezado({
  titulo,
  descripcion,
  children,
}: {
  titulo: string;
  descripcion?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
        {descripcion ? <p className="text-muted-foreground text-sm">{descripcion}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}
