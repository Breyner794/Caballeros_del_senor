import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Phone, Plus, Search, TriangleAlert, Users } from 'lucide-react';
import { ETIQUETAS_ROL, ROLES, telefonoVisible, type PaginaRespuesta, type Rol } from '@cds/shared';
import { api, ErrorApi } from '@/lib/api';
import { cn, tiempoRelativo } from '@/lib/utils';
import { useSesion } from '@/hooks/sesion';
import { Encabezado } from '@/componentes/armazon';
import { Boton } from '@/componentes/ui/boton';
import { AreaTexto, Campo, Entrada } from '@/componentes/ui/campo';
import { Tarjeta } from '@/componentes/ui/tarjeta';
import {
  Avatar,
  Dialogo,
  DialogoCabecera,
  DialogoContenido,
  DialogoDescripcion,
  DialogoPie,
  DialogoTitulo,
  Esqueleto,
  EstadoVacio,
  Insignia,
  Selector,
  SelectorContenido,
  SelectorDisparador,
  SelectorOpcion,
  SelectorValor,
} from '@/componentes/ui/varios';

interface Sede {
  id: string;
  nombre: string;
}

export interface UsuarioPanel {
  id: string;
  nombre: string;
  apellido: string | null;
  email: string;
  telefono: string;
  rol: Rol;
  activo: boolean;
  debeCambiarPassword: boolean;
  sedeId: string | null;
  alias: string | null;
  bio: string | null;
  fotoUrl: string | null;
  visibleWeb: boolean;
  slotMinutos: number | null;
  ultimoAccesoEn: string | null;
  sede: { id: string; nombre: string } | null;
  sedesPermitidas: { sede: { id: string; nombre: string } }[];
}

interface CitaPendiente {
  id: string;
  codigo: string;
  fechaLegible: string;
  cliente: string;
  telefono: string;
  sede: string;
}

const COLOR_ROL: Record<Rol, 'primaria' | 'info' | 'neutra' | 'exito'> = {
  ADMIN: 'primaria',
  RECEPCIONISTA: 'info',
  BARBERO: 'neutra',
  CONTADOR: 'exito',
};

/**
 * Usuarios del panel.
 *
 * No son clientes: son las personas que entran a trabajar con el sistema. El
 * rol decide qué ve cada uno, y el permiso se comprueba en la API, así que
 * esta pantalla es solo la forma cómoda de asignarlo.
 */
