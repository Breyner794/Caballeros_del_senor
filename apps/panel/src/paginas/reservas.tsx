import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Gift,
  Plus,
  Search,
  X,
  Zap,
} from 'lucide-react';
import {
  ESTADOS_RESERVA,
  ETIQUETAS_ESTADO,
  puedeTransicionar,
  type EstadoReserva,
  type PaginaRespuesta,
} from '@cds/shared';
import { api } from '@/lib/api';
import { aFechaISO, cn, fechaCorta, hora, pesos } from '@/lib/utils';
import { useSesion } from '@/hooks/sesion';
import { Encabezado } from '@/componentes/armazon';
import { Boton } from '@/componentes/ui/boton';
import { Entrada } from '@/componentes/ui/campo';
import { Tarjeta } from '@/componentes/ui/tarjeta';
import {
  Esqueleto,
  EstadoVacio,
  Insignia,
  Selector,
  SelectorContenido,
  SelectorDisparador,
  SelectorOpcion,
  SelectorValor,
  VARIANTE_POR_ESTADO,
} from '@/componentes/ui/varios';
import { DialogoNuevaReserva } from '@/componentes/dialogo-nueva-reserva';
import { DialogoCobrar } from '@/componentes/dialogo-cobrar';
import { DialogoReprogramar } from '@/componentes/dialogo-reprogramar';
import { DialogoCancelar } from '@/componentes/dialogo-cancelar';

export interface ReservaTabla {
  id: string;
  codigo: string;
  estado: EstadoReserva;
  canal: 'PANEL' | 'WEB' | 'WALK_IN';
  inicioEn: string;
  finEn: string;
  total: string;
  duracionMinutos: number;
  turnoWalkIn: number | null;
  notaCliente: string | null;
  cliente: { id: string; nombreCompleto: string; telefono: string; esGenerico: boolean } | null;
  barbero: { id: string; nombre: string; alias: string | null; fotoUrl: string | null };
  sede: { id: string; nombre: string };
  servicios: { servicioId: string; nombreSnapshot: string; precioSnapshot: string }[];
  canje: { id: string } | null;
}

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

type Rango = 'hoy' | 'semana' | 'mes' | 'todo';

/**
 * Todas las reservas.
 *
 * La pantalla de «Hoy» resuelve el día en curso; esta resuelve lo demás:
 * buscar la cita de alguien que llama, ver qué viene la semana que entra,
 * revisar quién no vino este mes.
 *
 * Por defecto muestra lo que viene a partir de hoy y no el histórico completo,
 * porque el 90% de las veces se abre para gestionar algo que aún no ha pasado.
 */
