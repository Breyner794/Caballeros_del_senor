import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { KeyRound, Monitor, Phone, Save, TriangleAlert } from 'lucide-react';
import { ETIQUETAS_ROL, telefonoVisible } from '@cds/shared';
import { api, autenticacion, ErrorApi } from '@/lib/api';
import { tiempoRelativo } from '@/lib/utils';
import { useSesion } from '@/hooks/sesion';
import { Encabezado } from '@/componentes/armazon';
import { Boton } from '@/componentes/ui/boton';
import { AreaTexto, Campo, Entrada } from '@/componentes/ui/campo';
import {
  Tarjeta,
  TarjetaCabecera,
  TarjetaContenido,
  TarjetaDescripcion,
  TarjetaTitulo,
} from '@/componentes/ui/tarjeta';
import {
  Avatar,
  Dialogo,
  DialogoCabecera,
  DialogoContenido,
  DialogoDescripcion,
  DialogoPie,
  DialogoTitulo,
  Esqueleto,
  Insignia,
  Selector,
  SelectorContenido,
  SelectorDisparador,
  SelectorOpcion,
  SelectorValor,
} from '@/componentes/ui/varios';
import type { UsuarioPanel } from '@/paginas/usuarios';

interface CitaPendiente {
  id: string;
  codigo: string;
  fechaLegible: string;
  cliente: string;
  telefono: string;
  sede: string;
}

interface Sesion {
  id: string;
  ip: string | null;
  userAgent: string | null;
  creadoEn: string;
  expiraEn: string;
}

/**
 * Mi perfil.
 *
 * Lo que cada persona puede cambiar de sí misma. El cambio de sede es el punto
 * delicado: un barbero no puede mudarse de local dejando citas colgadas en el
 * anterior, y la API lo impide devolviendo la lista de clientes a los que hay
 * que llamar.
 */
