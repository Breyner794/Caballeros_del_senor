import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Check,
  Clock,
  Gift,
  Loader2,
  Search,
  UserPlus,
  UserRound,
  X,
  Zap,
} from 'lucide-react';
import { api, ErrorApi } from '@/lib/api';
import { aFechaISO, cn, pesos, tiempoRelativo } from '@/lib/utils';
import { useSesion } from '@/hooks/sesion';
import { Boton } from '@/componentes/ui/boton';
import { AreaTexto, Campo, Entrada } from '@/componentes/ui/campo';
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
  Separador,
} from '@/componentes/ui/varios';

interface Sede {
  id: string;
  nombre: string;
  activa: boolean;
}

interface Barbero {
  id: string;
  nombre: string;
  apellido: string | null;
  alias: string | null;
  fotoUrl: string | null;
}

interface Servicio {
  id: string;
  nombre: string;
  precio: string;
  duracionMinutos: number;
  incluye: string[];
  color: string | null;
}

interface ClienteEncontrado {
  id: string;
  nombreCompleto: string;
  telefono: string;
  telefonoVisible: string;
  totalVisitas: number;
  ultimaVisitaEn: string | null;
  sellosDisponibles: number;
  sellosRequeridos: number;
  tienePremio: boolean;
  notas: string | null;
}

interface Hueco {
  inicioEn: string;
  hora: string;
  disponible: boolean;
  motivo?: string;
}

interface Disponibilidad {
  fecha: string;
  laborable: boolean;
  motivo?: string;
  duracionNecesaria: number;
  barberos: {
    barberoId: string;
    barberoNombre: string;
    trabaja: boolean;
    motivoNoTrabaja?: string;
    slotMinutos: number;
    huecos: Hueco[];
  }[];
}

/**
 * Formulario de reserva.
 *
 * El orden de los pasos sigue la conversación real del mostrador: primero
 * quién es el cliente (lo que la recepción pregunta al descolgar), luego qué
 * se va a hacer, y por último cuándo. La hora va al final a propósito: hasta
 * saber qué servicios lleva no se puede calcular qué huecos caben, y ofrecer
 * horas antes obligaría a cambiarlas después.
 *
 * En modo `walk-in` desaparece el paso de la hora: el cliente ya está en la
 * silla, así que el sistema le asigna el siguiente hueco libre y un número de
 * turno.
 */
