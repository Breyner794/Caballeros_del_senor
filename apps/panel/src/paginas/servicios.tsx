import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  Clock,
  Plus,
  Scissors,
  Search,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import type { PaginaRespuesta } from '@cds/shared';
import { api, ErrorApi } from '@/lib/api';
import { cn, pesos } from '@/lib/utils';
import { useSesion } from '@/hooks/sesion';
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
  Selector,
  SelectorContenido,
  SelectorDisparador,
  SelectorOpcion,
  SelectorValor,
  Separador,
} from '@/componentes/ui/varios';

interface Servicio {
  id: string;
  nombre: string;
  descripcion: string | null;
  incluye: string[];
  precio: string;
  duracionMinutos: number;
  bufferMinutos: number | null;
  activo: boolean;
  visibleWeb: boolean;
  cuentaFidelidad: boolean;
  canjeableFidelidad: boolean;
  color: string | null;
  orden: number;
  usos: { total: number; futuras: number };
}

/**
 * Lo que llega de la API.
 *
 * `usos` va aparte porque una respuesta cacheada de antes de añadirlo no lo
 * trae, y la tarjeta lo lee sin comprobar.
 */
interface ServicioRespuesta extends Omit<Servicio, 'usos'> {
  usos?: { total: number; futuras: number };
}

/**
 * Paleta para el calendario.
 *
 * El panel es blanco y negro a propósito; estos colores existen solo para
 * distinguir servicios de un vistazo en la agenda, así que son apagados: en una
 * columna de citas tienen que leerse como etiquetas, no competir con los avisos.
 */
const COLORES = [
  '#64748b',
  '#0f766e',
  '#1d4ed8',
  '#7e22ce',
  '#b91c1c',
  '#c2410c',
  '#a16207',
  '#15803d',
];

/** Duraciones habituales de una barbería, para no teclear el número. */
const DURACIONES = [15, 20, 30, 45, 60, 90];

