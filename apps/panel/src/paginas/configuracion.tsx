import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Gift, Info, Plus, Save, Settings, Trash2, TriangleAlert } from 'lucide-react';
import { horaAMinutos, minutosAHora } from '@cds/shared';
import { api, ErrorApi } from '@/lib/api';
import { aFechaISO, cn, fechaLarga } from '@/lib/utils';
import { Encabezado } from '@/componentes/armazon';
import { Boton } from '@/componentes/ui/boton';
import { AreaTexto, Campo, Entrada } from '@/componentes/ui/campo';
import { Tarjeta, TarjetaCabecera, TarjetaContenido, TarjetaDescripcion, TarjetaTitulo } from '@/componentes/ui/tarjeta';
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

interface Configuracion {
  nombreNegocio: string;
  zonaHoraria: string;
  moneda: string;
  telefonoContacto: string | null;
  emailContacto: string | null;
  slotMinutosDefault: number;
  bufferMinutosDefault: number;
  minAntelacionMinutos: number;
  maxDiasAnticipacion: number;
  horasLimiteCancelacion: number;
  horasLimiteReprogramacion: number;
  permiteElegirBarbero: boolean;
  requiereConfirmacion: boolean;
  maxReservasActivasCliente: number;
  recordatorioWhatsappHoras: number;
}

interface ImpactoSlot {
  barberosAfectados: { id: string; nombre: string; alias: string | null }[];
  barberosConSlotPropio: { id: string; nombre: string; alias: string | null; slotMinutos: number }[];
}

interface ProgramaFidelidad {
  activo: boolean;
  nombre: string;
  sellosRequeridos: number;
  diasValidezSello: number | null;
  canjeGeneraSello: boolean;
  acumulaPorSede: boolean;
  mensajePremio: string;
}

interface DiaEspecial {
  id: string;
  fecha: string;
  nombre: string;
  tipo: 'FESTIVO_CERRADO' | 'FESTIVO_ABIERTO' | 'HORARIO_ESPECIAL';
  horaInicio: number | null;
  horaFin: number | null;
  visibleWeb: boolean;
  sede: { id: string; nombre: string } | null;
}

type Seccion = 'reservas' | 'fidelidad' | 'calendario';

/**
 * Configuración general.
 *
 * Son los valores que gobiernan cómo se comporta todo lo demás: cuánto dura un
 * turno, cuánto tiempo de limpieza se deja entre clientes, con cuánta
 * antelación puede reservar un cliente desde la web y hasta cuándo puede
 * cancelar solo.
 */
export function PaginaConfiguracion() {
  const [seccion, setSeccion] = React.useState<Seccion>('reservas');

  return (
    <>
      <Encabezado
        titulo="Configuración"
        descripcion="Las reglas generales del negocio. Afectan a toda la aplicación."
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {(
          [
            ['reservas', 'Reservas y turnos', Settings],
            ['fidelidad', 'Tarjeta de cortes', Gift],
            ['calendario', 'Festivos y fechas especiales', CalendarDays],
          ] as const
        ).map(([valor, texto, Icono]) => (
          <Boton
            key={valor}
            variante={seccion === valor ? 'primario' : 'contorno'}
            tamano="sm"
            onClick={() => setSeccion(valor)}
          >
            <Icono />
            {texto}
          </Boton>
        ))}
      </div>

      {seccion === 'reservas' ? <SeccionReservas /> : null}
      {seccion === 'fidelidad' ? <SeccionFidelidad /> : null}
      {seccion === 'calendario' ? <SeccionCalendario /> : null}
    </>
  );
}

// ========================== RESERVAS Y TURNOS ===============================