export function DialogoNuevaReserva({
  abierto,
  onCambio,
  onGuardado,
  modo = 'reserva',
}: {
  abierto: boolean;
  onCambio: (abierto: boolean) => void;
  onGuardado: () => void;
  modo?: 'reserva' | 'walk-in';
}) {
  const { usuario } = useSesion();
  const esWalkIn = modo === 'walk-in';

  // --- Estado del formulario ---------------------------------------------
  const [sedeId, setSedeId] = React.useState<string>('');
  const [barberoId, setBarberoId] = React.useState<string>('');
  const [servicioIds, setServicioIds] = React.useState<string[]>([]);
  const [fecha, setFecha] = React.useState(aFechaISO(new Date()));
  const [inicioEn, setInicioEn] = React.useState<string | null>(null);
  const [nota, setNota] = React.useState('');

  // Cliente: o uno existente, o uno nuevo, o ninguno (walk-in anónimo).
  const [busqueda, setBusqueda] = React.useState('');
  const [clienteElegido, setClienteElegido] = React.useState<ClienteEncontrado | null>(null);
  const [creandoCliente, setCreandoCliente] = React.useState(false);
  const [nombreNuevo, setNombreNuevo] = React.useState('');
  const [telefonoNuevo, setTelefonoNuevo] = React.useState('');
  const [aplicarPremio, setAplicarPremio] = React.useState(false);
  const [cobrarYa, setCobrarYa] = React.useState(esWalkIn);

  const [errorGeneral, setErrorGeneral] = React.useState<string | null>(null);
  const [campos, setCampos] = React.useState<Record<string, string[]>>({});
  const [alternativas, setAlternativas] = React.useState<Hueco[]>([]);

  // --- Datos de apoyo -----------------------------------------------------
  const { data: sedes } = useQuery({
    queryKey: ['sedes', 'activas'],
    queryFn: () => api.get<Sede[]>('/sedes?soloActivas=true'),
    enabled: abierto,
  });

  const { data: barberos } = useQuery({
    queryKey: ['barberos', sedeId],
    queryFn: () => api.get<Barbero[]>(`/sedes/${sedeId}/barberos`),
    enabled: abierto && Boolean(sedeId),
  });

  const { data: servicios } = useQuery({
    queryKey: ['servicios', 'selector'],
    queryFn: () => api.get<Servicio[]>('/servicios/selector'),
    enabled: abierto,
  });

  // Búsqueda de clientes con espera: no se consulta en cada tecla.
  const [terminoDiferido, setTerminoDiferido] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setTerminoDiferido(busqueda.trim()), 250);
    return () => clearTimeout(t);
  }, [busqueda]);

  const { data: encontrados, isFetching: buscando } = useQuery({
    queryKey: ['clientes', 'buscar', terminoDiferido],
    queryFn: () => api.get<ClienteEncontrado[]>(`/clientes/buscar?q=${encodeURIComponent(terminoDiferido)}`),
    enabled: abierto && terminoDiferido.length >= 2 && !clienteElegido,
  });

  const { data: disponibilidad, isFetching: cargandoHuecos } = useQuery({
    queryKey: ['disponibilidad', sedeId, barberoId, fecha, servicioIds],
    queryFn: () =>
      api.get<Disponibilidad>(
        `/disponibilidad/dia?sedeId=${sedeId}&barberoId=${barberoId}&fecha=${fecha}` +
          servicioIds.map((id) => `&servicioIds=${id}`).join(''),
      ),
    enabled: abierto && !esWalkIn && Boolean(sedeId && barberoId && servicioIds.length > 0),
  });

  // --- Valores iniciales --------------------------------------------------
  React.useEffect(() => {
    if (!abierto) return;
    // La sede del usuario viene preseleccionada: en el 90% de los casos es la
    // correcta y ahorra un clic en cada reserva.
    if (!sedeId) setSedeId(usuario?.sedeId ?? sedes?.[0]?.id ?? '');
  }, [abierto, sedes, usuario?.sedeId, sedeId]);

  React.useEffect(() => {
    // Un barbero solo se reserva a sí mismo.
    if (usuario?.rol === 'BARBERO' && barberos?.some((b) => b.id === usuario.id)) {
      setBarberoId(usuario.id);
    }
  }, [barberos, usuario]);

  function reiniciar() {
    setBarberoId(usuario?.rol === 'BARBERO' ? usuario.id : '');
    setServicioIds([]);
    setInicioEn(null);
    setNota('');
    setBusqueda('');
    setClienteElegido(null);
    setCreandoCliente(false);
    setNombreNuevo('');
    setTelefonoNuevo('');
    setAplicarPremio(false);
    setCobrarYa(esWalkIn);
    setErrorGeneral(null);
    setCampos({});
    setAlternativas([]);
  }

  const serviciosElegidos = (servicios ?? []).filter((s) => servicioIds.includes(s.id));
  const duracionTotal = serviciosElegidos.reduce((s, x) => s + x.duracionMinutos, 0);
  const precioTotal = serviciosElegidos.reduce((s, x) => s + Number(x.precio), 0);

  const guardar = useMutation({
    mutationFn: () => {
      const comun = {
        sedeId,
        barberoId,
        servicioIds,
        notaCliente: nota || undefined,
        ...(clienteElegido
          ? { clienteId: clienteElegido.id }
          : creandoCliente && nombreNuevo && telefonoNuevo
            ? { clienteNuevo: { nombreCompleto: nombreNuevo, telefono: telefonoNuevo } }
            : {}),
        aplicarPremioFidelidad: aplicarPremio,
      };

      return esWalkIn
        ? api.post('/reservas/walk-in', { ...comun, completarYCobrar: cobrarYa, metodoPago: 'EFECTIVO' })
        : api.post('/reservas', { ...comun, inicioEn, confirmar: true });
    },
    onSuccess: () => {
      reiniciar();
      onCambio(false);
      onGuardado();
    },
    onError: (error) => {
      if (error instanceof ErrorApi) {
        setErrorGeneral(error.mensaje ?? error.message);
        setCampos(error.campos ?? {});
        const detalle = error.detalle as { alternativas?: Hueco[] } | undefined;
        setAlternativas(detalle?.alternativas ?? []);
      } else {
        setErrorGeneral('No se pudo guardar la reserva.');
      }
    },
  });

  const listoParaGuardar =
    Boolean(sedeId && barberoId) &&
    servicioIds.length > 0 &&
    (esWalkIn || Boolean(inicioEn)) &&
    (!creandoCliente || Boolean(nombreNuevo && telefonoNuevo));

  const barberoDisponible = disponibilidad?.barberos.find((b) => b.barberoId === barberoId);

  return (
    <Dialogo
      open={abierto}
      onOpenChange={(valor) => {
        onCambio(valor);
        if (!valor) reiniciar();
      }}
    >
      <DialogoContenido anchoMaximo="max-w-2xl">
        <DialogoCabecera>
          <DialogoTitulo className="flex items-center gap-2">
            {esWalkIn ? <Zap className="text-primary size-5" /> : null}
            {esWalkIn ? 'Cliente sin cita' : 'Nueva reserva'}
          </DialogoTitulo>
          <DialogoDescripcion>
            {esWalkIn
              ? 'Se le asigna el siguiente hueco libre del barbero y un número de turno.'
              : 'Busca al cliente, elige los servicios y luego la hora.'}
          </DialogoDescripcion>
        </DialogoCabecera>

        {errorGeneral ? (
          <div className="bg-destructive/10 text-destructive border-destructive/25 rounded-md border px-3 py-2 text-sm">
            <p>{errorGeneral}</p>
            {alternativas.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-xs opacity-80">¿Te sirve?</span>
                {alternativas.map((h) => (
                  <button
                    key={h.inicioEn}
                    type="button"
                    className="bg-background hover:bg-accent tabular rounded border px-2 py-0.5 text-xs font-medium"
                    onClick={() => {
                      setInicioEn(h.inicioEn);
                      setErrorGeneral(null);
                      setAlternativas([]);
                    }}
                  >
                    {h.hora}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ---------------------------- 1. Cliente ------------------------- */}
        <section className="space-y-3">
          <Paso numero={1} titulo="¿Quién es el cliente?" />

          {clienteElegido ? (
            <div className="bg-accent/40 flex items-start gap-3 rounded-lg border p-3">
              <span className="bg-primary/15 text-primary flex size-9 shrink-0 items-center justify-center rounded-full">
                <UserRound className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{clienteElegido.nombreCompleto}</p>
                <p className="text-muted-foreground text-sm">
                  {clienteElegido.telefonoVisible} · {clienteElegido.totalVisitas}{' '}
                  {clienteElegido.totalVisitas === 1 ? 'visita' : 'visitas'} · última{' '}
                  {tiempoRelativo(clienteElegido.ultimaVisitaEn)}
                </p>

                {/* El aviso del premio: lo que el barbero tiene que ver antes
                    de cobrar, sin tener que entrar a la ficha. */}
                {clienteElegido.tienePremio ? (
                  <label className="border-primary/40 bg-primary/10 mt-2 flex cursor-pointer items-start gap-2 rounded-md border p-2">
                    <input
                      type="checkbox"
                      className="accent-primary mt-0.5"
                      checked={aplicarPremio}
                      onChange={(e) => setAplicarPremio(e.target.checked)}
                    />
                    <span className="text-sm">
                      <span className="text-primary flex items-center gap-1 font-medium">
                        <Gift className="size-3.5" />
                        Tiene {clienteElegido.sellosDisponibles} sellos: este corte puede ir gratis
                      </span>
                      <span className="text-muted-foreground text-xs">
                        Al marcarlo, el servicio más caro se cobra como cortesía y se consumen los
                        sellos.
                      </span>
                    </span>
                  </label>
                ) : (
                  <p className="text-muted-foreground mt-1 text-xs">
                    Tarjeta de cortes: {clienteElegido.sellosDisponibles}/
                    {clienteElegido.sellosRequeridos} · faltan{' '}
                    {clienteElegido.sellosRequeridos - clienteElegido.sellosDisponibles}
                  </p>
                )}

                {clienteElegido.notas ? (
                  <p className="text-muted-foreground mt-1.5 text-xs italic">
                    Preferencias: {clienteElegido.notas}
                  </p>
                ) : null}
              </div>
              <Boton
                variante="fantasma"
                tamano="iconoSm"
                onClick={() => {
                  setClienteElegido(null);
                  setAplicarPremio(false);
                }}
              >
                <X />
              </Boton>
            </div>
          ) : creandoCliente ? (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo etiqueta="Nombre completo" requerido error={campos['clienteNuevo.nombreCompleto']?.[0]}>
                  <Entrada
                    autoFocus
                    value={nombreNuevo}
                    onChange={(e) => setNombreNuevo(e.target.value)}
                    placeholder="Juan Pérez"
                  />
                </Campo>
                <Campo
                  etiqueta="Celular"
                  requerido
                  error={campos['clienteNuevo.telefono']?.[0]}
                  ayuda="Como lo escribas: se guarda normalizado."
                >
                  <Entrada
                    value={telefonoNuevo}
                    onChange={(e) => setTelefonoNuevo(e.target.value)}
                    placeholder="300 123 4567"
                    inputMode="tel"
                  />
                </Campo>
              </div>
              <Boton
                variante="fantasma"
                tamano="sm"
                onClick={() => {
                  setCreandoCliente(false);
                  setNombreNuevo('');
                  setTelefonoNuevo('');
                }}
              >
                <X />
                Cancelar y buscar
              </Boton>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                <Entrada
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Nombre o celular…"
                  className="pl-9"
                  autoFocus
                />
                {buscando ? (
                  <Loader2 className="text-muted-foreground absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin" />
                ) : null}
              </div>

              {terminoDiferido.length >= 2 ? (
                encontrados && encontrados.length > 0 ? (
                  <ul className="max-h-48 overflow-y-auto rounded-lg border">
                    {encontrados.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          className="hover:bg-accent flex w-full items-center gap-3 border-b p-2.5 text-left transition-colors last:border-b-0"
                          onClick={() => {
                            setClienteElegido(c);
                            setBusqueda('');
                          }}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{c.nombreCompleto}</p>
                            <p className="text-muted-foreground text-xs">
                              {c.telefonoVisible} · {c.totalVisitas} visitas
                            </p>
                          </div>
                          {c.tienePremio ? (
                            <Insignia variante="primaria">
                              <Gift className="size-3" />
                              Premio
                            </Insignia>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : !buscando ? (
                  <div className="text-muted-foreground rounded-lg border border-dashed p-3 text-center text-sm">
                    <p>No hay ningún cliente con ese nombre o celular.</p>
                    <Boton
                      variante="enlace"
                      tamano="sm"
                      onClick={() => {
                        setCreandoCliente(true);
                        // Si escribió un número, se aprovecha; si no, el nombre.
                        if (/\d/.test(busqueda)) setTelefonoNuevo(busqueda);
                        else setNombreNuevo(busqueda);
                      }}
                    >
                      <UserPlus />
                      Crear la ficha de “{busqueda}”
                    </Boton>
                  </div>
                ) : null
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Boton variante="contorno" tamano="sm" onClick={() => setCreandoCliente(true)}>
                    <UserPlus />
                    Cliente nuevo
                  </Boton>
                  {esWalkIn ? (
                    <span className="text-muted-foreground text-xs">
                      O déjalo en blanco: se registra como “Consumidor final” y{' '}
                      <strong>no acumula sellos</strong>.
                    </span>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </section>

        <Separador />

        {/* ------------------------- 2. Sede y barbero --------------------- */}
        <section className="space-y-3">
          <Paso numero={2} titulo="Sede y barbero" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Sede" requerido error={campos.sedeId?.[0]}>
              <Selector
                value={sedeId}
                onValueChange={(v) => {
                  setSedeId(v);
                  setBarberoId('');
                  setInicioEn(null);
                }}
              >
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

            <Campo etiqueta="Barbero" requerido error={campos.barberoId?.[0]}>
              <Selector
                value={barberoId}
                onValueChange={(v) => {
                  setBarberoId(v);
                  setInicioEn(null);
                }}
                disabled={!sedeId || usuario?.rol === 'BARBERO'}
              >
                <SelectorDisparador>
                  <SelectorValor placeholder={sedeId ? 'Elige el barbero' : 'Elige la sede primero'} />
                </SelectorDisparador>
                <SelectorContenido>
                  {(barberos ?? []).map((b) => (
                    <SelectorOpcion key={b.id} value={b.id}>
                      {b.alias ?? `${b.nombre} ${b.apellido ?? ''}`.trim()}
                    </SelectorOpcion>
                  ))}
                </SelectorContenido>
              </Selector>
            </Campo>
          </div>
        </section>

        <Separador />

        {/* --------------------------- 3. Servicios ------------------------ */}
        <section className="space-y-3">
          <Paso numero={3} titulo="¿Qué le van a hacer?" />

          <div className="grid gap-2 sm:grid-cols-2">
            {(servicios ?? []).map((servicio) => {
              const elegido = servicioIds.includes(servicio.id);
              return (
                <button
                  key={servicio.id}
                  type="button"
                  onClick={() => {
                    setServicioIds((previos) =>
                      previos.includes(servicio.id)
                        ? previos.filter((id) => id !== servicio.id)
                        : [...previos, servicio.id],
                    );
                    setInicioEn(null);
                  }}
                  className={cn(
                    'flex items-start gap-2.5 rounded-lg border p-3 text-left transition-all',
                    elegido
                      ? 'border-primary bg-primary/10 ring-primary/20 ring-2'
                      : 'hover:border-primary/40 hover:bg-accent/40',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border',
                      elegido ? 'bg-primary border-primary text-primary-foreground' : 'border-input',
                    )}
                  >
                    {elegido ? <Check className="size-3" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium">{servicio.nombre}</span>
                      <span className="tabular shrink-0 text-sm font-semibold">
                        {pesos(servicio.precio)}
                      </span>
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      {servicio.duracionMinutos} min
                      {servicio.incluye.length > 0 ? ` · ${servicio.incluye.join(', ')}` : ''}
                    </span>
                  </span>
                </button>
              );
            })}
            {!servicios ? <Esqueleto className="h-16 sm:col-span-2" /> : null}
          </div>

          {servicioIds.length > 0 ? (
            <div className="bg-accent/40 flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
              <span className="text-muted-foreground">
                {servicioIds.length} {servicioIds.length === 1 ? 'servicio' : 'servicios'} ·{' '}
                <span className="tabular">{duracionTotal} min</span>
              </span>
              <span className="tabular text-base font-semibold">{pesos(precioTotal)}</span>
            </div>
          ) : null}

          {campos.servicioIds?.[0] ? (
            <p className="text-destructive text-xs font-medium">{campos.servicioIds[0]}</p>
          ) : null}
        </section>

        {/* ----------------------------- 4. Hora -------------------------- */}
        {!esWalkIn ? (
          <>
            <Separador />
            <section className="space-y-3">
              <Paso numero={4} titulo="¿Cuándo?" />

              <Campo etiqueta="Fecha">
                <Entrada
                  type="date"
                  value={fecha}
                  min={aFechaISO(new Date())}
                  onChange={(e) => {
                    setFecha(e.target.value);
                    setInicioEn(null);
                  }}
                  className="w-auto"
                />
              </Campo>

              {servicioIds.length === 0 || !barberoId ? (
                <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-center text-sm">
                  Elige el barbero y los servicios para ver las horas libres.
                </p>
              ) : cargandoHuecos ? (
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <Esqueleto key={i} className="h-9" />
                  ))}
                </div>
              ) : !disponibilidad?.laborable ? (
                <p className="bg-aviso/10 text-aviso border-aviso/25 rounded-md border px-3 py-2 text-sm">
                  Ese día no se atiende{disponibilidad?.motivo ? `: ${disponibilidad.motivo}` : ''}.
                </p>
              ) : !barberoDisponible?.trabaja ? (
                <p className="bg-aviso/10 text-aviso border-aviso/25 rounded-md border px-3 py-2 text-sm">
                  {barberoDisponible?.motivoNoTrabaja ?? 'El barbero no atiende ese día'}.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                    {barberoDisponible.huecos.map((hueco) => (
                      <button
                        key={hueco.inicioEn}
                        type="button"
                        disabled={!hueco.disponible}
                        onClick={() => setInicioEn(hueco.inicioEn)}
                        title={hueco.disponible ? undefined : explicar(hueco.motivo)}
                        className={cn(
                          'tabular h-9 rounded-md border text-sm font-medium transition-all',
                          inicioEn === hueco.inicioEn
                            ? 'bg-primary border-primary text-primary-foreground'
                            : hueco.disponible
                              ? 'hover:border-primary hover:bg-primary/10'
                              : 'text-muted-foreground/50 cursor-not-allowed border-dashed line-through',
                        )}
                      >
                        {hueco.hora}
                      </button>
                    ))}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    Slots de {barberoDisponible.slotMinutos} min · se necesitan{' '}
                    {disponibilidad.duracionNecesaria} min seguidos · las horas tachadas están
                    ocupadas, en almuerzo o no dan tiempo antes del cierre.
                  </p>
                </>
              )}
            </section>
          </>
        ) : null}

        <Separador />

        {/* ----------------------------- 5. Nota -------------------------- */}
        <section className="space-y-3">
          <Campo
            etiqueta="Nota del cliente"
            ayuda="Lo que pidió: “degradado bajo”, “no tocar el copete”, “como la última vez”."
          >
            <AreaTexto
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Opcional"
              rows={2}
            />
          </Campo>

          {esWalkIn ? (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-primary"
                checked={cobrarYa}
                onChange={(e) => setCobrarYa(e.target.checked)}
              />
              Cobrar ahora mismo (en efectivo)
            </label>
          ) : null}
        </section>

        <DialogoPie>
          <Boton variante="fantasma" onClick={() => onCambio(false)}>
            Cancelar
          </Boton>
          <Boton
            cargando={guardar.isPending}
            disabled={!listoParaGuardar}
            onClick={() => guardar.mutate()}
          >
            {esWalkIn ? (
              <>
                <Zap />
                {cobrarYa ? 'Registrar y cobrar' : 'Registrar llegada'}
              </>
            ) : (
              <>
                <Clock />
                Guardar reserva
              </>
            )}
          </Boton>
        </DialogoPie>
      </DialogoContenido>
    </Dialogo>
  );
}

function Paso({ numero, titulo }: { numero: number; titulo: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="bg-secondary text-secondary-foreground flex size-5 items-center justify-center rounded-full text-[11px] font-semibold">
        {numero}
      </span>
      <h4 className="text-sm font-semibold">{titulo}</h4>
    </div>
  );
}

/** Traduce el motivo técnico de un hueco ocupado a algo legible. */
function explicar(motivo?: string): string {
  const mapa: Record<string, string> = {
    OCUPADO: 'Ya hay una cita a esa hora',
    ALMUERZO: 'Hora de almuerzo',
    DESCANSO: 'Descanso del barbero',
    PASADO: 'Esa hora ya pasó',
    ANTELACION: 'Demasiado pronto para reservar',
    NO_CABE: 'No da tiempo a terminar antes del cierre',
  };
  return motivo ? (mapa[motivo] ?? 'No disponible') : 'No disponible';
}