export function PaginaServicios() {
  const cliente = useQueryClient();
  const { puede } = useSesion();
  const gestiona = puede('servicios:gestionar');

  const [buscar, setBuscar] = React.useState('');
  const [estado, setEstado] = React.useState<'todos' | 'activos' | 'inactivos'>('todos');
  const [editando, setEditando] = React.useState<Servicio | null>(null);
  const [creando, setCreando] = React.useState(false);
  const [eliminando, setEliminando] = React.useState<Servicio | null>(null);
  const [aviso, setAviso] = React.useState<string | null>(null);

  const parametros = new URLSearchParams({ limite: '100' });
  if (buscar.trim()) parametros.set('buscar', buscar.trim());
  if (estado !== 'todos') parametros.set('activo', estado === 'activos' ? 'true' : 'false');

  const { data, isLoading } = useQuery({
    queryKey: ['servicios', 'lista', parametros.toString()],
    queryFn: () => api.get<PaginaRespuesta<ServicioRespuesta>>(`/servicios?${parametros.toString()}`),
  });

  const refrescar = () => {
    void cliente.invalidateQueries({ queryKey: ['servicios'] });
  };

  const cambiarEstado = useMutation({
    mutationFn: ({ id, activo }: { id: string; activo: boolean }) =>
      api.patch(`/servicios/${id}/estado`, { activo }),
    onSuccess: refrescar,
    onError: (e) => setAviso(e instanceof ErrorApi ? e.mensaje : 'No se pudo cambiar el estado.'),
  });

  const reordenar = useMutation({
    mutationFn: (orden: { id: string; orden: number }[]) =>
      api.patch('/servicios/reordenar', { orden }),
    onSuccess: refrescar,
    onError: (e) => setAviso(e instanceof ErrorApi ? e.mensaje : 'No se pudo cambiar el orden.'),
  });

  const servicios: Servicio[] = (data?.datos ?? []).map((s) => ({
    ...s,
    usos: s.usos ?? { total: 0, futuras: 0 },
  }));

  /**
   * Mover una tarjeta de sitio.
   *
   * Se reenumera la lista entera y no solo las dos que se intercambian: los
   * `orden` que hay en la base pueden venir repetidos o con huecos de ediciones
   * anteriores, y renumerar de cero deja siempre una secuencia limpia.
   */
  function mover(indice: number, direccion: -1 | 1) {
    const destino = indice + direccion;
    if (destino < 0 || destino >= servicios.length) return;

    const lista = [...servicios];
    const [sacado] = lista.splice(indice, 1);
    lista.splice(destino, 0, sacado);
    reordenar.mutate(lista.map((s, i) => ({ id: s.id, orden: i })));
  }

  const ordenEditable = gestiona && estado === 'todos' && !buscar.trim();

  return (
    <>
      <Encabezado
        titulo="Servicios"
        descripcion="Lo que ofrece la barbería: precio, duración y qué incluye."
      >
        {gestiona ? (
          <Boton onClick={() => setCreando(true)}>
            <Plus />
            Nuevo servicio
          </Boton>
        ) : null}
      </Encabezado>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Entrada
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder="Buscar por nombre o descripción"
            className="pl-8"
          />
        </div>
        <Selector value={estado} onValueChange={(v) => setEstado(v as typeof estado)}>
          <SelectorDisparador className="w-44">
            <SelectorValor />
          </SelectorDisparador>
          <SelectorContenido>
            <SelectorOpcion value="todos">Todos</SelectorOpcion>
            <SelectorOpcion value="activos">Solo activos</SelectorOpcion>
            <SelectorOpcion value="inactivos">Solo desactivados</SelectorOpcion>
          </SelectorContenido>
        </Selector>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Esqueleto key={i} className="h-48" />
          ))}
        </div>
      ) : servicios.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {servicios.map((servicio, indice) => (
            <Tarjeta
              key={servicio.id}
              className={cn('relative overflow-hidden', !servicio.activo && 'opacity-60')}
            >
              {/* Franja del color que el servicio usa en el calendario */}
              {servicio.color ? (
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 w-1"
                  style={{ backgroundColor: servicio.color }}
                />
              ) : null}

              <TarjetaContenido className="flex h-full flex-col gap-3 p-5 pt-5 pl-6">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">{servicio.nombre}</h3>
                    <p className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
                      <Clock className="size-3" />
                      <span className="tabular">{servicio.duracionMinutos} min</span>
                      {servicio.bufferMinutos ? (
                        <span className="tabular">+ {servicio.bufferMinutos} de limpieza</span>
                      ) : null}
                    </p>
                  </div>
                  <p className="tabular shrink-0 text-lg font-semibold">{pesos(servicio.precio)}</p>
                </div>

                {servicio.descripcion ? (
                  <p className="text-muted-foreground line-clamp-2 text-sm">
                    {servicio.descripcion}
                  </p>
                ) : null}

                {servicio.incluye.length > 0 ? (
                  <ul className="text-muted-foreground space-y-0.5 text-xs">
                    {servicio.incluye.map((item) => (
                      <li key={item} className="flex items-center gap-1.5">
                        <span className="bg-primary size-1 rounded-full" />
                        {item}
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="flex flex-wrap gap-1.5">
                  {!servicio.activo ? <Insignia variante="peligro">Desactivado</Insignia> : null}
                  {!servicio.visibleWeb ? (
                    <Insignia variante="contorno">Solo en el panel</Insignia>
                  ) : null}
                  {!servicio.cuentaFidelidad ? (
                    <Insignia variante="contorno">No suma sellos</Insignia>
                  ) : null}
                </div>

                {/* El uso explica por qué un servicio no se puede eliminar */}
                <p className="text-muted-foreground mt-auto text-xs">
                  {servicio.usos.total === 0
                    ? 'Nunca se ha usado en una cita.'
                    : `En ${servicio.usos.total} ${servicio.usos.total === 1 ? 'cita' : 'citas'}`}
                  {servicio.usos.futuras > 0
                    ? `, ${servicio.usos.futuras} por atender.`
                    : servicio.usos.total > 0
                      ? ', todas atendidas.'
                      : ''}
                </p>

                {gestiona ? (
                  <>
                    <Separador />
                    <div className="flex items-center gap-1">
                      <Boton variante="contorno" tamano="sm" onClick={() => setEditando(servicio)}>
                        Editar
                      </Boton>
                      <Boton
                        variante="fantasma"
                        tamano="sm"
                        className="text-muted-foreground"
                        disabled={cambiarEstado.isPending}
                        onClick={() =>
                          cambiarEstado.mutate({ id: servicio.id, activo: !servicio.activo })
                        }
                      >
                        {servicio.activo ? 'Desactivar' : 'Activar'}
                      </Boton>

                      <div className="ml-auto flex items-center">
                        {ordenEditable ? (
                          <>
                            <Boton
                              variante="fantasma"
                              tamano="iconoSm"
                              aria-label={`Subir ${servicio.nombre} en la lista`}
                              disabled={indice === 0 || reordenar.isPending}
                              onClick={() => mover(indice, -1)}
                            >
                              <ArrowUp className="size-4" />
                            </Boton>
                            <Boton
                              variante="fantasma"
                              tamano="iconoSm"
                              aria-label={`Bajar ${servicio.nombre} en la lista`}
                              disabled={indice === servicios.length - 1 || reordenar.isPending}
                              onClick={() => mover(indice, 1)}
                            >
                              <ArrowDown className="size-4" />
                            </Boton>
                          </>
                        ) : null}
                        <Boton
                          variante="fantasma"
                          tamano="iconoSm"
                          aria-label={`Eliminar ${servicio.nombre}`}
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => setEliminando(servicio)}
                        >
                          <Trash2 className="size-4" />
                        </Boton>
                      </div>
                    </div>
                  </>
                ) : null}
              </TarjetaContenido>
            </Tarjeta>
          ))}
        </div>
      ) : buscar.trim() || estado !== 'todos' ? (
        <Tarjeta>
          <EstadoVacio
            icono={Search}
            titulo="Ningún servicio coincide"
            descripcion="Prueba con otro nombre o quita el filtro de estado."
          >
            <Boton
              variante="contorno"
              onClick={() => {
                setBuscar('');
                setEstado('todos');
              }}
            >
              Ver todos
            </Boton>
          </EstadoVacio>
        </Tarjeta>
      ) : (
        <Tarjeta>
          <EstadoVacio
            icono={Scissors}
            titulo="Todavía no hay servicios"
            descripcion="Sin servicios no se pueden registrar reservas: son los que definen el precio y, sobre todo, cuánto dura cada cita."
          >
            {gestiona ? (
              <Boton onClick={() => setCreando(true)}>
                <Plus />
                Crear el primer servicio
              </Boton>
            ) : null}
          </EstadoVacio>
        </Tarjeta>
      )}

      {creando || editando ? (
        <DialogoServicio
          servicio={editando ?? undefined}
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
            refrescar();
          }}
        />
      ) : null}

      {eliminando ? (
        <DialogoEliminar
          servicio={eliminando}
          onCerrar={() => setEliminando(null)}
          onEliminado={() => {
            setEliminando(null);
            refrescar();
          }}
          onDesactivar={() => {
            cambiarEstado.mutate({ id: eliminando.id, activo: false });
            setEliminando(null);
          }}
        />
      ) : null}

      <Dialogo open={aviso !== null} onOpenChange={(v) => !v && setAviso(null)}>
        <DialogoContenido>
          <DialogoCabecera>
            <DialogoTitulo className="text-aviso flex items-center gap-2">
              <TriangleAlert className="size-5" />
              No se pudo hacer el cambio
            </DialogoTitulo>
            <DialogoDescripcion>{aviso}</DialogoDescripcion>
          </DialogoCabecera>
          <DialogoPie>
            <Boton onClick={() => setAviso(null)}>Entendido</Boton>
          </DialogoPie>
        </DialogoContenido>
      </Dialogo>
    </>
  );
}

