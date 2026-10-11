import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarOff,
  Check,
  Clock,
  Coffee,
  Phone,
  Plus,
  Save,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import {
  minutosAHora,
  horaAMinutos,
  nombreDia,
  type TipoBloqueAgenda,
} from '@cds/shared';
import { api, ErrorApi } from '@/lib/api';
import { aFechaISO, cn, fechaLarga } from '@/lib/utils';
import { useSesion } from '@/hooks/sesion';
import { Encabezado } from '@/componentes/armazon';
import { Boton } from '@/componentes/ui/boton';
import { Campo, Entrada } from '@/componentes/ui/campo';
import { Tarjeta, TarjetaContenido } from '@/componentes/ui/tarjeta';
import {
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

interface Sede {
  id: string;
  nombre: string;
}

interface Barbero {
  id: string;
  nombre: string;
  apellido: string | null;
  alias: string | null;
}

interface Bloque {
  id?: string;
  tipo: TipoBloqueAgenda;
  horaInicio: number;
  horaFin: number;
  etiqueta?: string | null;
}

interface DiaAgenda {
  id: string | null;
  diaSemana: number;
  nombreDia: string;
  trabaja: boolean;
  horaInicio: number;
  horaFin: number;
  slotMinutos: number | null;
  slotEfectivo: number;
  origenSlot: 'DIA' | 'USUARIO' | 'GLOBAL';
  bloques: Bloque[];
}

interface AgendaSemanal {
  usuario: { id: string; nombre: string; apellido: string | null; alias: string | null; slotMinutos: number | null };
  sedeId: string;
  slotGlobal: number;
  slotUsuario: number | null;
  dias: DiaAgenda[];
}

interface Excepcion {
  id: string;
  fecha: string;
  tipo: 'CERRADO' | 'HORARIO_ESPECIAL';
  horaInicio: number | null;
  horaFin: number | null;
  motivo: string | null;
  sede: { id: string; nombre: string } | null;
}

interface CitaAfectada {
  id: string;
  codigo: string;
  hora: string;
  fechaLegible: string;
  cliente: string;
  telefonoVisible: string;
  telefono: string;
  servicios: string[];
}

/**
 * Cronograma.
 *
 * Dos cosas distintas que la gente confunde y por eso van separadas en
 * pestañas: la **plantilla semanal** ("los martes trabajo de 9 a 19") y las
 * **excepciones** ("este martes no, tengo médico"). La plantilla se repite
 * siempre; la excepción manda sobre ella un día concreto.
 *
 * El momento delicado es cerrar un día que ya tiene citas. El panel no lo
 * impide con un mensaje seco: muestra quiénes son, a qué hora y con qué
 * teléfono, para que el barbero pueda llamarlos ahí mismo. Y si aun así
 * insiste, queda registrado en la auditoría quién forzó el cierre.
 */
export function PaginaCronograma() {
  const { usuario, puede } = useSesion();
  const cliente = useQueryClient();

  const [sedeId, setSedeId] = React.useState(usuario?.sedeId ?? '');
  const [barberoId, setBarberoId] = React.useState(
    usuario?.rol === 'BARBERO' ? usuario.id : '',
  );
  const [pestana, setPestana] = React.useState<'semana' | 'excepciones'>('semana');

  const { data: sedes } = useQuery({
    queryKey: ['sedes', 'activas'],
    queryFn: () => api.get<Sede[]>('/sedes?soloActivas=true'),
  });

  React.useEffect(() => {
    if (!sedeId && sedes?.[0]) setSedeId(usuario?.sedeId ?? sedes[0].id);
  }, [sedes, sedeId, usuario?.sedeId]);

  const { data: barberos } = useQuery({
    queryKey: ['barberos', sedeId],
    queryFn: () => api.get<Barbero[]>(`/sedes/${sedeId}/barberos`),
    enabled: Boolean(sedeId),
  });

  React.useEffect(() => {
    if (!barberoId && barberos?.[0] && puede('agenda:gestionar_todas')) {
      setBarberoId(barberos[0].id);
    }
  }, [barberos, barberoId, puede]);

  const objetivo = puede('agenda:gestionar_todas') ? barberoId : (usuario?.id ?? '');

  return (
    <>
      <Encabezado
        titulo="Cronograma"
        descripcion="El horario de cada semana y las excepciones de días concretos."
      >
        <Selector value={sedeId} onValueChange={setSedeId}>
          <SelectorDisparador className="w-52">
            <SelectorValor placeholder="Sede" />
          </SelectorDisparador>
          <SelectorContenido>
            {(sedes ?? []).map((s) => (
              <SelectorOpcion key={s.id} value={s.id}>
                {s.nombre}
              </SelectorOpcion>
            ))}
          </SelectorContenido>
        </Selector>

        {puede('agenda:gestionar_todas') ? (
          <Selector value={barberoId} onValueChange={setBarberoId}>
            <SelectorDisparador className="w-44">
              <SelectorValor placeholder="Barbero" />
            </SelectorDisparador>
            <SelectorContenido>
              {(barberos ?? []).map((b) => (
                <SelectorOpcion key={b.id} value={b.id}>
                  {b.alias ?? `${b.nombre} ${b.apellido ?? ''}`.trim()}
                </SelectorOpcion>
              ))}
            </SelectorContenido>
          </Selector>
        ) : null}
      </Encabezado>

      <div className="mb-4 flex gap-1.5">
        <Boton
          variante={pestana === 'semana' ? 'primario' : 'contorno'}
          tamano="sm"
          onClick={() => setPestana('semana')}
        >
          <Clock />
          Semana habitual
        </Boton>
        <Boton
          variante={pestana === 'excepciones' ? 'primario' : 'contorno'}
          tamano="sm"
          onClick={() => setPestana('excepciones')}
        >
          <CalendarOff />
          Días libres y excepciones
        </Boton>
      </div>

      {!sedeId || !objetivo ? (
        <Tarjeta>
          <TarjetaContenido className="text-muted-foreground p-10 pt-10 text-center text-sm">
            Elige una sede y un barbero.
          </TarjetaContenido>
        </Tarjeta>
      ) : pestana === 'semana' ? (
        <EditorSemanal
          usuarioId={objetivo}
          sedeId={sedeId}
          onGuardado={() => {
            void cliente.invalidateQueries({ queryKey: ['disponibilidad'] });
            void cliente.invalidateQueries({ queryKey: ['calendario'] });
          }}
        />
      ) : (
        <Excepciones usuarioId={objetivo} sedeId={sedeId} />
      )}
    </>
  );
}

// ============================ SEMANA HABITUAL ===============================

function EditorSemanal({
  usuarioId,
  sedeId,
  onGuardado,
}: {
  usuarioId: string;
  sedeId: string;
  onGuardado: () => void;
}) {
  const cliente = useQueryClient();
  const [dias, setDias] = React.useState<DiaAgenda[] | null>(null);
  const [conflictos, setConflictos] = React.useState<CitaAfectada[] | null>(null);
  const [mensajeConflicto, setMensajeConflicto] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['agenda-semanal', usuarioId, sedeId],
    queryFn: () => api.get<AgendaSemanal>(`/agenda/semanal?usuarioId=${usuarioId}&sedeId=${sedeId}`),
  });

  React.useEffect(() => {
    if (data) setDias(data.dias);
  }, [data]);

  const guardar = useMutation({
    mutationFn: (forzar: boolean) =>
      api.put('/agenda/semanal', {
        usuarioId,
        sedeId,
        forzar,
        dias: (dias ?? []).map((d) => ({
          diaSemana: d.diaSemana,
          trabaja: d.trabaja,
          horaInicio: d.horaInicio,
          horaFin: d.horaFin,
          slotMinutos: d.slotMinutos,
          bloques: d.bloques.map((b) => ({
            tipo: b.tipo,
            horaInicio: b.horaInicio,
            horaFin: b.horaFin,
            etiqueta: b.etiqueta ?? undefined,
          })),
        })),
      }),
    onSuccess: () => {
      setConflictos(null);
      setError(null);
      void cliente.invalidateQueries({ queryKey: ['agenda-semanal'] });
      onGuardado();
    },
    onError: (e) => {
      if (e instanceof ErrorApi && e.codigo === 'DIA_CON_RESERVAS') {
        const detalle = e.detalle as { citas?: CitaAfectada[] } | undefined;
        setConflictos(detalle?.citas ?? []);
        setMensajeConflicto(e.mensaje);
      } else {
        setError(e instanceof ErrorApi ? e.mensaje : 'No se pudo guardar el cronograma.');
      }
    },
  });

  function actualizarDia(diaSemana: number, cambio: Partial<DiaAgenda>) {
    setDias((previos) =>
      (previos ?? []).map((d) => (d.diaSemana === diaSemana ? { ...d, ...cambio } : d)),
    );
  }

  if (isLoading || !dias) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <Esqueleto key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  return (
    <>
      {error ? (
        <p className="bg-destructive/10 text-destructive border-destructive/25 mb-3 rounded-md border px-3 py-2 text-sm">
          {error}
        </p>
      ) : null}

      <Tarjeta className="overflow-hidden">
        <ul className="divide-y">
          {dias.map((dia) => (
            <FilaDia
              key={dia.diaSemana}
              dia={dia}
              slotGlobal={data?.slotGlobal ?? 30}
              slotUsuario={data?.slotUsuario ?? null}
              onCambio={(cambio) => actualizarDia(dia.diaSemana, cambio)}
            />
          ))}
        </ul>
      </Tarjeta>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">
          El tamaño del turno sale del día, si no del barbero, y si no de la configuración general
          ({data?.slotGlobal} min).
        </p>
        <Boton cargando={guardar.isPending} onClick={() => guardar.mutate(false)}>
          <Save />
          Guardar cronograma
        </Boton>
      </div>

      <DialogoConflictos
        citas={conflictos}
        mensaje={mensajeConflicto}
        onCerrar={() => setConflictos(null)}
        onForzar={() => guardar.mutate(true)}
        forzando={guardar.isPending}
        textoForzar="Guardar de todos modos"
      />
    </>
  );
}