export function PaginaReservas() {
  const { puede } = useSesion();
  const cliente = useQueryClient();

  const [pagina, setPagina] = React.useState(1);
  const [busqueda, setBusqueda] = React.useState('');
  const [termino, setTermino] = React.useState('');
  const [estado, setEstado] = React.useState<EstadoReserva | 'todos'>('todos');
  const [sedeId, setSedeId] = React.useState('');
  const [barberoId, setBarberoId] = React.useState('');
  const [rango, setRango] = React.useState<Rango>('semana');

  const [nuevaAbierta, setNuevaAbierta] = React.useState(false);
  const [aCobrar, setACobrar] = React.useState<ReservaTabla | null>(null);
  const [aReprogramar, setAReprogramar] = React.useState<ReservaTabla | null>(null);
  const [aCancelar, setACancelar] = React.useState<ReservaTabla | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => {
      setTermino(busqueda.trim());
      setPagina(1);
    }, 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  const { data: sedes } = useQuery({
    queryKey: ['sedes', 'activas'],
    queryFn: () => api.get<Sede[]>('/sedes?soloActivas=true'),
  });

  const { data: barberos } = useQuery({
    queryKey: ['barberos', sedeId],
    queryFn: () => api.get<Barbero[]>(`/sedes/${sedeId}/barberos`),
    enabled: Boolean(sedeId),
  });

  const { desde, hasta } = React.useMemo(() => calcularRango(rango), [rango]);

  const consulta = new URLSearchParams({
    pagina: String(pagina),
    limite: '20',
    orden: rango === 'todo' ? 'desc' : 'asc',
  });
  if (termino) consulta.set('buscar', termino);
  if (estado !== 'todos') consulta.set('estado', estado);
  if (sedeId) consulta.set('sedeId', sedeId);
  if (barberoId) consulta.set('barberoId', barberoId);
  if (desde) consulta.set('desde', desde);
  if (hasta) consulta.set('hasta', hasta);

  const { data, isLoading } = useQuery({
    queryKey: ['reservas', consulta.toString()],
    queryFn: () => api.get<PaginaRespuesta<ReservaTabla>>(`/reservas?${consulta.toString()}`),
  });

  const cambiarEstado = useMutation({
    mutationFn: ({ id, accion }: { id: string; accion: 'iniciar' | 'no-asistio' }) =>
      api.patch(`/reservas/${id}/${accion}`),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['reservas'] }),
  });

  function refrescar() {
    void cliente.invalidateQueries({ queryKey: ['reservas'] });
    void cliente.invalidateQueries({ queryKey: ['agenda-del-dia'] });
    void cliente.invalidateQueries({ queryKey: ['disponibilidad'] });
    void cliente.invalidateQueries({ queryKey: ['calendario'] });
  }

  const hayFiltros = Boolean(termino || estado !== 'todos' || sedeId || barberoId);

  return (
    <>
      <Encabezado titulo="Reservas" descripcion="Todas las citas, pasadas y futuras.">
        {puede('reservas:crear') ? (
          <Boton onClick={() => setNuevaAbierta(true)}>
            <Plus />
            Nueva reserva
          </Boton>
        ) : null}
      </Encabezado>

      {/* Filtros */}
      <div className="mb-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Entrada
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Código de reserva, nombre o celular…"
              className="pl-9"
            />
          </div>

          <Selector
            value={estado}
            onValueChange={(v) => {
              setEstado(v as EstadoReserva | 'todos');
              setPagina(1);
            }}
          >
            <SelectorDisparador className="w-40">
              <SelectorValor placeholder="Estado" />
            </SelectorDisparador>
            <SelectorContenido>
              <SelectorOpcion value="todos">Cualquier estado</SelectorOpcion>
              {ESTADOS_RESERVA.map((e) => (
                <SelectorOpcion key={e} value={e}>
                  {ETIQUETAS_ESTADO[e]}
                </SelectorOpcion>
              ))}
            </SelectorContenido>
          </Selector>

          <Selector
            value={sedeId || 'todas'}
            onValueChange={(v) => {
              setSedeId(v === 'todas' ? '' : v);
              setBarberoId('');
              setPagina(1);
            }}
          >
            <SelectorDisparador className="w-44">
              <SelectorValor placeholder="Sede" />
            </SelectorDisparador>
            <SelectorContenido>
              <SelectorOpcion value="todas">Todas las sedes</SelectorOpcion>
              {(sedes ?? []).map((s) => (
                <SelectorOpcion key={s.id} value={s.id}>
                  {s.nombre}
                </SelectorOpcion>
              ))}
            </SelectorContenido>
          </Selector>

          {puede('reservas:ver_todas') && sedeId ? (
            <Selector
              value={barberoId || 'todos'}
              onValueChange={(v) => {
                setBarberoId(v === 'todos' ? '' : v);
                setPagina(1);
              }}
            >
              <SelectorDisparador className="w-40">
                <SelectorValor placeholder="Barbero" />
              </SelectorDisparador>
              <SelectorContenido>
                <SelectorOpcion value="todos">Todos</SelectorOpcion>
                {(barberos ?? []).map((b) => (
                  <SelectorOpcion key={b.id} value={b.id}>
                    {b.alias ?? b.nombre}
                  </SelectorOpcion>
                ))}
              </SelectorContenido>
            </Selector>
          ) : null}

          {hayFiltros ? (
            <Boton
              variante="fantasma"
              tamano="sm"
              onClick={() => {
                setBusqueda('');
                setEstado('todos');
                setSedeId('');
                setBarberoId('');
                setPagina(1);
              }}
            >
              <X />
              Limpiar
            </Boton>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['hoy', 'Hoy'],
              ['semana', 'Próximos 7 días'],
              ['mes', 'Este mes'],
              ['todo', 'Todo el histórico'],
            ] as const
          ).map(([valor, texto]) => (
            <Boton
              key={valor}
              variante={rango === valor ? 'secundario' : 'fantasma'}
              tamano="sm"
              onClick={() => {
                setRango(valor);
                setPagina(1);
              }}
            >
              {texto}
            </Boton>
          ))}
        </div>
      </div>

      <Tarjeta className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <Esqueleto key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : data && data.datos.length > 0 ? (
          <>
            <ul className="divide-y">
              {data.datos.map((reserva) => (
                <FilaReserva
                  key={reserva.id}
                  reserva={reserva}
                  mostrarBarbero={puede('reservas:ver_todas')}
                  ocupado={cambiarEstado.isPending}
                  onIniciar={() => cambiarEstado.mutate({ id: reserva.id, accion: 'iniciar' })}
                  onNoAsistio={() => cambiarEstado.mutate({ id: reserva.id, accion: 'no-asistio' })}
                  onCobrar={() => setACobrar(reserva)}
                  onReprogramar={() => setAReprogramar(reserva)}
                  onCancelar={() => setACancelar(reserva)}
                  puedeEditar={puede('reservas:editar')}
                  puedeCancelar={puede('reservas:cancelar')}
                  puedeCobrar={puede('reservas:completar')}
                />
              ))}
            </ul>

            <div className="text-muted-foreground flex items-center justify-between gap-2 border-t px-4 py-3 text-xs">
              <span>
                {data.meta.total} {data.meta.total === 1 ? 'reserva' : 'reservas'}
                {data.meta.totalPaginas > 1
                  ? ` · página ${data.meta.pagina} de ${data.meta.totalPaginas}`
                  : ''}
              </span>
              <div className="flex gap-1">
                <Boton
                  variante="contorno"
                  tamano="iconoSm"
                  disabled={!data.meta.hayAnterior}
                  onClick={() => setPagina((p) => p - 1)}
                >
                  <ChevronLeft />
                </Boton>
                <Boton
                  variante="contorno"
                  tamano="iconoSm"
                  disabled={!data.meta.haySiguiente}
                  onClick={() => setPagina((p) => p + 1)}
                >
                  <ChevronRight />
                </Boton>
              </div>
            </div>
          </>
        ) : (
          <EstadoVacio
            icono={CalendarRange}
            titulo={hayFiltros ? 'Ninguna reserva coincide' : 'No hay reservas en este periodo'}
            descripcion={
              hayFiltros
                ? 'Prueba a quitar algún filtro o a ampliar el rango de fechas.'
                : 'Cuando se registren citas aparecerán aquí.'
            }
          />
        )}
      </Tarjeta>

      <DialogoNuevaReserva
        abierto={nuevaAbierta}
        onCambio={setNuevaAbierta}
        onGuardado={refrescar}
      />
      {aCobrar ? (
        <DialogoCobrar
          reserva={aCobrar}
          abierto
          onCambio={(v) => !v && setACobrar(null)}
          onCobrado={() => {
            setACobrar(null);
            refrescar();
          }}
        />
      ) : null}
      {aReprogramar ? (
        <DialogoReprogramar
          reserva={aReprogramar}
          abierto
          onCambio={(v) => !v && setAReprogramar(null)}
          onGuardado={() => {
            setAReprogramar(null);
            refrescar();
          }}
        />
      ) : null}
      {aCancelar ? (
        <DialogoCancelar
          reserva={aCancelar}
          abierto
          onCambio={(v) => !v && setACancelar(null)}
          onCancelada={() => {
            setACancelar(null);
            refrescar();
          }}
        />
      ) : null}
    </>
  );
}