// =========================== formulario =====================================

function DialogoServicio({
  servicio,
  abierto,
  onCambio,
  onGuardado,
}: {
  servicio?: Servicio;
  abierto: boolean;
  onCambio: (v: boolean) => void;
  onGuardado: () => void;
}) {
  const esNuevo = !servicio;

  const [nombre, setNombre] = React.useState(servicio?.nombre ?? '');
  const [descripcion, setDescripcion] = React.useState(servicio?.descripcion ?? '');
  const [precio, setPrecio] = React.useState(
    servicio ? String(Math.round(Number(servicio.precio))) : '',
  );
  const [duracion, setDuracion] = React.useState(String(servicio?.duracionMinutos ?? 30));
  const [buffer, setBuffer] = React.useState(
    servicio?.bufferMinutos === null || servicio?.bufferMinutos === undefined
      ? ''
      : String(servicio.bufferMinutos),
  );
  const [color, setColor] = React.useState<string | null>(servicio?.color ?? null);
  const [incluye, setIncluye] = React.useState<string[]>(servicio?.incluye ?? []);
  const [nuevoItem, setNuevoItem] = React.useState('');
  const [visibleWeb, setVisibleWeb] = React.useState(servicio?.visibleWeb ?? true);
  const [cuentaFidelidad, setCuentaFidelidad] = React.useState(servicio?.cuentaFidelidad ?? true);
  const [canjeableFidelidad, setCanjeableFidelidad] = React.useState(
    servicio?.canjeableFidelidad ?? true,
  );

  const [error, setError] = React.useState<string | null>(null);
  const [campos, setCampos] = React.useState<Record<string, string[]>>({});

  function agregarItem() {
    const limpio = nuevoItem.trim();
    if (!limpio || incluye.includes(limpio)) {
      setNuevoItem('');
      return;
    }
    setIncluye((previos) => [...previos, limpio]);
    setNuevoItem('');
  }

  const guardar = useMutation({
    mutationFn: () => {
      const datos = {
        nombre,
        descripcion: descripcion.trim() || undefined,
        incluye,
        precio: Number(precio),
        duracionMinutos: Number(duracion),
        // Vacío significa "lo que diga la configuración general", y eso es un
        // null explícito, no un cero: cero sería "sin limpieza entre citas".
        bufferMinutos: buffer.trim() === '' ? null : Number(buffer),
        color: color ?? undefined,
        visibleWeb,
        cuentaFidelidad,
        canjeableFidelidad,
      };
      return esNuevo ? api.post('/servicios', datos) : api.patch(`/servicios/${servicio.id}`, datos);
    },
    onSuccess: onGuardado,
    onError: (e) => {
      if (e instanceof ErrorApi) {
        setError(e.mensaje);
        setCampos(e.campos ?? {});
      } else {
        setError('No se pudo guardar el servicio.');
      }
    },
  });

  return (
    <Dialogo open={abierto} onOpenChange={onCambio}>
      <DialogoContenido anchoMaximo="max-w-xl">
        <DialogoCabecera>
          <DialogoTitulo>{esNuevo ? 'Nuevo servicio' : `Editar ${servicio.nombre}`}</DialogoTitulo>
          <DialogoDescripcion>
            La duración es lo que más pesa: de ella salen los huecos que verá el cliente al reservar.
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
              placeholder="Corte clásico"
            />
          </Campo>

          <Campo etiqueta="Precio" requerido error={campos.precio?.[0]}>
            <Entrada
              type="number"
              min={0}
              step={1000}
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              placeholder="25000"
            />
          </Campo>

          <Campo
            etiqueta="Duración"
            requerido
            error={campos.duracionMinutos?.[0]}
            ayuda="Minutos que ocupa la silla."
          >
            <div className="flex items-center gap-2">
              <Entrada
                type="number"
                min={5}
                max={600}
                step={5}
                className="w-24"
                value={duracion}
                onChange={(e) => setDuracion(e.target.value)}
              />
              <div className="flex flex-wrap gap-1">
                {DURACIONES.map((m) => (
                  <Boton
                    key={m}
                    type="button"
                    variante={Number(duracion) === m ? 'secundario' : 'fantasma'}
                    tamano="sm"
                    className="tabular px-2"
                    onClick={() => setDuracion(String(m))}
                  >
                    {m}
                  </Boton>
                ))}
              </div>
            </div>
          </Campo>

          <Campo
            etiqueta="Limpieza después"
            error={campos.bufferMinutos?.[0]}
            ayuda="Vacío = lo que diga la configuración general."
          >
            <Entrada
              type="number"
              min={0}
              max={120}
              step={5}
              className="w-24"
              value={buffer}
              onChange={(e) => setBuffer(e.target.value)}
              placeholder="—"
            />
          </Campo>

          <Campo
            etiqueta="Color en la agenda"
            ayuda="Solo para distinguirlo de un vistazo en el calendario."
          >
            <div className="flex flex-wrap items-center gap-1.5">
              {COLORES.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  aria-label={`Usar el color ${hex}`}
                  aria-pressed={color === hex}
                  onClick={() => setColor(hex)}
                  className={cn(
                    'size-6 rounded-full border-2 transition',
                    color === hex ? 'border-foreground' : 'border-transparent',
                  )}
                  style={{ backgroundColor: hex }}
                />
              ))}
              <Boton
                type="button"
                variante="fantasma"
                tamano="sm"
                className="text-muted-foreground"
                onClick={() => setColor(null)}
              >
                Sin color
              </Boton>
            </div>
          </Campo>

          <Campo
            etiqueta="Descripción"
            error={campos.descripcion?.[0]}
            className="sm:col-span-2"
            ayuda="Se muestra en la web del cliente."
          >
            <AreaTexto
              rows={2}
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
            />
          </Campo>
        </div>

        <Separador />

        <div className="space-y-2">
          <p className="text-sm font-medium">Qué incluye</p>
          {incluye.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {incluye.map((item) => (
                <li
                  key={item}
                  className="bg-muted flex items-center gap-1 rounded-full py-1 pr-1 pl-2.5 text-xs"
                >
                  {item}
                  <button
                    type="button"
                    aria-label={`Quitar ${item}`}
                    className="text-muted-foreground hover:text-foreground rounded-full p-0.5"
                    onClick={() => setIncluye((previos) => previos.filter((i) => i !== item))}
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-xs">
              Opcional. Sirve para que el cliente sepa qué entra en el precio.
            </p>
          )}
          <div className="flex gap-2">
            <Entrada
              value={nuevoItem}
              onChange={(e) => setNuevoItem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  agregarItem();
                }
              }}
              placeholder="Lavado, perfilado de barba…"
            />
            <Boton type="button" variante="contorno" onClick={agregarItem}>
              Añadir
            </Boton>
          </div>
        </div>

        <Separador />

        <div className="space-y-2.5">
          <Interruptor
            marcado={visibleWeb}
            onCambio={setVisibleWeb}
            etiqueta="Visible en la web del cliente"
            ayuda="Si lo apagas, solo se puede agendar desde el panel."
          />
          <Interruptor
            marcado={cuentaFidelidad}
            onCambio={setCuentaFidelidad}
            etiqueta="Suma sello de fidelidad"
            ayuda="Cada cita con este servicio acerca al cliente al corte de cortesía."
          />
          <Interruptor
            marcado={canjeableFidelidad}
            onCambio={setCanjeableFidelidad}
            etiqueta="Se puede pagar con un canje"
            ayuda="Apágalo en los servicios caros que no quieras regalar."
          />
        </div>

        <DialogoPie>
          <Boton variante="fantasma" onClick={() => onCambio(false)}>
            Cancelar
          </Boton>
          <Boton cargando={guardar.isPending} onClick={() => guardar.mutate()}>
            {esNuevo ? 'Crear servicio' : 'Guardar cambios'}
          </Boton>
        </DialogoPie>
      </DialogoContenido>
    </Dialogo>
  );
}

