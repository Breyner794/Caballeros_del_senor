import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Scissors } from 'lucide-react';
import { autenticacion, ErrorApi } from '@/lib/api';
import { useSesion } from '@/hooks/sesion';
import { Boton } from '@/componentes/ui/boton';
import { Campo, Entrada } from '@/componentes/ui/campo';

type Vista = 'login' | 'pedirCodigo' | 'restablecer';

/**
 * Acceso al panel.
 *
 * Los tres pasos (entrar, pedir código, restablecer) viven en la misma
 * pantalla en lugar de en rutas separadas: el usuario que olvidó su contraseña
 * ya está aquí, con el correo escrito, y hacerle cambiar de página solo sirve
 * para que lo tenga que teclear otra vez.
 */
export function PaginaEntrar() {
  const { iniciarSesion } = useSesion();
  const navegar = useNavigate();

  const [vista, setVista] = React.useState<Vista>('login');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [codigo, setCodigo] = React.useState('');
  const [passwordNueva, setPasswordNueva] = React.useState('');
  const [confirmacion, setConfirmacion] = React.useState('');

  const [cargando, setCargando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [campos, setCampos] = React.useState<Record<string, string[]>>({});
  const [aviso, setAviso] = React.useState<string | null>(null);

  function limpiar() {
    setError(null);
    setCampos({});
    setAviso(null);
  }

  function manejarError(e: unknown) {
    if (e instanceof ErrorApi) {
      setError(e.mensaje ?? e.message);
      setCampos(e.campos ?? {});
    } else {
      setError('No se pudo conectar con el servidor. Revisa tu conexión.');
    }
  }

  async function entrar(evento: React.FormEvent) {
    evento.preventDefault();
    limpiar();
    setCargando(true);
    try {
      const usuario = await iniciarSesion(email, password);
      // Si el administrador creó la cuenta con contraseña provisional, lo
      // primero es cambiarla: el panel no deja pasar antes de eso.
      navegar(usuario.debeCambiarPassword ? '/perfil?cambiar=1' : '/', { replace: true });
    } catch (e) {
      manejarError(e);
    } finally {
      setCargando(false);
    }
  }

  async function pedirCodigo(evento: React.FormEvent) {
    evento.preventDefault();
    limpiar();
    setCargando(true);
    try {
      const r = await autenticacion.solicitarRecuperacion(email);
      setAviso(r.mensaje);
      setVista('restablecer');
    } catch (e) {
      manejarError(e);
    } finally {
      setCargando(false);
    }
  }

  async function restablecer(evento: React.FormEvent) {
    evento.preventDefault();
    limpiar();
    setCargando(true);
    try {
      await autenticacion.restablecer({ email, codigo, password: passwordNueva, confirmacion });
      setVista('login');
      setPassword('');
      setAviso('Contraseña actualizada. Ya puedes entrar.');
    } catch (e) {
      manejarError(e);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-4">
      {/* Resplandor dorado de fondo, muy tenue */}
      <div
        aria-hidden
        className="bg-primary/10 pointer-events-none fixed top-0 left-1/2 size-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="bg-primary text-primary-foreground flex size-12 items-center justify-center rounded-xl shadow-lg">
            <Scissors className="size-6" />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Caballeros del Señor</h1>
            <p className="text-muted-foreground text-sm">Panel administrativo</p>
          </div>
        </div>

        <div className="bg-card rounded-xl border p-6 shadow-xl">
          {aviso ? (
            <p className="bg-exito/10 text-exito border-exito/25 mb-4 rounded-md border px-3 py-2 text-sm">
              {aviso}
            </p>
          ) : null}

          {error ? (
            <p className="bg-destructive/10 text-destructive border-destructive/25 mb-4 rounded-md border px-3 py-2 text-sm">
              {error}
            </p>
          ) : null}

          {vista === 'login' ? (
            <form onSubmit={entrar} className="space-y-4">
              <Campo etiqueta="Correo electrónico" error={campos.email?.[0]}>
                <Entrada
                  type="email"
                  autoComplete="username"
                  autoFocus
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@correo.com"
                />
              </Campo>

              <Campo etiqueta="Contraseña" error={campos.password?.[0]}>
                <Entrada
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </Campo>

              <Boton type="submit" className="w-full" cargando={cargando}>
                Entrar
              </Boton>

              <button
                type="button"
                className="text-muted-foreground hover:text-foreground w-full text-center text-xs transition-colors"
                onClick={() => {
                  limpiar();
                  setVista('pedirCodigo');
                }}
              >
                Olvidé mi contraseña
              </button>
            </form>
          ) : null}

          {vista === 'pedirCodigo' ? (
            <form onSubmit={pedirCodigo} className="space-y-4">
              <p className="text-muted-foreground text-sm">
                Escribe tu correo y te enviamos un código de 6 dígitos para crear una contraseña
                nueva.
              </p>

              <Campo etiqueta="Correo electrónico" error={campos.email?.[0]}>
                <Entrada
                  type="email"
                  autoFocus
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@correo.com"
                />
              </Campo>

              <Boton type="submit" className="w-full" cargando={cargando}>
                Enviarme el código
              </Boton>

              <Boton
                type="button"
                variante="fantasma"
                tamano="sm"
                className="w-full"
                onClick={() => {
                  limpiar();
                  setVista('login');
                }}
              >
                <ArrowLeft />
                Volver
              </Boton>
            </form>
          ) : null}

          {vista === 'restablecer' ? (
            <form onSubmit={restablecer} className="space-y-4">
              <Campo etiqueta="Código de 6 dígitos" error={campos.codigo?.[0]}>
                <Entrada
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                  required
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  className="tabular text-center text-lg tracking-[0.5em]"
                />
              </Campo>

              <Campo
                etiqueta="Contraseña nueva"
                error={campos.password?.[0]}
                ayuda="Mínimo 10 caracteres, con mayúscula, minúscula y número."
              >
                <Entrada
                  type="password"
                  autoComplete="new-password"
                  required
                  value={passwordNueva}
                  onChange={(e) => setPasswordNueva(e.target.value)}
                />
              </Campo>

              <Campo etiqueta="Repite la contraseña" error={campos.confirmacion?.[0]}>
                <Entrada
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmacion}
                  onChange={(e) => setConfirmacion(e.target.value)}
                />
              </Campo>

              <Boton type="submit" className="w-full" cargando={cargando}>
                Guardar contraseña
              </Boton>

              <Boton
                type="button"
                variante="fantasma"
                tamano="sm"
                className="w-full"
                onClick={() => {
                  limpiar();
                  setVista('login');
                }}
              >
                <ArrowLeft />
                Volver
              </Boton>
            </form>
          ) : null}
        </div>

        <p className="text-muted-foreground mt-6 text-center text-xs">
          ¿Problemas para entrar? Habla con el administrador de la barbería.
        </p>
      </div>
    </div>
  );
}
