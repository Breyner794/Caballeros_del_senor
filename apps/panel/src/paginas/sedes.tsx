import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Plus, Store, TriangleAlert, Users } from 'lucide-react';
import { DIAS_SEMANA, horaAMinutos, minutosAHora, nombreDia } from '@cds/shared';
import { api, ErrorApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Encabezado } from '@/componentes/armazon';
import { Boton } from '@/componentes/ui/boton';
import { AreaTexto, Campo, Entrada } from '@/componentes/ui/campo';
import { Tarjeta, TarjetaContenido } from '@/componentes/ui/tarjeta';
import {
  Dialogo,
  DialogoCabecera,
  DialogoContenido,
  DialogoDescripcion,
  DialogoPie,
  DialogoTitulo,
  Esqueleto,
  EstadoVacio,
  Insignia,
  Separador,
} from '@/componentes/ui/varios';

interface Horario {
  id?: string;
  diaSemana: number;
  horaInicio: number;
  horaFin: number;
  cerrado: boolean;
}

interface Sede {
  id: string;
  nombre: string;
  direccion: string;
  ciudad: string | null;
  telefono: string | null;
  mapsUrl: string | null;
  notas: string | null;
  activa: boolean;
  orden: number;
  horarios: Horario[];
  _count: { usuarios: number };
}

/**
 * Sedes.
 *
 * El horario que se define aquí es el del local, no el de los barberos: es el
 * techo dentro del que trabajan todos. Un barbero puede tener jornada más
 * corta, pero nunca podrá atender con la sede cerrada — el motor de
 * disponibilidad cruza ambos y se queda con la intersección.
 */
export function PaginaSedes() {
  const cliente = useQueryClient();
  const [editando, setEditando] = React.useState<Sede | null>(null);
  const [creando, setCreando] = React.useState(false);
  const [bloqueo, setBloqueo] = React.useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['sedes', 'todas'],
    queryFn: () => api.get<Sede[]>('/sedes'),
  });

  const cambiarEstado = useMutation({
    mutationFn: ({ id, activa }: { id: string; activa: boolean }) =>
      api.patch(`/sedes/${id}/estado`, { activa }),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['sedes'] }),
    onError: (e) => setBloqueo(e instanceof ErrorApi ? e.mensaje : 'No se pudo cambiar el estado.'),
  });

  return (
    <>
      <Encabezado titulo="Sedes" descripcion="Los locales de la barbería y su horario de atención.">
        <Boton onClick={() => setCreando(true)}>
          <Plus />
          Nueva sede
        </Boton>
      </Encabezado>

      {isLoading ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {[0, 1, 2].map((i) => (
            <Esqueleto key={i} className="h-56" />
          ))}
        </div>
      ) : data && data.length > 0 ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.map((sede) => (
            <Tarjeta key={sede.id} className={cn(!sede.activa && 'opacity-60')}>
              <TarjetaContenido className="space-y-4 p-5 pt-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate font-semibold">{sede.nombre}</h3>
                      {!sede.activa ? <Insignia variante="peligro">Desactivada</Insignia> : null}
                    </div>
                    <p className="text-muted-foreground mt-0.5 flex items-start gap-1.5 text-sm">
                      <MapPin className="mt-0.5 size-3.5 shrink-0" />
                      <span>
                        {sede.direccion}
                        {sede.ciudad ? `, ${sede.ciudad}` : ''}
                      </span>
                    </p>
                    <p className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
                      <Users className="size-3.5" />
                      {sede._count.usuarios}{' '}
                      {sede._count.usuarios === 1 ? 'persona asignada' : 'personas asignadas'}
                      {sede.telefono ? ` · ${sede.telefono}` : ''}
                    </p>
                  </div>
                </div>

                <Separador />

                {/* Horario de atención del local */}
                <ul className="space-y-1 text-sm">
                  {Array.from({ length: 7 }, (_, dia) => {
                    const horario = sede.horarios.find((h) => h.diaSemana === dia);
                    const cerrado = !horario || horario.cerrado;
                    return (
                      <li key={dia} className="flex items-baseline justify-between gap-3">
                        <span className={cn(cerrado && 'text-muted-foreground')}>
                          {nombreDia(dia)}
                        </span>
                        <span
                          className={cn(
                            'tabular',
                            cerrado ? 'text-muted-foreground text-xs' : 'font-medium',
                          )}
                        >
                          {cerrado
                            ? 'Cerrado'
                            : `${minutosAHora(horario.horaInicio)} – ${minutosAHora(horario.horaFin)}`}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                <div className="flex gap-2">
                  <Boton variante="contorno" tamano="sm" onClick={() => setEditando(sede)}>
                    Editar
                  </Boton>
                  <Boton
                    variante="fantasma"
                    tamano="sm"
                    className="text-muted-foreground"
                    disabled={cambiarEstado.isPending}
                    onClick={() => cambiarEstado.mutate({ id: sede.id, activa: !sede.activa })}
                  >
                    {sede.activa ? 'Desactivar' : 'Activar'}
                  </Boton>
                </div>
              </TarjetaContenido>
            </Tarjeta>
          ))}
        </div>
      ) : (
        <Tarjeta>
          <EstadoVacio
            icono={Store}
            titulo="No hay sedes registradas"
            descripcion="Sin al menos una sede no se pueden registrar reservas: cada cita pertenece a un local."
          >
            <Boton onClick={() => setCreando(true)}>
              <Plus />
              Crear la primera sede
            </Boton>
          </EstadoVacio>
        </Tarjeta>
      )}

      {creando || editando ? (
        <DialogoSede
          sede={editando ?? undefined}
          abierto
          onCambio={(v) => {
            if (!v) {
              setCreando(false);
              setEditando(null);
            }
          }}
          onGuardado={() => {
            setCreando(false);
            setEditando(null);
            void cliente.invalidateQueries({ queryKey: ['sedes'] });
          }}
        />
      ) : null}

      <Dialogo open={bloqueo !== null} onOpenChange={(v) => !v && setBloqueo(null)}>
        <DialogoContenido>
          <DialogoCabecera>
            <DialogoTitulo className="text-aviso flex items-center gap-2">
              <TriangleAlert className="size-5" />
              No se puede desactivar
            </DialogoTitulo>
            <DialogoDescripcion>{bloqueo}</DialogoDescripcion>
          </DialogoCabecera>
          <DialogoPie>
            <Boton onClick={() => setBloqueo(null)}>Entendido</Boton>
          </DialogoPie>
        </DialogoContenido>
      </Dialogo>
    </>
  );
}