function SeccionReservas() {
  const cliente = useQueryClient();
  const [borrador, setBorrador] = React.useState<Configuracion | null>(null);
  const [guardado, setGuardado] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['configuracion'],
    queryFn: () => api.get<Configuracion>('/configuracion'),
  });

  const { data: impacto } = useQuery({
    queryKey: ['configuracion', 'impacto-slot'],
    queryFn: () => api.get<ImpactoSlot>('/configuracion/impacto-slot'),
  });

  React.useEffect(() => {
    if (data) setBorrador(data);
  }, [data]);

  const guardar = useMutation({
    mutationFn: () => api.patch<Configuracion>('/configuracion', borrador),
    onSuccess: () => {
      setGuardado(true);
      setError(null);
      setTimeout(() => setGuardado(false), 2500);
      void cliente.invalidateQueries({ queryKey: ['configuracion'] });
      // Los huecos dependen de estos valores: hay que recalcularlos.
      void cliente.invalidateQueries({ queryKey: ['disponibilidad'] });
      void cliente.invalidateQueries({ queryKey: ['calendario'] });
    },
    onError: (e) => setError(e instanceof ErrorApi ? e.mensaje : 'No se pudo guardar.'),
  });

  if (isLoading || !borrador) {
    return <Esqueleto className="h-96 w-full" />;
  }

  const cambiar = (cambio: Partial<Configuracion>) =>
    setBorrador((previo) => (previo ? { ...previo, ...cambio } : previo));

  const slotCambio = data && borrador.slotMinutosDefault !== data.slotMinutosDefault;

  return (
    <div className="space-y-4">
      {error ? (
        <p className="bg-destructive/10 text-destructive border-destructive/25 rounded-md border px-3 py-2 text-sm">
          {error}
        </p>
      ) : null}

      <Tarjeta>
        <TarjetaCabecera>
          <TarjetaTitulo>Turnos y tiempos</TarjetaTitulo>
          <TarjetaDescripcion>
            Cómo se divide el día y cuánto margen queda entre un cliente y el siguiente.
          </TarjetaDescripcion>
        </TarjetaCabecera>
        <TarjetaContenido className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              etiqueta="Duración del turno"
              ayuda="Cada cuántos minutos empieza un hueco. Por defecto 30."
            >
              <div className="flex items-center gap-2">
                <Entrada
                  type="number"
                  min={5}
                  max={240}
                  step={5}
                  className="w-24"
                  value={borrador.slotMinutosDefault}
                  onChange={(e) => cambiar({ slotMinutosDefault: Number(e.target.value) })}
                />
                <span className="text-muted-foreground text-sm">minutos</span>
              </div>
            </Campo>

            <Campo
              etiqueta="Tiempo de limpieza entre clientes"
              ayuda="Para desinfectar máquinas y silla. El cliente no lo ve: solo desplaza los huecos."
            >
              <div className="flex items-center gap-2">
                <Entrada
                  type="number"
                  min={0}
                  max={120}
                  step={5}
                  className="w-24"
                  value={borrador.bufferMinutosDefault}
                  onChange={(e) => cambiar({ bufferMinutosDefault: Number(e.target.value) })}
                />
                <span className="text-muted-foreground text-sm">minutos</span>
              </div>
            </Campo>
          </div>

          {/* La parte que el cliente pidió explícitamente: quién se ve afectado */}
          {impacto ? (
            <div
              className={cn(
                'rounded-lg border p-3 text-sm',
                slotCambio ? 'border-aviso/30 bg-aviso/10' : 'bg-muted/50',
              )}
            >
              <p className="flex items-center gap-1.5 font-medium">
                <Info className="size-4 shrink-0" />
                A quién afecta cambiar la duración del turno
              </p>
              <p className="text-muted-foreground mt-1.5">
                {impacto.barberosAfectados.length > 0 ? (
                  <>
                    Se aplicará a{' '}
                    <strong className="text-foreground">
                      {impacto.barberosAfectados.map((b) => b.alias ?? b.nombre).join(', ')}
                    </strong>
                    , que usan el valor general.
                  </>
                ) : (
                  'Ningún barbero usa el valor general ahora mismo.'
                )}
              </p>
              {impacto.barberosConSlotPropio.length > 0 ? (
                <p className="text-muted-foreground mt-1">
                  No afecta a{' '}
                  {impacto.barberosConSlotPropio
                    .map((b) => `${b.alias ?? b.nombre} (${b.slotMinutos} min)`)
                    .join(', ')}
                  : tienen el suyo configurado y se respeta.
                </p>
              ) : null}
            </div>
          ) : null}
        </TarjetaContenido>
      </Tarjeta>

      <Tarjeta>
        <TarjetaCabecera>
          <TarjetaTitulo>Reservas desde la web</TarjetaTitulo>
          <TarjetaDescripcion>
            Estas reglas solo se aplican al cliente que reserva por su cuenta. La recepción puede
            saltárselas, porque a veces el cliente ya está en el local.
          </TarjetaDescripcion>
        </TarjetaCabecera>
        <TarjetaContenido className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Antelación mínima" ayuda="No se puede reservar con menos tiempo.">
              <div className="flex items-center gap-2">
                <Entrada
                  type="number"
                  min={0}
                  max={10080}
                  className="w-24"
                  value={borrador.minAntelacionMinutos}
                  onChange={(e) => cambiar({ minAntelacionMinutos: Number(e.target.value) })}
                />
                <span className="text-muted-foreground text-sm">minutos</span>
              </div>
            </Campo>

            <Campo etiqueta="Se puede reservar hasta" ayuda="Cuántos días hacia adelante.">
              <div className="flex items-center gap-2">
                <Entrada
                  type="number"
                  min={1}
                  max={365}
                  className="w-24"
                  value={borrador.maxDiasAnticipacion}
                  onChange={(e) => cambiar({ maxDiasAnticipacion: Number(e.target.value) })}
                />
                <span className="text-muted-foreground text-sm">días</span>
              </div>
            </Campo>

            <Campo etiqueta="Plazo para cancelar" ayuda="Pasado ese margen tiene que llamar.">
              <div className="flex items-center gap-2">
                <Entrada
                  type="number"
                  min={0}
                  max={168}
                  className="w-24"
                  value={borrador.horasLimiteCancelacion}
                  onChange={(e) => cambiar({ horasLimiteCancelacion: Number(e.target.value) })}
                />
                <span className="text-muted-foreground text-sm">horas antes</span>
              </div>
            </Campo>

            <Campo etiqueta="Plazo para reprogramar">
              <div className="flex items-center gap-2">
                <Entrada
                  type="number"
                  min={0}
                  max={168}
                  className="w-24"
                  value={borrador.horasLimiteReprogramacion}
                  onChange={(e) => cambiar({ horasLimiteReprogramacion: Number(e.target.value) })}
                />
                <span className="text-muted-foreground text-sm">horas antes</span>
              </div>
            </Campo>

            <Campo
              etiqueta="Máximo de citas activas por cliente"
              ayuda="Evita que una persona acapare la agenda."
            >
              <Entrada
                type="number"
                min={1}
                max={20}
                className="w-24"
                value={borrador.maxReservasActivasCliente}
                onChange={(e) => cambiar({ maxReservasActivasCliente: Number(e.target.value) })}
              />
            </Campo>

            <Campo etiqueta="Recordatorio por WhatsApp" ayuda="0 para no enviar ninguno.">
              <div className="flex items-center gap-2">
                <Entrada
                  type="number"
                  min={0}
                  max={168}
                  className="w-24"
                  value={borrador.recordatorioWhatsappHoras}
                  onChange={(e) => cambiar({ recordatorioWhatsappHoras: Number(e.target.value) })}
                />
                <span className="text-muted-foreground text-sm">horas antes</span>
              </div>
            </Campo>
          </div>

          <div className="space-y-2">
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-foreground mt-0.5"
                checked={borrador.permiteElegirBarbero}
                onChange={(e) => cambiar({ permiteElegirBarbero: e.target.checked })}
              />
              <span>
                El cliente puede elegir barbero
                <span className="text-muted-foreground block text-xs">
                  Si se desactiva, el sistema le asigna el que tenga hueco.
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-foreground mt-0.5"
                checked={borrador.requiereConfirmacion}
                onChange={(e) => cambiar({ requiereConfirmacion: e.target.checked })}
              />
              <span>
                Las reservas de la web requieren confirmación
                <span className="text-muted-foreground block text-xs">
                  Entran como pendientes y alguien del panel las confirma. El hueco se reserva
                  igual mientras tanto.
                </span>
              </span>
            </label>
          </div>
        </TarjetaContenido>
      </Tarjeta>

      <div className="flex items-center justify-end gap-3">
        {guardado ? <span className="text-exito text-sm">Guardado</span> : null}
        <Boton cargando={guardar.isPending} onClick={() => guardar.mutate()}>
          <Save />
          Guardar configuración
        </Boton>
      </div>
    </div>
  );
}