function FilaDia({
  dia,
  slotGlobal,
  slotUsuario,
  onCambio,
}: {
  dia: DiaAgenda;
  slotGlobal: number;
  slotUsuario: number | null;
  onCambio: (cambio: Partial<DiaAgenda>) => void;
}) {
  function cambiarHora(campo: 'horaInicio' | 'horaFin', valor: string) {
    const minutos = horaAMinutos(valor);
    if (minutos !== null) onCambio({ [campo]: minutos });
  }

  const heredado = dia.slotMinutos === null;

  return (
    <li className={cn('p-4', !dia.trabaja && 'bg-muted/30')}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {/* Interruptor de trabaja / no trabaja */}
        <label className="flex w-36 shrink-0 cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            className="accent-foreground size-4"
            checked={dia.trabaja}
            onChange={(e) => onCambio({ trabaja: e.target.checked })}
          />
          <span className={cn('font-medium', !dia.trabaja && 'text-muted-foreground')}>
            {nombreDia(dia.diaSemana)}
          </span>
        </label>

        {dia.trabaja ? (
          <>
            <div className="flex items-center gap-2">
              <Entrada
                type="time"
                className="w-36"
                value={minutosAHora(dia.horaInicio)}
                onChange={(e) => cambiarHora('horaInicio', e.target.value)}
              />
              <span className="text-muted-foreground text-sm">a</span>
              <Entrada
                type="time"
                className="w-36"
                value={minutosAHora(dia.horaFin)}
                onChange={(e) => cambiarHora('horaFin', e.target.value)}
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs">Turnos de</span>
              <Entrada
                type="number"
                min={5}
                max={240}
                step={5}
                className="w-20"
                value={dia.slotMinutos ?? dia.slotEfectivo}
                onChange={(e) => onCambio({ slotMinutos: Number(e.target.value) || null })}
              />
              <span className="text-muted-foreground text-xs">min</span>
              {heredado ? (
                <Insignia variante="contorno" className="text-[10px]">
                  heredado ({slotUsuario ?? slotGlobal})
                </Insignia>
              ) : (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground text-[11px] underline underline-offset-2"
                  onClick={() => onCambio({ slotMinutos: null })}
                >
                  usar el general
                </button>
              )}
            </div>
          </>
        ) : (
          <span className="text-muted-foreground text-sm">No atiende</span>
        )}
      </div>

      {/* Almuerzos y descansos del día */}
      {dia.trabaja ? (
        <div className="mt-3 ml-0 flex flex-wrap items-center gap-2 sm:ml-36">
          {dia.bloques.map((bloque, i) => (
            <span
              key={i}
              className="bg-secondary flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
            >
              <Coffee className="size-3" />
              <Entrada
                type="time"
                className="h-7 w-28 border-0 bg-transparent px-1 text-xs shadow-none"
                value={minutosAHora(bloque.horaInicio)}
                onChange={(e) => {
                  const m = horaAMinutos(e.target.value);
                  if (m === null) return;
                  const bloques = [...dia.bloques];
                  bloques[i] = { ...bloque, horaInicio: m };
                  onCambio({ bloques });
                }}
              />
              <span className="text-muted-foreground">a</span>
              <Entrada
                type="time"
                className="h-7 w-28 border-0 bg-transparent px-1 text-xs shadow-none"
                value={minutosAHora(bloque.horaFin)}
                onChange={(e) => {
                  const m = horaAMinutos(e.target.value);
                  if (m === null) return;
                  const bloques = [...dia.bloques];
                  bloques[i] = { ...bloque, horaFin: m };
                  onCambio({ bloques });
                }}
              />
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive"
                title="Quitar"
                onClick={() => onCambio({ bloques: dia.bloques.filter((_, j) => j !== i) })}
              >
                <Trash2 className="size-3" />
              </button>
            </span>
          ))}

          {dia.bloques.length < 6 ? (
            <Boton
              variante="fantasma"
              tamano="sm"
              className="text-muted-foreground h-7 text-xs"
              onClick={() =>
                onCambio({
                  bloques: [
                    ...dia.bloques,
                    { tipo: 'ALMUERZO', horaInicio: 13 * 60, horaFin: 14 * 60, etiqueta: 'Almuerzo' },
                  ],
                })
              }
            >
              <Plus className="size-3" />
              Almuerzo o descanso
            </Boton>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

// ============================== EXCEPCIONES =================================

function Excepciones({ usuarioId, sedeId }: { usuarioId: string; sedeId: string }) {
  const cliente = useQueryClient();
  const hoy = aFechaISO(new Date());
  const dentroDeUnAno = aFechaISO(new Date(Date.now() + 365 * 86_400_000));

  const [abierto, setAbierto] = React.useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['excepciones', usuarioId, sedeId],
    queryFn: () =>
      api.get<Excepcion[]>(
        `/agenda/excepciones?usuarioId=${usuarioId}&desde=${hoy}&hasta=${dentroDeUnAno}`,
      ),
  });

  const eliminar = useMutation({
    mutationFn: (id: string) => api.delete(`/agenda/excepciones/${id}`),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['excepciones'] });
      void cliente.invalidateQueries({ queryKey: ['disponibilidad'] });
      void cliente.invalidateQueries({ queryKey: ['calendario'] });
    },
  });

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Boton onClick={() => setAbierto(true)}>
          <Plus />
          Marcar día libre o especial
        </Boton>
      </div>

      <Tarjeta className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <Esqueleto key={i} className="h-14" />
            ))}
          </div>
        ) : data && data.length > 0 ? (
          <ul className="divide-y">
            {data.map((excepcion) => (
              <li key={excepcion.id} className="flex items-center gap-3 p-4">
                <span
                  className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-full',
                    excepcion.tipo === 'CERRADO'
                      ? 'bg-destructive/10 text-destructive'
                      : 'bg-aviso/10 text-aviso',
                  )}
                >
                  {excepcion.tipo === 'CERRADO' ? (
                    <CalendarOff className="size-4" />
                  ) : (
                    <Clock className="size-4" />
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="font-medium capitalize">
                    {fechaLarga(`${excepcion.fecha.slice(0, 10)}T12:00:00`)}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {excepcion.tipo === 'CERRADO'
                      ? 'No atiende'
                      : `Horario especial: ${minutosAHora(excepcion.horaInicio ?? 0)}–${minutosAHora(excepcion.horaFin ?? 0)}`}
                    {excepcion.motivo ? ` · ${excepcion.motivo}` : ''}
                    {excepcion.sede ? ` · solo en ${excepcion.sede.nombre}` : ' · en todas las sedes'}
                  </p>
                </div>

                <Boton
                  variante="fantasma"
                  tamano="iconoSm"
                  title="Quitar: el día vuelve a su horario normal"
                  onClick={() => eliminar.mutate(excepcion.id)}
                  disabled={eliminar.isPending}
                >
                  <Trash2 />
                </Boton>
              </li>
            ))}
          </ul>
        ) : (
          <TarjetaContenido className="p-10 pt-10 text-center">
            <CalendarOff className="text-muted-foreground mx-auto size-8" />
            <p className="mt-3 font-medium">Sin excepciones próximas</p>
            <p className="text-muted-foreground mx-auto mt-1 max-w-sm text-sm">
              Aquí van los días sueltos que se salen del horario habitual: vacaciones, una cita
              médica o una jornada más corta.
            </p>
          </TarjetaContenido>
        )}
      </Tarjeta>

      <DialogoExcepcion
        abierto={abierto}
        onCambio={setAbierto}
        usuarioId={usuarioId}
        sedeId={sedeId}
        onGuardado={() => {
          void cliente.invalidateQueries({ queryKey: ['excepciones'] });
          void cliente.invalidateQueries({ queryKey: ['disponibilidad'] });
          void cliente.invalidateQueries({ queryKey: ['calendario'] });
        }}
      />
    </>
  );
}

