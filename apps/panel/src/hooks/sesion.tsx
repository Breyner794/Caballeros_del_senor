import * as React from 'react';
import type { Permiso, UsuarioSesion } from '@cds/shared';
import { autenticacion, registrarCierreForzado } from '@/lib/api';

interface ContextoSesion {
  usuario: UsuarioSesion | null;
  cargando: boolean;
  iniciarSesion: (email: string, password: string) => Promise<UsuarioSesion>;
  cerrarSesion: () => Promise<void>;
  /** Tras cambiar de sede o de datos, refresca lo que el panel tiene en mano. */
  recargarUsuario: () => Promise<void>;
  puede: (...permisos: Permiso[]) => boolean;
}

const Contexto = React.createContext<ContextoSesion | null>(null);

/**
 * Sesión del panel.
 *
 * Al arrancar intenta recuperar la sesión con la cookie de refresco. Eso es lo
 * que permite que el access token viva solo en memoria: recargar la página no
 * obliga a volver a escribir la contraseña, pero tampoco deja nada legible por
 * un script en el navegador.
 */
export function ProveedorSesion({ children }: { children: React.ReactNode }) {
  const [usuario, setUsuario] = React.useState<UsuarioSesion | null>(null);
  const [cargando, setCargando] = React.useState(true);

  React.useEffect(() => {
    let vivo = true;

    // Si la API avisa de que la sesión murió (refresh revocado, usuario
    // desactivado), se limpia el estado y el enrutador manda al login.
    registrarCierreForzado(() => {
      if (vivo) setUsuario(null);
    });

    void autenticacion.recuperarSesion().then((datos) => {
      if (!vivo) return;
      setUsuario(datos?.usuario ?? null);
      setCargando(false);
    });

    return () => {
      vivo = false;
    };
  }, []);

  const valor = React.useMemo<ContextoSesion>(
    () => ({
      usuario,
      cargando,
      async iniciarSesion(email, password) {
        const datos = await autenticacion.iniciarSesion(email, password);
        setUsuario(datos.usuario);
        return datos.usuario;
      },
      async cerrarSesion() {
        await autenticacion.cerrarSesion();
        setUsuario(null);
      },
      async recargarUsuario() {
        const datos = await autenticacion.recuperarSesion();
        setUsuario(datos?.usuario ?? null);
      },
      puede: (...permisos) =>
        usuario ? permisos.every((p) => usuario.permisos.includes(p)) : false,
    }),
    [usuario, cargando],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSesion(): ContextoSesion {
  const contexto = React.useContext(Contexto);
  if (!contexto) throw new Error('useSesion debe usarse dentro de ProveedorSesion');
  return contexto;
}