// ============================== FIDELIDAD ===================================

function SeccionFidelidad() {
  const cliente = useQueryClient();
  const [borrador, setBorrador] = React.useState<ProgramaFidelidad | null>(null);
  const [guardado, setGuardado] = React.useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['fidelidad', 'programa'],
    queryFn: () => api.get<ProgramaFidelidad>('/fidelidad/programa'),
  });

  React.useEffect(() => {
    if (data) setBorrador(data);
  }, [data]);

  const guardar = useMutation({
    mutationFn: () => api.patch('/fidelidad/programa', borrador),
    onSuccess: () => {
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2500);
      void cliente.invalidateQueries({ queryKey: ['fidelidad'] });
      void cliente.invalidateQueries({ queryKey: ['clientes'] });
    },
  });

  if (isLoading || !borrador) return <Esqueleto className="h-80 w-full" />;

  const cambiar = (cambio: Partial<ProgramaFidelidad>) =>
    setBorrador((previo) => (previo ? { ...previo, ...cambio } : previo));

  return (
    <div className="space-y-4">
      <Tarjeta>
        <TarjetaCabecera>
          <TarjetaTitulo>Tarjeta de cortes</TarjetaTitulo>
          <TarjetaDescripcion>
            El programa de sellos. Cada cita atendida suma uno; al completarla, el siguiente corte
            va por la casa.
          </TarjetaDescripcion>
        </TarjetaCabecera>
        <TarjetaContenido className="space-y-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-foreground"
              checked={borrador.activo}
              onChange={(e) => cambiar({ activo: e.target.checked })}
            />
            Programa activo
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              etiqueta="Sellos para el premio"
              ayuda={`Con ${borrador.sellosRequeridos}, el corte número ${borrador.sellosRequeridos + 1} es gratis.`}
            >
              <Entrada
                type="number"
                min={1}
                max={100}
                className="w-24"
                value={borrador.sellosRequeridos}
                onChange={(e) => cambiar({ sellosRequeridos: Number(e.target.value) })}
              />
            </Campo>

            <Campo
              etiqueta="Caducidad de cada sello"
              ayuda="Vacío = no caducan nunca."
            >
              <div className="flex items-center gap-2">
                <Entrada
                  type="number"
                  min={1}
                  max={3650}
                  className="w-24"
                  value={borrador.diasValidezSello ?? ''}
                  onChange={(e) =>
                    cambiar({ diasValidezSello: e.target.value ? Number(e.target.value) : null })
                  }
                  placeholder="∞"
                />
                <span className="text-muted-foreground text-sm">días</span>
              </div>
            </Campo>
          </div>

          <Campo
            etiqueta="Mensaje al completar la tarjeta"
            ayuda="Es lo que ve el barbero al ir a cobrar."
          >
            <Entrada
              value={borrador.mensajePremio}
              onChange={(e) => cambiar({ mensajePremio: e.target.value })}
            />
          </Campo>

          <div className="space-y-2">
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-foreground mt-0.5"
                checked={borrador.acumulaPorSede}
                onChange={(e) => cambiar({ acumulaPorSede: e.target.checked })}
              />
              <span>
                Los sellos cuentan solo en la sede donde se ganaron
                <span className="text-muted-foreground block text-xs">
                  Normalmente desactivado: el cliente es de la barbería, no de un local.
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-foreground mt-0.5"
                checked={borrador.canjeGeneraSello}
                onChange={(e) => cambiar({ canjeGeneraSello: e.target.checked })}
              />
              <span>
                El corte gratis también suma un sello
                <span className="text-muted-foreground block text-xs">
                  Normalmente desactivado: si no, la tarjeta nunca empieza de cero.
                </span>
              </span>
            </label>
          </div>

          <div className="bg-muted/50 rounded-lg border p-3">
            <p className="mb-2 text-sm font-medium">Así se ve la tarjeta de un cliente</p>
            <div className="flex items-center gap-1.5">
              <div className="flex flex-wrap gap-0.5">
                {Array.from({ length: Math.min(borrador.sellosRequeridos, 30) }).map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      'size-2.5 rounded-full',
                      i < Math.min(5, borrador.sellosRequeridos)
                        ? 'bg-foreground'
                        : 'bg-muted border-border border',
                    )}
                  />
                ))}
              </div>
              <span className="text-muted-foreground tabular text-xs">
                {Math.min(5, borrador.sellosRequeridos)}/{borrador.sellosRequeridos}
              </span>
            </div>
          </div>
        </TarjetaContenido>
      </Tarjeta>

      <div className="flex items-center justify-end gap-3">
        {guardado ? <span className="text-exito text-sm">Guardado</span> : null}
        <Boton cargando={guardar.isPending} onClick={() => guardar.mutate()}>
          <Save />
          Guardar programa
        </Boton>
      </div>
    </div>
  );
}