function DialogoExcepcion({
  abierto,
  onCambio,
  usuarioId,
  sedeId,
  onGuardado,
}: {
  abierto: boolean;
  onCambio: (v: boolean) => void;
  usuarioId: string;
  sedeId: string;
  onGuardado: () => void;
}) {
  const [fecha, setFecha] = React.useState(aFechaISO(new Date(Date.now() + 86_400_000)));
  const [tipo, setTipo] = React.useState<'CERRADO' | 'HORARIO_ESPECIAL'>('CERRADO');
  const [horaInicio, setHoraInicio] = React.useState('09:00');
  const [horaFin, setHoraFin] = React.useState('14:00');
  const [motivo, setMotivo] = React.useState('');
  const [soloEstaSede, setSoloEstaSede] = React.useState(false);
  const [conflictos, setConflictos] = React.useState<CitaAfectada[] | null>(null);
  const [mensajeConflicto, setMensajeConflicto] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  /**
   * Consulta previa, sin efectos: en cuanto se elige la fecha se comprueba si
   * hay citas. Así el aviso llega mientras el usuario todavía está decidiendo,
   * no después de pulsar Guardar.
   */
  const { data: comprobacion } = useQuery({
    queryKey: ['puede-cerrar', usuarioId, fecha, sedeId],
    queryFn: () =>
      api.get<{ puedeCerrar: boolean; total: number; citas: CitaAfectada[] }>(
        `/agenda/puede-cerrar?usuarioId=${usuarioId}&fecha=${fecha}&sedeId=${sedeId}`,
      ),
    enabled: abierto && Boolean(fecha),
  });

  const guardar = useMutation({
    mutationFn: (forzar: boolean) =>
      api.post('/agenda/excepciones', {
        usuarioId,
        sedeId: soloEstaSede ? sedeId : null,
        fecha,
        tipo,
        ...(tipo === 'HORARIO_ESPECIAL'
          ? { horaInicio: horaAMinutos(horaInicio), horaFin: horaAMinutos(horaFin) }
          : {}),
        motivo: motivo || undefined,
        forzar,
      }),
    onSuccess: () => {
      setConflictos(null);
      setMotivo('');
      onCambio(false);
      onGuardado();
    },
    onError: (e) => {
      if (e instanceof ErrorApi && e.codigo === 'DIA_CON_RESERVAS') {
        const detalle = e.detalle as { citas?: CitaAfectada[] } | undefined;
        setConflictos(detalle?.citas ?? []);
        setMensajeConflicto(e.mensaje);
      } else {
        setError(e instanceof ErrorApi ? e.mensaje : 'No se pudo guardar.');
      }
    },
  });

  return (
    <>
      <Dialogo open={abierto} onOpenChange={onCambio}>
        <DialogoContenido>
          <DialogoCabecera>
            <DialogoTitulo>Día libre o horario especial</DialogoTitulo>
            <DialogoDescripcion>
              Para un día concreto. Manda sobre el horario habitual de esa semana.
            </DialogoDescripcion>
          </DialogoCabecera>

          {error ? (
            <p className="bg-destructive/10 text-destructive border-destructive/25 rounded-md border px-3 py-2 text-sm">
              {error}
            </p>
          ) : null}

          <Campo etiqueta="Fecha" requerido>
            <Entrada
              type="date"
              min={aFechaISO(new Date())}
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          </Campo>

          {/* El aviso llega antes de pulsar Guardar */}
          {comprobacion && comprobacion.total > 0 ? (
            <div className="bg-aviso/10 border-aviso/30 rounded-md border p-3">
              <p className="text-aviso flex items-center gap-1.5 text-sm font-medium">
                <TriangleAlert className="size-4" />
                Ese día ya tiene {comprobacion.total}{' '}
                {comprobacion.total === 1 ? 'cita reservada' : 'citas reservadas'}
              </p>
              <ul className="mt-2 space-y-1">
                {comprobacion.citas.map((cita) => (
                  <li key={cita.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate">
                      <span className="tabular font-medium">{cita.hora}</span> · {cita.cliente}
                    </span>
                    <a
                      href={`tel:${cita.telefono}`}
                      className="text-muted-foreground hover:text-foreground tabular flex shrink-0 items-center gap-1 underline underline-offset-2"
                    >
                      <Phone className="size-3" />
                      {cita.telefonoVisible}
                    </a>
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground mt-2 text-xs">
                Llámalos para cambiarles la fecha antes de cerrar el día.
              </p>
            </div>
          ) : null}

          <Campo etiqueta="¿Qué pasa ese día?">
            <div className="flex gap-1.5">
              <Boton
                variante={tipo === 'CERRADO' ? 'primario' : 'contorno'}
                tamano="sm"
                className="flex-1"
                onClick={() => setTipo('CERRADO')}
              >
                {tipo === 'CERRADO' ? <Check /> : null}
                No atiendo
              </Boton>
              <Boton
                variante={tipo === 'HORARIO_ESPECIAL' ? 'primario' : 'contorno'}
                tamano="sm"
                className="flex-1"
                onClick={() => setTipo('HORARIO_ESPECIAL')}
              >
                {tipo === 'HORARIO_ESPECIAL' ? <Check /> : null}
                Horario distinto
              </Boton>
            </div>
          </Campo>

          {tipo === 'HORARIO_ESPECIAL' ? (
            <div className="flex items-end gap-2">
              <Campo etiqueta="Desde" className="flex-1">
                <Entrada type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} />
              </Campo>
              <Campo etiqueta="Hasta" className="flex-1">
                <Entrada type="time" value={horaFin} onChange={(e) => setHoraFin(e.target.value)} />
              </Campo>
            </div>
          ) : null}

          <Campo etiqueta="Motivo" ayuda="Para acordarte después. Solo lo ve el panel.">
            <Entrada
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Cita médica, vacaciones…"
            />
          </Campo>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-foreground"
              checked={soloEstaSede}
              onChange={(e) => setSoloEstaSede(e.target.checked)}
            />
            Solo en esta sede (si no, aplica en todas donde atiende)
          </label>

          <DialogoPie>
            <Boton variante="fantasma" onClick={() => onCambio(false)}>
              Cancelar
            </Boton>
            <Boton cargando={guardar.isPending} onClick={() => guardar.mutate(false)}>
              Guardar
            </Boton>
          </DialogoPie>
        </DialogoContenido>
      </Dialogo>

      <DialogoConflictos
        citas={conflictos}
        mensaje={mensajeConflicto}
        onCerrar={() => setConflictos(null)}
        onForzar={() => guardar.mutate(true)}
        forzando={guardar.isPending}
        textoForzar="Cerrar el día de todos modos"
      />
    </>
  );
}

/**
 * Diálogo de citas afectadas.
 *
 * Aparece cuando la API rechaza un cambio porque dejaría citas fuera de
 * horario. Lo importante es que no es un callejón sin salida: lista a cada
 * cliente con su teléfono pulsable, para resolverlo en el momento.
 *
 * Forzar sigue siendo posible —a veces el barbero ya los llamó— pero con el
 * aviso claro de lo que implica, y queda en la auditoría.
 */
function DialogoConflictos({
  citas,
  mensaje,
  onCerrar,
  onForzar,
  forzando,
  textoForzar,
}: {
  citas: CitaAfectada[] | null;
  mensaje: string;
  onCerrar: () => void;
  onForzar: () => void;
  forzando: boolean;
  textoForzar: string;
}) {
  return (
    <Dialogo open={citas !== null} onOpenChange={(v) => !v && onCerrar()}>
      <DialogoContenido>
        <DialogoCabecera>
          <DialogoTitulo className="text-aviso flex items-center gap-2">
            <TriangleAlert className="size-5" />
            Hay clientes con cita
          </DialogoTitulo>
          <DialogoDescripcion>{mensaje}</DialogoDescripcion>
        </DialogoCabecera>

        <ul className="divide-y rounded-lg border">
          {(citas ?? []).map((cita) => (
            <li key={cita.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{cita.cliente}</p>
                <p className="text-muted-foreground text-xs">
                  <span className="tabular">{cita.hora}</span> · {cita.servicios.join(', ')} ·{' '}
                  {cita.codigo}
                </p>
              </div>
              <Boton variante="contorno" tamano="sm" comoHijo>
                <a href={`tel:${cita.telefono}`}>
                  <Phone />
                  <span className="tabular">{cita.telefonoVisible}</span>
                </a>
              </Boton>
            </li>
          ))}
        </ul>

        <p className="text-muted-foreground text-xs">
          Si cierras el día sin avisarles, esos clientes se presentarán igual. Queda registrado en
          la auditoría quién forzó el cambio.
        </p>

        <DialogoPie>
          <Boton variante="fantasma" onClick={onCerrar}>
            Mejor los llamo primero
          </Boton>
          <Boton variante="destructivo" cargando={forzando} onClick={onForzar}>
            {textoForzar}
          </Boton>
        </DialogoPie>
      </DialogoContenido>
    </Dialogo>
  );
}