export function PaginaUsuarios() {
  const { usuario: actual } = useSesion();
  const cliente = useQueryClient();

  const [busqueda, setBusqueda] = React.useState('');
  const [termino, setTermino] = React.useState('');
  const [rol, setRol] = React.useState<Rol | 'todos'>('todos');
  const [editando, setEditando] = React.useState<UsuarioPanel | null>(null);
  const [creando, setCreando] = React.useState(false);
  const [cambiandoPassword, setCambiandoPassword] = React.useState<UsuarioPanel | null>(null);
  const [bloqueo, setBloqueo] = React.useState<{ mensaje: string; citas: CitaPendiente[] } | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setTermino(busqueda.trim()), 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  const { data, isLoading } = useQuery({
    queryKey: ['usuarios', termino, rol],
    queryFn: () =>
      api.get<PaginaRespuesta<UsuarioPanel>>(
        `/usuarios?limite=100${termino ? `&buscar=${encodeURIComponent(termino)}` : ''}${
          rol !== 'todos' ? `&rol=${rol}` : ''
        }`,
      ),
  });

  const cambiarEstado = useMutation({
    mutationFn: ({ id, activo }: { id: string; activo: boolean }) =>
      api.patch(`/usuarios/${id}`, { activo }),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['usuarios'] }),
    onError: (e) => {
      if (e instanceof ErrorApi) {
        const detalle = e.detalle as { citas?: CitaPendiente[] } | undefined;
        setBloqueo({ mensaje: e.mensaje, citas: detalle?.citas ?? [] });
      }
    },
  });

  return (
    <>
      <Encabezado
        titulo="Usuarios"
        descripcion="Quién entra al panel y qué puede hacer cada uno."
      >
        <Boton onClick={() => setCreando(true)}>
          <Plus />
          Nuevo usuario
        </Boton>
      </Encabezado>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Entrada
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o correo…"
            className="pl-9"
          />
        </div>
        <Selector value={rol} onValueChange={(v) => setRol(v as Rol | 'todos')}>
          <SelectorDisparador className="w-44">
            <SelectorValor placeholder="Rol" />
          </SelectorDisparador>
          <SelectorContenido>
            <SelectorOpcion value="todos">Todos los roles</SelectorOpcion>
            {ROLES.map((r) => (
              <SelectorOpcion key={r} value={r}>
                {ETIQUETAS_ROL[r]}
              </SelectorOpcion>
            ))}
          </SelectorContenido>
        </Selector>
      </div>

      <Tarjeta className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Esqueleto key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : data && data.datos.length > 0 ? (
          <ul className="divide-y">
            {data.datos.map((usuario) => (
              <li
                key={usuario.id}
                className={cn('flex flex-wrap items-center gap-3 p-4', !usuario.activo && 'opacity-60')}
              >
                <Avatar nombre={usuario.nombre} url={usuario.fotoUrl} />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium">
                      {usuario.nombre} {usuario.apellido ?? ''}
                      {usuario.alias ? (
                        <span className="text-muted-foreground font-normal"> «{usuario.alias}»</span>
                      ) : null}
                    </p>
                    <Insignia variante={COLOR_ROL[usuario.rol]}>
                      {ETIQUETAS_ROL[usuario.rol]}
                    </Insignia>
                    {!usuario.activo ? <Insignia variante="peligro">Desactivado</Insignia> : null}
                    {usuario.debeCambiarPassword ? (
                      <Insignia variante="aviso">Contraseña provisional</Insignia>
                    ) : null}
                    {usuario.id === actual?.id ? (
                      <Insignia variante="contorno">Tú</Insignia>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground truncate text-sm">
                    {usuario.email} · {telefonoVisible(usuario.telefono)}
                    {usuario.sede ? ` · ${usuario.sede.nombre}` : ''}
                    {usuario.sedesPermitidas.length > 0
                      ? ` (+${usuario.sedesPermitidas.length} sede${usuario.sedesPermitidas.length > 1 ? 's' : ''})`
                      : ''}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Último acceso: {tiempoRelativo(usuario.ultimoAccesoEn)}
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  <Boton variante="contorno" tamano="sm" onClick={() => setEditando(usuario)}>
                    Editar
                  </Boton>
                  <Boton
                    variante="fantasma"
                    tamano="iconoSm"
                    title="Restablecer contraseña"
                    onClick={() => setCambiandoPassword(usuario)}
                  >
                    <KeyRound />
                  </Boton>
                  <Boton
                    variante="fantasma"
                    tamano="sm"
                    className="text-muted-foreground"
                    disabled={usuario.id === actual?.id || cambiarEstado.isPending}
                    onClick={() => cambiarEstado.mutate({ id: usuario.id, activo: !usuario.activo })}
                  >
                    {usuario.activo ? 'Desactivar' : 'Activar'}
                  </Boton>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EstadoVacio
            icono={Users}
            titulo="Ningún usuario coincide"
            descripcion="Prueba a quitar el filtro de rol o a buscar por correo."
          />
        )}
      </Tarjeta>

      {creando ? (
        <DialogoUsuario
          abierto
          onCambio={(v) => !v && setCreando(false)}
          onGuardado={() => {
            setCreando(false);
            void cliente.invalidateQueries({ queryKey: ['usuarios'] });
          }}
        />
      ) : null}

      {editando ? (
        <DialogoUsuario
          usuario={editando}
          abierto
          onCambio={(v) => !v && setEditando(null)}
          onGuardado={() => {
            setEditando(null);
            void cliente.invalidateQueries({ queryKey: ['usuarios'] });
          }}
        />
      ) : null}

      {cambiandoPassword ? (
        <DialogoResetPassword
          usuario={cambiandoPassword}
          abierto
          onCambio={(v) => !v && setCambiandoPassword(null)}
          onGuardado={() => setCambiandoPassword(null)}
        />
      ) : null}

      {/* Bloqueo por citas pendientes al desactivar a un barbero */}
      <Dialogo open={bloqueo !== null} onOpenChange={(v) => !v && setBloqueo(null)}>
        <DialogoContenido>
          <DialogoCabecera>
            <DialogoTitulo className="text-aviso flex items-center gap-2">
              <TriangleAlert className="size-5" />
              Tiene citas por atender
            </DialogoTitulo>
            <DialogoDescripcion>{bloqueo?.mensaje}</DialogoDescripcion>
          </DialogoCabecera>

          <ul className="divide-y rounded-lg border">
            {(bloqueo?.citas ?? []).slice(0, 10).map((cita) => (
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

          <DialogoPie>
            <Boton onClick={() => setBloqueo(null)}>Entendido</Boton>
          </DialogoPie>
        </DialogoContenido>
      </Dialogo>
    </>
  );
}

function DialogoUsuario({
  usuario,
  abierto,
  onCambio,
  onGuardado,
}: {
  usuario?: UsuarioPanel;
  abierto: boolean;
  onCambio: (v: boolean) => void;
  onGuardado: () => void;
}) {
  const esNuevo = !usuario;

  const [nombre, setNombre] = React.useState(usuario?.nombre ?? '');
  const [apellido, setApellido] = React.useState(usuario?.apellido ?? '');
  const [email, setEmail] = React.useState(usuario?.email ?? '');
  const [telefono, setTelefono] = React.useState(usuario?.telefono ?? '');
  const [password, setPassword] = React.useState('');
  const [rol, setRol] = React.useState<Rol>(usuario?.rol ?? 'BARBERO');
  const [sedeId, setSedeId] = React.useState(usuario?.sedeId ?? '');
  const [sedesExtra, setSedesExtra] = React.useState<string[]>(
    usuario?.sedesPermitidas.map((s) => s.sede.id) ?? [],
  );
  const [alias, setAlias] = React.useState(usuario?.alias ?? '');
  const [bio, setBio] = React.useState(usuario?.bio ?? '');
  const [visibleWeb, setVisibleWeb] = React.useState(usuario?.visibleWeb ?? true);
  const [slotMinutos, setSlotMinutos] = React.useState<string>(
    usuario?.slotMinutos ? String(usuario.slotMinutos) : '',
  );

  const [campos, setCampos] = React.useState<Record<string, string[]>>({});
  const [error, setError] = React.useState<string | null>(null);

  const { data: sedes } = useQuery({
    queryKey: ['sedes', 'activas'],
    queryFn: () => api.get<Sede[]>('/sedes?soloActivas=true'),
    enabled: abierto,
  });

  const necesitaSede = rol === 'BARBERO' || rol === 'RECEPCIONISTA';
  const esBarbero = rol === 'BARBERO';

  const guardar = useMutation({
    mutationFn: () => {
      const comun = {
        nombre,
        apellido: apellido || undefined,
        email,
        telefono,
        rol,
        sedeId: necesitaSede ? sedeId : null,
        sedesPermitidas: sedesExtra,
        alias: alias || undefined,
        bio: bio || undefined,
        visibleWeb,
        slotMinutos: slotMinutos ? Number(slotMinutos) : null,
      };
      return esNuevo
        ? api.post('/usuarios', { ...comun, password, debeCambiarPassword: true })
        : api.patch(`/usuarios/${usuario.id}`, comun);
    },
    onSuccess: onGuardado,
    onError: (e) => {
      if (e instanceof ErrorApi) {
        setError(e.mensaje);
        setCampos(e.campos ?? {});
      } else {
        setError('No se pudo guardar.');
      }
    },
  });

  return (
    <Dialogo open={abierto} onOpenChange={onCambio}>
      <DialogoContenido anchoMaximo="max-w-xl">
        <DialogoCabecera>
          <DialogoTitulo>{esNuevo ? 'Nuevo usuario' : `Editar a ${usuario.nombre}`}</DialogoTitulo>
          <DialogoDescripcion>
            {esNuevo
              ? 'Tú pones una contraseña provisional; el panel le pedirá cambiarla al entrar.'
              : 'La contraseña se cambia desde el botón de la llave, no desde aquí.'}
          </DialogoDescripcion>
        </DialogoCabecera>

        {error ? (
          <p className="bg-destructive/10 text-destructive border-destructive/25 rounded-md border px-3 py-2 text-sm">
            {error}
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Nombre" requerido error={campos.nombre?.[0]}>
            <Entrada value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
          </Campo>
          <Campo etiqueta="Apellido" error={campos.apellido?.[0]}>
            <Entrada value={apellido} onChange={(e) => setApellido(e.target.value)} />
          </Campo>
          <Campo etiqueta="Correo" requerido error={campos.email?.[0]}>
            <Entrada type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Campo>
          <Campo etiqueta="Celular" requerido error={campos.telefono?.[0]}>
            <Entrada
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              placeholder="300 123 4567"
            />
          </Campo>
        </div>

        {esNuevo ? (
          <Campo
            etiqueta="Contraseña provisional"
            requerido
            error={campos.password?.[0]}
            ayuda="Mínimo 10 caracteres, con mayúscula, minúscula y número."
          >
            <Entrada type="text" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Campo>
        ) : null}

        <Campo etiqueta="Rol" requerido error={campos.rol?.[0]}>
          <Selector value={rol} onValueChange={(v) => setRol(v as Rol)}>
            <SelectorDisparador>
              <SelectorValor />
            </SelectorDisparador>
            <SelectorContenido>
              {ROLES.map((r) => (
                <SelectorOpcion key={r} value={r}>
                  {ETIQUETAS_ROL[r]}
                </SelectorOpcion>
              ))}
            </SelectorContenido>
          </Selector>
        </Campo>

        {necesitaSede ? (
          <>
            <Campo
              etiqueta="Sede principal"
              requerido
              error={campos.sedeId?.[0]}
              ayuda="Donde atiende habitualmente."
            >
              <Selector value={sedeId} onValueChange={setSedeId}>
                <SelectorDisparador>
                  <SelectorValor placeholder="Elige la sede" />
                </SelectorDisparador>
                <SelectorContenido>
                  {(sedes ?? []).map((s) => (
                    <SelectorOpcion key={s.id} value={s.id}>
                      {s.nombre}
                    </SelectorOpcion>
                  ))}
                </SelectorContenido>
              </Selector>
            </Campo>

            <Campo
              etiqueta="También puede atender en"
              ayuda="Para cubrir turnos en otras sedes. Necesitará su propio cronograma en cada una."
            >
              <div className="flex flex-wrap gap-1.5">
                {(sedes ?? [])
                  .filter((s) => s.id !== sedeId)
                  .map((s) => {
                    const elegida = sedesExtra.includes(s.id);
                    return (
                      <Boton
                        key={s.id}
                        variante={elegida ? 'secundario' : 'contorno'}
                        tamano="sm"
                        onClick={() =>
                          setSedesExtra((previas) =>
                            elegida ? previas.filter((id) => id !== s.id) : [...previas, s.id],
                          )
                        }
                      >
                        {s.nombre}
                      </Boton>
                    );
                  })}
              </div>
            </Campo>
          </>
        ) : null}

        {esBarbero ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="Alias" ayuda="Como lo conocen los clientes.">
                <Entrada value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="El Maestro" />
              </Campo>
              <Campo
                etiqueta="Turnos propios"
                ayuda="En minutos. Vacío = usa el valor general."
              >
                <Entrada
                  type="number"
                  min={5}
                  max={240}
                  step={5}
                  value={slotMinutos}
                  onChange={(e) => setSlotMinutos(e.target.value)}
                  placeholder="hereda"
                />
              </Campo>
            </div>

            <Campo etiqueta="Presentación" ayuda="Se muestra en la web del cliente.">
              <AreaTexto rows={2} value={bio} onChange={(e) => setBio(e.target.value)} />
            </Campo>

            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-foreground"
                checked={visibleWeb}
                onChange={(e) => setVisibleWeb(e.target.checked)}
              />
              Visible en la web pública (los clientes pueden elegirlo al reservar)
            </label>
          </>
        ) : null}

        <DialogoPie>
          <Boton variante="fantasma" onClick={() => onCambio(false)}>
            Cancelar
          </Boton>
          <Boton cargando={guardar.isPending} onClick={() => guardar.mutate()}>
            {esNuevo ? 'Crear usuario' : 'Guardar cambios'}
          </Boton>
        </DialogoPie>
      </DialogoContenido>
    </Dialogo>
  );
}

function DialogoResetPassword({
  usuario,
  abierto,
  onCambio,
  onGuardado,
}: {
  usuario: UsuarioPanel;
  abierto: boolean;
  onCambio: (v: boolean) => void;
  onGuardado: () => void;
}) {
  const [password, setPassword] = React.useState('');
  const [notificar, setNotificar] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [campos, setCampos] = React.useState<Record<string, string[]>>({});
  const [listo, setListo] = React.useState<string | null>(null);

  const guardar = useMutation({
    mutationFn: () => api.patch<{ mensaje: string }>(`/usuarios/${usuario.id}/password`, { password, notificar }),
    onSuccess: (r) => setListo(r.mensaje),
    onError: (e) => {
      if (e instanceof ErrorApi) {
        setError(e.mensaje);
        setCampos(e.campos ?? {});
      }
    },
  });

  return (
    <Dialogo open={abierto} onOpenChange={onCambio}>
      <DialogoContenido>
        <DialogoCabecera>
          <DialogoTitulo className="flex items-center gap-2">
            <KeyRound className="size-5" />
            Restablecer la contraseña de {usuario.nombre}
          </DialogoTitulo>
          <DialogoDescripcion>
            Se cerrarán todas sus sesiones abiertas y tendrá que cambiarla al entrar.
          </DialogoDescripcion>
        </DialogoCabecera>

        {listo ? (
          <>
            <p className="bg-exito/10 text-exito border-exito/25 rounded-md border px-3 py-2 text-sm">
              {listo}
            </p>
            <p className="text-muted-foreground text-sm">
              Hazle llegar la contraseña por un canal distinto del correo. El sistema no se la envía
              en claro a nadie.
            </p>
            <DialogoPie>
              <Boton onClick={onGuardado}>Listo</Boton>
            </DialogoPie>
          </>
        ) : (
          <>
            {error ? (
              <p className="bg-destructive/10 text-destructive border-destructive/25 rounded-md border px-3 py-2 text-sm">
                {error}
              </p>
            ) : null}

            <Campo
              etiqueta="Contraseña provisional"
              requerido
              error={campos.password?.[0]}
              ayuda="Mínimo 10 caracteres, con mayúscula, minúscula y número."
            >
              <Entrada
                type="text"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Campo>

            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-foreground"
                checked={notificar}
                onChange={(e) => setNotificar(e.target.checked)}
              />
              Avisarle por correo de que su contraseña fue restablecida
            </label>

            <DialogoPie>
              <Boton variante="fantasma" onClick={() => onCambio(false)}>
                Cancelar
              </Boton>
              <Boton cargando={guardar.isPending} onClick={() => guardar.mutate()}>
                Restablecer
              </Boton>
            </DialogoPie>
          </>
        )}
      </DialogoContenido>
    </Dialogo>
  );
}