// ========================== FESTIVOS Y FECHAS ===============================

function SeccionCalendario() {
  const cliente = useQueryClient();
  const [abierto, setAbierto] = React.useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['dias-especiales'],
    queryFn: () => api.get<DiaEspecial[]>('/configuracion/dias-especiales'),
  });

  const eliminar = useMutation({
    mutationFn: (id: string) => api.delete(`/configuracion/dias-especiales/${id}`),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['dias-especiales'] });
      void cliente.invalidateQueries({ queryKey: ['calendario'] });
      void cliente.invalidateQueries({ queryKey: ['disponibilidad'] });
    },
  });

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Boton onClick={() => setAbierto(true)}>
          <Plus />
          Añadir fecha
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
            {data.map((dia) => (
              <li key={dia.id} className="flex items-center gap-3 p-4">
                <span
                  className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-full',
                    dia.tipo === 'FESTIVO_CERRADO'
                      ? 'bg-destructive/10 text-destructive'
                      : 'bg-exito/10 text-exito',
                  )}
                >
                  <CalendarDays className="size-4" />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium">{dia.nombre}</p>
                    <Insignia variante={dia.tipo === 'FESTIVO_CERRADO' ? 'peligro' : 'exito'}>
                      {dia.tipo === 'FESTIVO_CERRADO' ? 'Cerrado' : 'Abierto'}
                    </Insignia>
                    {!dia.visibleWeb ? (
                      <Insignia variante="contorno">Oculto en la web</Insignia>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground text-sm capitalize">
                    {fechaLarga(`${dia.fecha.slice(0, 10)}T12:00:00`)}
                    {dia.horaInicio !== null && dia.horaFin !== null
                      ? ` · ${minutosAHora(dia.horaInicio)}–${minutosAHora(dia.horaFin)}`
                      : ''}
                    {dia.sede ? ` · solo ${dia.sede.nombre}` : ' · todas las sedes'}
                  </p>
                </div>

                <Boton
                  variante="fantasma"
                  tamano="iconoSm"
                  onClick={() => eliminar.mutate(dia.id)}
                  disabled={eliminar.isPending}
                >
                  <Trash2 />
                </Boton>
              </li>
            ))}
          </ul>
        ) : (
          <TarjetaContenido className="p-10 pt-10 text-center">
            <CalendarDays className="text-muted-foreground mx-auto size-8" />
            <p className="mt-3 font-medium">Sin fechas especiales próximas</p>
            <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
              Aquí van los festivos y los días con horario distinto. Lo que marques como visible
              aparece también en el calendario que ve el cliente.
            </p>
          </TarjetaContenido>
        )}
      </Tarjeta>

      <DialogoDiaEspecial
        abierto={abierto}
        onCambio={setAbierto}
        onGuardado={() => {
          setAbierto(false);
          void cliente.invalidateQueries({ queryKey: ['dias-especiales'] });
          void cliente.invalidateQueries({ queryKey: ['calendario'] });
        }}
      />
    </>
  );
}