function FilaReserva({
  reserva,
  mostrarBarbero,
  ocupado,
  onIniciar,
  onNoAsistio,
  onCobrar,
  onReprogramar,
  onCancelar,
  puedeEditar,
  puedeCancelar,
  puedeCobrar,
}: {
  reserva: ReservaTabla;
  mostrarBarbero: boolean;
  ocupado: boolean;
  onIniciar: () => void;
  onNoAsistio: () => void;
  onCobrar: () => void;
  onReprogramar: () => void;
  onCancelar: () => void;
  puedeEditar: boolean;
  puedeCancelar: boolean;
  puedeCobrar: boolean;
}) {
  const cerrada = ['COMPLETADA', 'CANCELADA', 'NO_ASISTIO'].includes(reserva.estado);
  // Las acciones se derivan de las transiciones permitidas del dominio, no de
  // una lista escrita a mano aquí: si mañana cambia la máquina de estados, los
  // botones se ajustan solos.
  const sePuedeIniciar = puedeTransicionar(reserva.estado, 'EN_CURSO');
  const sePuedeCobrar = puedeTransicionar(reserva.estado, 'COMPLETADA');
  const sePuedeCancelar = puedeTransicionar(reserva.estado, 'CANCELADA');
  const sePuedeMarcarAusente = puedeTransicionar(reserva.estado, 'NO_ASISTIO');

  return (
    <li className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 p-4', cerrada && 'opacity-60')}>
      <div className="w-24 shrink-0">
        <p className="text-muted-foreground text-xs capitalize">{fechaCorta(reserva.inicioEn)}</p>
        <p className="tabular text-lg leading-tight font-semibold">{hora(reserva.inicioEn)}</p>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-medium">
            {reserva.cliente?.esGenerico
              ? 'Cliente sin registrar'
              : (reserva.cliente?.nombreCompleto ?? 'Sin ficha')}
          </p>
          <Insignia variante={VARIANTE_POR_ESTADO[reserva.estado]}>
            {ETIQUETAS_ESTADO[reserva.estado]}
          </Insignia>
          {reserva.canal === 'WALK_IN' ? (
            <Insignia variante="contorno">
              <Zap className="size-3" />
              Sin cita
            </Insignia>
          ) : null}
          {reserva.canal === 'WEB' ? <Insignia variante="contorno">Web</Insignia> : null}
          {reserva.canje ? (
            <Insignia variante="exito">
              <Gift className="size-3" />
              Premio
            </Insignia>
          ) : null}
          <span className="text-muted-foreground tabular text-xs">{reserva.codigo}</span>
        </div>

        <p className="text-muted-foreground mt-0.5 truncate text-sm">
          {reserva.servicios.map((s) => s.nombreSnapshot).join(' + ')} ·{' '}
          <span className="tabular">{pesos(reserva.total)}</span>
          {mostrarBarbero ? ` · ${reserva.barbero.alias ?? reserva.barbero.nombre}` : ''} ·{' '}
          {reserva.sede.nombre}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {sePuedeIniciar && puedeEditar ? (
          <Boton variante="contorno" tamano="sm" onClick={onIniciar} disabled={ocupado}>
            Empezar
          </Boton>
        ) : null}

        {sePuedeCobrar && puedeCobrar ? (
          <Boton tamano="sm" onClick={onCobrar}>
            <CircleDollarSign />
            Cobrar
          </Boton>
        ) : null}

        {sePuedeCancelar && puedeEditar ? (
          <Boton variante="fantasma" tamano="sm" onClick={onReprogramar}>
            Mover
          </Boton>
        ) : null}

        {sePuedeMarcarAusente && puedeEditar ? (
          <Boton
            variante="fantasma"
            tamano="sm"
            className="text-muted-foreground"
            onClick={onNoAsistio}
            disabled={ocupado}
          >
            No vino
          </Boton>
        ) : null}

        {sePuedeCancelar && puedeCancelar ? (
          <Boton
            variante="fantasma"
            tamano="iconoSm"
            className="text-muted-foreground hover:text-destructive"
            title="Cancelar la cita"
            onClick={onCancelar}
          >
            <X />
          </Boton>
        ) : null}
      </div>
    </li>
  );
}

/** Traduce el filtro rápido de periodo a fechas concretas. */
function calcularRango(rango: Rango): { desde?: string; hasta?: string } {
  const hoy = new Date();

  if (rango === 'todo') return {};
  if (rango === 'hoy') {
    const f = aFechaISO(hoy);
    return { desde: f, hasta: f };
  }
  if (rango === 'semana') {
    return { desde: aFechaISO(hoy), hasta: aFechaISO(new Date(Date.now() + 7 * 86_400_000)) };
  }
  return {
    desde: aFechaISO(new Date(hoy.getFullYear(), hoy.getMonth(), 1)),
    hasta: aFechaISO(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0)),
  };
}