function DialogoSede({
  sede,
  abierto,
  onCambio,
  onGuardado,
}: {
  sede?: Sede;
  abierto: boolean;
  onCambio: (v: boolean) => void;
  onGuardado: () => void;
}) {
  const esNueva = !sede;

  const [nombre, setNombre] = React.useState(sede?.nombre ?? '');
  const [direccion, setDireccion] = React.useState(sede?.direccion ?? '');
  const [ciudad, setCiudad] = React.useState(sede?.ciudad ?? '');
  const [telefono, setTelefono] = React.useState(sede?.telefono ?? '');
  const [mapsUrl, setMapsUrl] = React.useState(sede?.mapsUrl ?? '');
  const [notas, setNotas] = React.useState(sede?.notas ?? '');

  // Siempre los siete días, para que la pantalla no dependa de qué haya en la
  // base: un día sin fila es un día cerrado.
  const [horarios, setHorarios] = React.useState<Horario[]>(() =>
    Array.from({ length: 7 }, (_, dia) => {
      const existente = sede?.horarios.find((h) => h.diaSemana === dia);
      return (
        existente ?? {
          diaSemana: dia,
          horaInicio: 8 * 60,
          horaFin: 20 * 60,
          cerrado: dia === 0,
        }
      );
    }),
  );

  const [error, setError] = React.useState<string | null>(null);
  const [campos, setCampos] = React.useState<Record<string, string[]>>({});

  const guardar = useMutation({
    mutationFn: () => {
      const datos = {
        nombre,
        direccion,
        ciudad: ciudad || undefined,
        telefono: telefono || undefined,
        mapsUrl: mapsUrl || undefined,
        notas: notas || undefined,
        horarios: horarios.map((h) => ({
          diaSemana: h.diaSemana,
          horaInicio: h.horaInicio,
          horaFin: h.horaFin,
          cerrado: h.cerrado,
        })),
      };
      return esNueva ? api.post('/sedes', datos) : api.patch(`/sedes/${sede.id}`, datos);
    },
    onSuccess: onGuardado,
    onError: (e) => {
      if (e instanceof ErrorApi) {
        setError(e.mensaje);
        setCampos(e.campos ?? {});
      } else {
        setError('No se pudo guardar la sede.');
      }
    },
  });

  function cambiarHorario(dia: number, cambio: Partial<Horario>) {
    setHorarios((previos) =>
      previos.map((h) => (h.diaSemana === dia ? { ...h, ...cambio } : h)),
    );
  }

  return (
    <Dialogo open={abierto} onOpenChange={onCambio}>
      <DialogoContenido anchoMaximo="max-w-xl">
        <DialogoCabecera>
          <DialogoTitulo>{esNueva ? 'Nueva sede' : `Editar ${sede.nombre}`}</DialogoTitulo>
          <DialogoDescripcion>
            El horario de aquí es el del local. Cada barbero tiene el suyo dentro de este.
          </DialogoDescripcion>
        </DialogoCabecera>

        {error ? (
          <p className="bg-destructive/10 text-destructive border-destructive/25 rounded-md border px-3 py-2 text-sm">
            {error}
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Nombre" requerido error={campos.nombre?.[0]} className="sm:col-span-2">
            <Entrada
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              autoFocus
              placeholder="Caballeros del Señor — Centro"
            />
          </Campo>
          <Campo etiqueta="Dirección" requerido error={campos.direccion?.[0]} className="sm:col-span-2">
            <Entrada value={direccion} onChange={(e) => setDireccion(e.target.value)} />
          </Campo>
          <Campo etiqueta="Ciudad" error={campos.ciudad?.[0]}>
            <Entrada value={ciudad} onChange={(e) => setCiudad(e.target.value)} />
          </Campo>
          <Campo etiqueta="Teléfono del local" error={campos.telefono?.[0]}>
            <Entrada value={telefono} onChange={(e) => setTelefono(e.target.value)} />
          </Campo>
          <Campo
            etiqueta="Enlace de Google Maps"
            error={campos.mapsUrl?.[0]}
            className="sm:col-span-2"
            ayuda="Se muestra en la web del cliente para que sepa llegar."
          >
            <Entrada
              value={mapsUrl}
              onChange={(e) => setMapsUrl(e.target.value)}
              placeholder="https://maps.app.goo.gl/…"
            />
          </Campo>
        </div>

        <Separador />

        <div className="space-y-1.5">
          <p className="text-sm font-medium">Horario de atención</p>
          <ul className="space-y-1.5">
            {DIAS_SEMANA.map(({ valor, nombre: nombreDelDia }) => {
              const horario = horarios.find((h) => h.diaSemana === valor)!;
              return (
                <li key={valor} className="flex flex-wrap items-center gap-3">
                  <label className="flex w-32 shrink-0 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      className="accent-foreground size-4"
                      checked={!horario.cerrado}
                      onChange={(e) => cambiarHorario(valor, { cerrado: !e.target.checked })}
                    />
                    <span className={cn('text-sm', horario.cerrado && 'text-muted-foreground')}>
                      {nombreDelDia}
                    </span>
                  </label>

                  {horario.cerrado ? (
                    <span className="text-muted-foreground text-sm">Cerrado</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Entrada
                        type="time"
                        className="w-36"
                        value={minutosAHora(horario.horaInicio)}
                        onChange={(e) => {
                          const m = horaAMinutos(e.target.value);
                          if (m !== null) cambiarHorario(valor, { horaInicio: m });
                        }}
                      />
                      <span className="text-muted-foreground text-sm">a</span>
                      <Entrada
                        type="time"
                        className="w-36"
                        value={minutosAHora(horario.horaFin)}
                        onChange={(e) => {
                          const m = horaAMinutos(e.target.value);
                          if (m !== null) cambiarHorario(valor, { horaFin: m });
                        }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <Campo etiqueta="Notas internas" ayuda="Solo las ve el panel.">
          <AreaTexto rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} />
        </Campo>

        <DialogoPie>
          <Boton variante="fantasma" onClick={() => onCambio(false)}>
            Cancelar
          </Boton>
          <Boton cargando={guardar.isPending} onClick={() => guardar.mutate()}>
            {esNueva ? 'Crear sede' : 'Guardar cambios'}
          </Boton>
        </DialogoPie>
      </DialogoContenido>
    </Dialogo>
  );
}