function Interruptor({
  marcado,
  onCambio,
  etiqueta,
  ayuda,
}: {
  marcado: boolean;
  onCambio: (v: boolean) => void;
  etiqueta: string;
  ayuda?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        className="accent-foreground mt-0.5 size-4 shrink-0"
        checked={marcado}
        onChange={(e) => onCambio(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-sm">{etiqueta}</span>
        {ayuda ? <span className="text-muted-foreground block text-xs">{ayuda}</span> : null}
      </span>
    </label>
  );
}

// =========================== eliminación ====================================

/**
 * Confirmar la eliminación.
 *
 * Se eliminan pocas veces y casi nunca es lo que hace falta: desactivar guarda
 * el historial y quita el servicio de los formularios igual. Por eso el diálogo
 * ofrece las dos salidas y deja la destructiva en segundo lugar.
 */
function DialogoEliminar({
  servicio,
  onCerrar,
  onEliminado,
  onDesactivar,
}: {
  servicio: Servicio;
  onCerrar: () => void;
  onEliminado: () => void;
  onDesactivar: () => void;
}) {
  const [error, setError] = React.useState<string | null>(null);

  const eliminar = useMutation({
    mutationFn: () => api.delete(`/servicios/${servicio.id}`),
    onSuccess: onEliminado,
    onError: (e) =>
      setError(e instanceof ErrorApi ? e.mensaje : 'No se pudo eliminar el servicio.'),
  });

  return (
    <Dialogo open onOpenChange={(v) => !v && onCerrar()}>
      <DialogoContenido>
        <DialogoCabecera>
          <DialogoTitulo>¿Eliminar «{servicio.nombre}»?</DialogoTitulo>
          <DialogoDescripcion>
            {servicio.usos.total === 0
              ? 'No se ha usado en ninguna cita, así que no deja nada atrás.'
              : `Las ${servicio.usos.total} ${
                  servicio.usos.total === 1 ? 'cita' : 'citas'
                } que ya lo usaron conservan su nombre y su precio de entonces, y las cuentas del contador no cambian. Lo que desaparece es la posibilidad de volver a agendarlo.`}
          </DialogoDescripcion>
        </DialogoCabecera>

        {/* El bloqueo real lo pone la API; esto solo evita el viaje en balde */}
        {!error && servicio.usos.futuras > 0 ? (
          <p className="bg-aviso/10 text-aviso border-aviso/30 rounded-md border px-3 py-2 text-sm">
            No se va a poder: hay {servicio.usos.futuras}{' '}
            {servicio.usos.futuras === 1 ? 'cita sin atender' : 'citas sin atender'} con este
            servicio. Desactívalo, o atiende primero esas citas.
          </p>
        ) : null}

        {error ? (
          <p className="bg-aviso/10 text-aviso border-aviso/30 rounded-md border px-3 py-2 text-sm">
            {error}
          </p>
        ) : null}

        <DialogoPie>
          <Boton variante="fantasma" onClick={onCerrar}>
            Cancelar
          </Boton>
          {servicio.activo ? (
            <Boton variante="contorno" onClick={onDesactivar}>
              Mejor desactivarlo
            </Boton>
          ) : null}
          <Boton
            variante="destructivo"
            cargando={eliminar.isPending}
            onClick={() => eliminar.mutate()}
          >
            Eliminar
          </Boton>
        </DialogoPie>
      </DialogoContenido>
    </Dialogo>
  );
}