function DialogoDiaEspecial({
  abierto,
  onCambio,
  onGuardado,
}: {
  abierto: boolean;
  onCambio: (v: boolean) => void;
  onGuardado: () => void;
}) {
  const [fecha, setFecha] = React.useState(aFechaISO(new Date()));
  const [nombre, setNombre] = React.useState('');
  const [tipo, setTipo] = React.useState<DiaEspecial['tipo']>('FESTIVO_ABIERTO');
  const [horaInicio, setHoraInicio] = React.useState('09:00');
  const [horaFin, setHoraFin] = React.useState('18:00');
  const [visibleWeb, setVisibleWeb] = React.useState(true);
  const [notas, setNotas] = React.useState('');
  const [conflicto, setConflicto] = React.useState<{ mensaje: string; total: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const guardar = useMutation({
    mutationFn: (forzar: boolean) =>
      api.post('/configuracion/dias-especiales', {
        fecha,
        nombre,
        tipo,
        ...(tipo !== 'FESTIVO_CERRADO'
          ? { horaInicio: horaAMinutos(horaInicio), horaFin: horaAMinutos(horaFin) }
          : {}),
        visibleWeb,
        notas: notas || undefined,
        forzar,
      }),
    onSuccess: () => {
      setConflicto(null);
      setNombre('');
      onGuardado();
    },
    onError: (e) => {
      if (e instanceof ErrorApi && e.codigo === 'DIA_CON_RESERVAS') {
        const detalle = e.detalle as { total?: number } | undefined;
        setConflicto({ mensaje: e.mensaje, total: detalle?.total ?? 0 });
      } else {
        setError(e instanceof ErrorApi ? e.mensaje : 'No se pudo guardar.');
      }
    },
  });

  return (
    <Dialogo open={abierto} onOpenChange={onCambio}>
      <DialogoContenido>
        <DialogoCabecera>
          <DialogoTitulo>Festivo o fecha especial</DialogoTitulo>
          <DialogoDescripcion>
            Aplica a toda la barbería ese día, por encima del horario habitual.
          </DialogoDescripcion>
        </DialogoCabecera>

        {error ? (
          <p className="bg-destructive/10 text-destructive border-destructive/25 rounded-md border px-3 py-2 text-sm">
            {error}
          </p>
        ) : null}

        {conflicto ? (
          <div className="bg-aviso/10 border-aviso/30 rounded-md border p-3">
            <p className="text-aviso flex items-center gap-1.5 text-sm font-medium">
              <TriangleAlert className="size-4" />
              {conflicto.mensaje}
            </p>
            <div className="mt-2 flex gap-2">
              <Boton variante="fantasma" tamano="sm" onClick={() => setConflicto(null)}>
                Mejor reviso las citas
              </Boton>
              <Boton
                variante="destructivo"
                tamano="sm"
                cargando={guardar.isPending}
                onClick={() => guardar.mutate(true)}
              >
                Cerrar de todos modos
              </Boton>
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Fecha" requerido>
            <Entrada type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </Campo>
          <Campo etiqueta="Nombre" requerido>
            <Entrada
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Navidad, Día de la Madre…"
            />
          </Campo>
        </div>

        <Campo etiqueta="¿Se trabaja ese día?">
          <Selector value={tipo} onValueChange={(v) => setTipo(v as DiaEspecial['tipo'])}>
            <SelectorDisparador>
              <SelectorValor />
            </SelectorDisparador>
            <SelectorContenido>
              <SelectorOpcion value="FESTIVO_ABIERTO">Sí, con horario especial</SelectorOpcion>
              <SelectorOpcion value="HORARIO_ESPECIAL">Sí, horario distinto</SelectorOpcion>
              <SelectorOpcion value="FESTIVO_CERRADO">No, cerrado</SelectorOpcion>
            </SelectorContenido>
          </Selector>
        </Campo>

        {tipo !== 'FESTIVO_CERRADO' ? (
          <div className="flex items-end gap-2">
            <Campo etiqueta="Abre" className="flex-1">
              <Entrada type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} />
            </Campo>
            <Campo etiqueta="Cierra" className="flex-1">
              <Entrada type="time" value={horaFin} onChange={(e) => setHoraFin(e.target.value)} />
            </Campo>
          </div>
        ) : null}

        <Campo etiqueta="Notas">
          <AreaTexto rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} />
        </Campo>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-foreground"
            checked={visibleWeb}
            onChange={(e) => setVisibleWeb(e.target.checked)}
          />
          Mostrarlo en el calendario que ve el cliente
        </label>

        <DialogoPie>
          <Boton variante="fantasma" onClick={() => onCambio(false)}>
            Cancelar
          </Boton>
          <Boton
            cargando={guardar.isPending}
            disabled={!nombre}
            onClick={() => guardar.mutate(false)}
          >
            Guardar
          </Boton>
        </DialogoPie>
      </DialogoContenido>
    </Dialogo>
  );
}