export function PaginaPerfil() {
  const { usuario, recargarUsuario } = useSesion();
  const cliente = useQueryClient();
  const [parametros] = useSearchParams();

  // Si el administrador creó la cuenta con contraseña provisional, el panel
  // llega aquí con el diálogo ya abierto.
  const [cambiandoPassword, setCambiandoPassword] = React.useState(
    parametros.get('cambiar') === '1' || Boolean(usuario?.debeCambiarPassword),
  );
  const [bloqueoSede, setBloqueoSede] = React.useState<{
    mensaje: string;
    citas: CitaPendiente[];
  } | null>(null);
  const [guardado, setGuardado] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [campos, setCampos] = React.useState<Record<string, string[]>>({});

  const { data: perfil, isLoading } = useQuery({
    queryKey: ['mi-perfil'],
    queryFn: () => api.get<UsuarioPanel>('/usuarios/mi-perfil'),
  });

  const { data: sesiones } = useQuery({
    queryKey: ['mis-sesiones'],
    queryFn: () => api.get<Sesion[]>('/usuarios/mis-sesiones'),
  });

  const [nombre, setNombre] = React.useState('');
  const [apellido, setApellido] = React.useState('');
  const [telefono, setTelefono] = React.useState('');
  const [alias, setAlias] = React.useState('');
  const [bio, setBio] = React.useState('');
  const [sedeId, setSedeId] = React.useState('');
  const [slotMinutos, setSlotMinutos] = React.useState('');

  React.useEffect(() => {
    if (!perfil) return;
    setNombre(perfil.nombre);
    setApellido(perfil.apellido ?? '');
    setTelefono(perfil.telefono);
    setAlias(perfil.alias ?? '');
    setBio(perfil.bio ?? '');
    setSedeId(perfil.sedeId ?? '');
    setSlotMinutos(perfil.slotMinutos ? String(perfil.slotMinutos) : '');
  }, [perfil]);

  const guardar = useMutation({
    mutationFn: () =>
      api.patch<UsuarioPanel>('/usuarios/mi-perfil', {
        nombre,
        apellido: apellido || undefined,
        telefono,
        alias: alias || undefined,
        bio: bio || undefined,
        sedeId: sedeId || undefined,
        slotMinutos: slotMinutos ? Number(slotMinutos) : null,
      }),
    onSuccess: async () => {
      setGuardado(true);
      setError(null);
      setCampos({});
      setTimeout(() => setGuardado(false), 2500);
      void cliente.invalidateQueries({ queryKey: ['mi-perfil'] });
      await recargarUsuario();
    },
    onError: (e) => {
      if (e instanceof ErrorApi) {
        if (e.codigo === 'CAMBIO_SEDE_CON_RESERVAS') {
          const detalle = e.detalle as { citas?: CitaPendiente[] } | undefined;
          setBloqueoSede({ mensaje: e.mensaje, citas: detalle?.citas ?? [] });
          return;
        }
        setError(e.mensaje);
        setCampos(e.campos ?? {});
      } else {
        setError('No se pudo guardar.');
      }
    },
  });

  if (isLoading || !perfil) {
    return (
      <>
        <Encabezado titulo="Mi perfil" />
        <Esqueleto className="h-96 w-full" />
      </>
    );
  }

  const sedesDisponibles = [
    ...(perfil.sede ? [perfil.sede] : []),
    ...perfil.sedesPermitidas.map((s) => s.sede),
  ];

  return (
    <>
      <Encabezado titulo="Mi perfil" descripcion="Tus datos y tu acceso al panel." />

      {perfil.debeCambiarPassword ? (
        <div className="bg-aviso/10 border-aviso/30 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
          <p className="text-aviso flex items-center gap-2 text-sm font-medium">
            <TriangleAlert className="size-4" />
            Tu contraseña es provisional. Cámbiala por una tuya.
          </p>
          <Boton tamano="sm" onClick={() => setCambiandoPassword(true)}>
            Cambiarla ahora
          </Boton>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Tarjeta>
            <TarjetaCabecera>
              <TarjetaTitulo>Tus datos</TarjetaTitulo>
            </TarjetaCabecera>
            <TarjetaContenido className="space-y-4">
              {error ? (
                <p className="bg-destructive/10 text-destructive border-destructive/25 rounded-md border px-3 py-2 text-sm">
                  {error}
                </p>
              ) : null}

              <div className="flex items-center gap-3">
                <Avatar nombre={perfil.nombre} url={perfil.fotoUrl} className="size-14 text-base" />
                <div>
                  <p className="font-medium">
                    {perfil.nombre} {perfil.apellido ?? ''}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {perfil.email} · <Insignia>{ETIQUETAS_ROL[perfil.rol]}</Insignia>
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Campo etiqueta="Nombre" requerido error={campos.nombre?.[0]}>
                  <Entrada value={nombre} onChange={(e) => setNombre(e.target.value)} />
                </Campo>
                <Campo etiqueta="Apellido" error={campos.apellido?.[0]}>
                  <Entrada value={apellido} onChange={(e) => setApellido(e.target.value)} />
                </Campo>
                <Campo etiqueta="Celular" requerido error={campos.telefono?.[0]}>
                  <Entrada value={telefono} onChange={(e) => setTelefono(e.target.value)} />
                </Campo>
                <Campo etiqueta="Correo" ayuda="Lo cambia un administrador.">
                  <Entrada value={perfil.email} disabled />
                </Campo>
              </div>

              {perfil.rol === 'BARBERO' ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Campo etiqueta="Alias" ayuda="Como te conocen los clientes.">
                      <Entrada value={alias} onChange={(e) => setAlias(e.target.value)} />
                    </Campo>
                    <Campo
                      etiqueta="Duración de tus turnos"
                      ayuda="Vacío = usas el valor general de la barbería."
                    >
                      <div className="flex items-center gap-2">
                        <Entrada
                          type="number"
                          min={5}
                          max={240}
                          step={5}
                          className="w-24"
                          value={slotMinutos}
                          onChange={(e) => setSlotMinutos(e.target.value)}
                          placeholder="hereda"
                        />
                        <span className="text-muted-foreground text-sm">min</span>
                      </div>
                    </Campo>
                  </div>

                  <Campo etiqueta="Presentación" ayuda="Se muestra en la web del cliente.">
                    <AreaTexto rows={3} value={bio} onChange={(e) => setBio(e.target.value)} />
                  </Campo>
                </>
              ) : null}

              {sedesDisponibles.length > 1 ? (
                <Campo
                  etiqueta="Sede donde atiendes"
                  ayuda="Solo puedes cambiarte si no tienes citas por atender en la sede actual."
                >
                  <Selector value={sedeId} onValueChange={setSedeId}>
                    <SelectorDisparador>
                      <SelectorValor />
                    </SelectorDisparador>
                    <SelectorContenido>
                      {sedesDisponibles.map((s) => (
                        <SelectorOpcion key={s.id} value={s.id}>
                          {s.nombre}
                        </SelectorOpcion>
                      ))}
                    </SelectorContenido>
                  </Selector>
                </Campo>
              ) : perfil.sede ? (
                <Campo etiqueta="Sede">
                  <Entrada value={perfil.sede.nombre} disabled />
                </Campo>
              ) : null}

              <div className="flex items-center justify-end gap-3">
                {guardado ? <span className="text-exito text-sm">Guardado</span> : null}
                <Boton cargando={guardar.isPending} onClick={() => guardar.mutate()}>
                  <Save />
                  Guardar cambios
                </Boton>
              </div>
            </TarjetaContenido>
          </Tarjeta>
        </div>

        <div className="space-y-4">
          <Tarjeta>
            <TarjetaCabecera>
              <TarjetaTitulo>Contraseña</TarjetaTitulo>
              <TarjetaDescripcion>
                Al cambiarla se cierran todas tus sesiones, también esta.
              </TarjetaDescripcion>
            </TarjetaCabecera>
            <TarjetaContenido>
              <Boton variante="contorno" className="w-full" onClick={() => setCambiandoPassword(true)}>
                <KeyRound />
                Cambiar mi contraseña
              </Boton>
            </TarjetaContenido>
          </Tarjeta>

          <Tarjeta>
            <TarjetaCabecera>
              <TarjetaTitulo>Sesiones abiertas</TarjetaTitulo>
              <TarjetaDescripcion>
                Dispositivos donde tu cuenta está entrada ahora mismo.
              </TarjetaDescripcion>
            </TarjetaCabecera>
            <TarjetaContenido className="space-y-3">
              <ul className="space-y-2">
                {(sesiones ?? []).map((sesion) => (
                  <li key={sesion.id} className="flex items-start gap-2 text-sm">
                    <Monitor className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                    <div className="min-w-0">
                      <p className="truncate">{resumirAgente(sesion.userAgent)}</p>
                      <p className="text-muted-foreground text-xs">
                        {sesion.ip ?? 'IP desconocida'} · desde {tiempoRelativo(sesion.creadoEn)}
                      </p>
                    </div>
                  </li>
                ))}
                {sesiones?.length === 0 ? (
                  <li className="text-muted-foreground text-sm">Ninguna sesión activa.</li>
                ) : null}
              </ul>

              <Boton
                variante="fantasma"
                tamano="sm"
                className="text-muted-foreground w-full"
                onClick={async () => {
                  await api.post('/auth/cerrar-todas');
                  window.location.href = '/entrar';
                }}
              >
                Cerrar todas las sesiones
              </Boton>
            </TarjetaContenido>
          </Tarjeta>
        </div>
      </div>

      <DialogoCambiarPassword
        abierto={cambiandoPassword}
        onCambio={setCambiandoPassword}
        obligatorio={perfil.debeCambiarPassword}
      />

      {/* El bloqueo por citas al cambiarse de sede */}
      <Dialogo open={bloqueoSede !== null} onOpenChange={(v) => !v && setBloqueoSede(null)}>
        <DialogoContenido>
          <DialogoCabecera>
            <DialogoTitulo className="text-aviso flex items-center gap-2">
              <TriangleAlert className="size-5" />
              Tienes citas en tu sede actual
            </DialogoTitulo>
            <DialogoDescripcion>{bloqueoSede?.mensaje}</DialogoDescripcion>
          </DialogoCabecera>

          <ul className="divide-y rounded-lg border">
            {(bloqueoSede?.citas ?? []).slice(0, 8).map((cita) => (
              <li key={cita.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{cita.cliente}</p>
                  <p className="text-muted-foreground text-xs capitalize">
                    {cita.fechaLegible} · {cita.sede}
                  </p>
                </div>
                {cita.telefono ? (
                  <Boton variante="contorno" tamano="sm" comoHijo>
                    <a href={`tel:${cita.telefono}`}>
                      <Phone />
                      <span className="tabular">{telefonoVisible(cita.telefono)}</span>
                    </a>
                  </Boton>
                ) : null}
              </li>
            ))}
          </ul>

          <p className="text-muted-foreground text-xs">
            También puedes mover esas citas a la sede nueva desde Reservas, si a los clientes les
            viene bien ir allí.
          </p>

          <DialogoPie>
            <Boton onClick={() => setBloqueoSede(null)}>Entendido</Boton>
          </DialogoPie>
        </DialogoContenido>
      </Dialogo>
    </>
  );
}

function DialogoCambiarPassword({
  abierto,
  onCambio,
  obligatorio,
}: {
  abierto: boolean;
  onCambio: (v: boolean) => void;
  obligatorio: boolean;
}) {
  const [passwordActual, setPasswordActual] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirmacion, setConfirmacion] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [campos, setCampos] = React.useState<Record<string, string[]>>({});
  const [listo, setListo] = React.useState(false);

  const guardar = useMutation({
    mutationFn: () => autenticacion.cambiarPassword({ passwordActual, password, confirmacion }),
    onSuccess: () => setListo(true),
    onError: (e) => {
      if (e instanceof ErrorApi) {
        setError(e.mensaje);
        setCampos(e.campos ?? {});
      } else {
        setError('No se pudo cambiar la contraseña.');
      }
    },
  });

  return (
    <Dialogo open={abierto} onOpenChange={(v) => !listo && onCambio(v)}>
      <DialogoContenido>
        <DialogoCabecera>
          <DialogoTitulo>Cambiar mi contraseña</DialogoTitulo>
          <DialogoDescripcion>
            {obligatorio
              ? 'Tu contraseña actual es provisional: ponle una tuya para seguir.'
              : 'Al cambiarla se cierran todas tus sesiones y tendrás que entrar de nuevo.'}
          </DialogoDescripcion>
        </DialogoCabecera>

        {listo ? (
          <>
            <p className="bg-exito/10 text-exito border-exito/25 rounded-md border px-3 py-2 text-sm">
              Contraseña actualizada. Vuelve a entrar con la nueva.
            </p>
            <DialogoPie>
              <Boton onClick={() => (window.location.href = '/entrar')}>Ir a iniciar sesión</Boton>
            </DialogoPie>
          </>
        ) : (
          <>
            {error ? (
              <p className="bg-destructive/10 text-destructive border-destructive/25 rounded-md border px-3 py-2 text-sm">
                {error}
              </p>
            ) : null}

            <Campo etiqueta="Contraseña actual" requerido error={campos.passwordActual?.[0]}>
              <Entrada
                type="password"
                autoFocus
                value={passwordActual}
                onChange={(e) => setPasswordActual(e.target.value)}
              />
            </Campo>

            <Campo
              etiqueta="Contraseña nueva"
              requerido
              error={campos.password?.[0]}
              ayuda="Mínimo 10 caracteres, con mayúscula, minúscula y número."
            >
              <Entrada
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Campo>

            <Campo etiqueta="Repite la contraseña nueva" requerido error={campos.confirmacion?.[0]}>
              <Entrada
                type="password"
                value={confirmacion}
                onChange={(e) => setConfirmacion(e.target.value)}
              />
            </Campo>

            <DialogoPie>
              {!obligatorio ? (
                <Boton variante="fantasma" onClick={() => onCambio(false)}>
                  Cancelar
                </Boton>
              ) : null}
              <Boton cargando={guardar.isPending} onClick={() => guardar.mutate()}>
                Cambiar contraseña
              </Boton>
            </DialogoPie>
          </>
        )}
      </DialogoContenido>
    </Dialogo>
  );
}

/** "Chrome en Windows" a partir del agente de usuario, que es ilegible. */
function resumirAgente(agente: string | null): string {
  if (!agente) return 'Dispositivo desconocido';

  const navegador = /Edg\//.test(agente)
    ? 'Edge'
    : /Chrome\//.test(agente)
      ? 'Chrome'
      : /Firefox\//.test(agente)
        ? 'Firefox'
        : /Safari\//.test(agente)
          ? 'Safari'
          : 'Navegador';

  const sistema = /Android/.test(agente)
    ? 'Android'
    : /iPhone|iPad/.test(agente)
      ? 'iPhone o iPad'
      : /Windows/.test(agente)
        ? 'Windows'
        : /Mac OS/.test(agente)
          ? 'Mac'
          : /Linux/.test(agente)
            ? 'Linux'
            : 'otro sistema';

  return `${navegador} en ${sistema}`;
}
