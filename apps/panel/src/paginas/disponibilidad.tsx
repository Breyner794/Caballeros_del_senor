import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import type { DiaCalendario } from '@cds/shared';
import { api } from '@/lib/api';
import { aFechaISO, cn, fechaLarga } from '@/lib/utils';
import { useSesion } from '@/hooks/sesion';
import { Encabezado } from '@/componentes/armazon';
import { Boton } from '@/componentes/ui/boton';
import { Tarjeta, TarjetaContenido } from '@/componentes/ui/tarjeta';
import {
  Esqueleto,
  Selector,
  SelectorContenido,
  SelectorDisparador,
  SelectorOpcion,
  SelectorValor,
} from '@/componentes/ui/varios';
import { DialogoNuevaReserva } from '@/componentes/dialogo-nueva-reserva';

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
  barberos: {
    barberoId: string;
    barberoNombre: string;
    alias: string | null;
    trabaja: boolean;
    motivoNoTrabaja?: string;
    slotMinutos: number;
    librestotal: number;
    ocupadosTotal: number;
    huecos: Hueco[];
  }[];
}

const COLOR_ESTADO: Record<DiaCalendario['estado'], string> = {
  libre: 'bg-exito/15 text-exito border-exito/30 hover:bg-exito/25',
  parcial: 'bg-aviso/15 text-aviso border-aviso/30 hover:bg-aviso/25',
  lleno: 'bg-destructive/15 text-destructive border-destructive/30 hover:bg-destructive/25',
  cerrado: 'bg-muted/50 text-muted-foreground/60 border-border',
};

const ETIQUETA_ESTADO: Record<DiaCalendario['estado'], string> = {
  libre: 'Con hueco',
  parcial: 'Casi lleno',
  lleno: 'Completo',
  cerrado: 'Cerrado',
};

/**
 * Disponibilidad.
 *
 * Dos vistas que se complementan: el mes de un vistazo, con cada día pintado
 * según cuánto queda libre (lo que pidió el cliente para ver diciembre de un
 * golpe), y el detalle del día elegido con las horas reales.
 *
 * Pulsar una hora libre abre el formulario de reserva con la sede, el barbero
 * y la hora ya puestos: del calendario a la cita registrada en dos clics, que
 * es como se usa cuando hay alguien esperando al teléfono.
 */
export function PaginaDisponibilidad() {
  const { usuario, puede } = useSesion();
  const cliente = useQueryClient();

  const [sedeId, setSedeId] = React.useState(usuario?.sedeId ?? '');
  const [barberoId, setBarberoId] = React.useState(usuario?.rol === 'BARBERO' ? usuario.id : '');
  const [mes, setMes] = React.useState(() => {
    const hoy = new Date();
    return new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  });
  const [diaElegido, setDiaElegido] = React.useState(aFechaISO(new Date()));
  const [reservaAbierta, setReservaAbierta] = React.useState(false);

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

  const desde = aFechaISO(new Date(mes.getFullYear(), mes.getMonth(), 1));
  const hasta = aFechaISO(new Date(mes.getFullYear(), mes.getMonth() + 1, 0));

  const { data: calendario, isLoading: cargandoMes } = useQuery({
    queryKey: ['calendario', sedeId, barberoId, desde, hasta],
    queryFn: () =>
      api.get<DiaCalendario[]>(
        `/disponibilidad/calendario?desde=${desde}&hasta=${hasta}` +
          (sedeId ? `&sedeId=${sedeId}` : '') +
          (barberoId ? `&barberoId=${barberoId}` : ''),
      ),
    enabled: Boolean(sedeId),
  });

  const { data: delDia, isLoading: cargandoDia } = useQuery({
    queryKey: ['disponibilidad', 'dia', sedeId, barberoId, diaElegido],
    queryFn: () =>
      api.get<Disponibilidad>(
        `/disponibilidad/dia?sedeId=${sedeId}&fecha=${diaElegido}` +
          (barberoId ? `&barberoId=${barberoId}` : ''),
      ),
    enabled: Boolean(sedeId),
  });

  // Rejilla del mes: se rellenan los huecos iniciales para que el día 1 caiga
  // en su columna real de la semana.
  const primerDiaSemana = new Date(mes.getFullYear(), mes.getMonth(), 1).getDay();
  const relleno = Array.from({ length: primerDiaSemana });

  return (
    <>
      <Encabezado
        titulo="Disponibilidad"
        descripcion="Qué días y horas quedan libres, de un vistazo."
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

        {puede('disponibilidad:ver_todas') ? (
          <Selector value={barberoId || 'todos'} onValueChange={(v) => setBarberoId(v === 'todos' ? '' : v)}>
            <SelectorDisparador className="w-44">
              <SelectorValor placeholder="Barbero" />
            </SelectorDisparador>
            <SelectorContenido>
              <SelectorOpcion value="todos">Todos los barberos</SelectorOpcion>
              {(barberos ?? []).map((b) => (
                <SelectorOpcion key={b.id} value={b.id}>
                  {b.alias ?? `${b.nombre} ${b.apellido ?? ''}`.trim()}
                </SelectorOpcion>
              ))}
            </SelectorContenido>
          </Selector>
        ) : null}
      </Encabezado>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* ------------------------- Calendario del mes ------------------- */}
        <Tarjeta>
          <TarjetaContenido className="p-4 pt-4">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-semibold capitalize">
                {new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' }).format(mes)}
              </h3>
              <div className="flex items-center gap-1">
                <Boton
                  variante="fantasma"
                  tamano="iconoSm"
                  onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))}
                >
                  <ChevronLeft />
                </Boton>
                <Boton
                  variante="fantasma"
                  tamano="sm"
                  onClick={() => {
                    const hoy = new Date();
                    setMes(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
                    setDiaElegido(aFechaISO(hoy));
                  }}
                >
                  Hoy
                </Boton>
                <Boton
                  variante="fantasma"
                  tamano="iconoSm"
                  onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))}
                >
                  <ChevronRight />
                </Boton>
              </div>
            </div>

            <div className="mb-2 grid grid-cols-7 gap-1.5">
              {['D', 'L', 'M', 'M', 'J', 'V', 'S'].map((d, i) => (
                <div key={i} className="text-muted-foreground py-1 text-center text-xs font-medium">
                  {d}
                </div>
              ))}
            </div>

            {cargandoMes ? (
              <div className="grid grid-cols-7 gap-1.5">
                {Array.from({ length: 35 }).map((_, i) => (
                  <Esqueleto key={i} className="aspect-square" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-7 gap-1.5">
                {relleno.map((_, i) => (
                  <div key={`relleno-${i}`} />
                ))}
                {(calendario ?? []).map((dia) => {
                  const numero = Number(dia.fecha.slice(8, 10));
                  const esHoy = dia.fecha === aFechaISO(new Date());
                  return (
                    <button
                      key={dia.fecha}
                      type="button"
                      onClick={() => setDiaElegido(dia.fecha)}
                      title={
                        dia.etiqueta
                          ? `${dia.etiqueta} · ${ETIQUETA_ESTADO[dia.estado]}`
                          : `${ETIQUETA_ESTADO[dia.estado]} · ${dia.huecosLibres} de ${dia.totalHuecos} libres`
                      }
                      className={cn(
                        'relative flex aspect-square flex-col items-center justify-center rounded-lg border text-sm transition-colors',
                        COLOR_ESTADO[dia.estado],
                        diaElegido === dia.fecha && 'ring-primary ring-2 ring-offset-1 ring-offset-card',
                      )}
                    >
                      <span className={cn('tabular font-medium', esHoy && 'underline')}>
                        {numero}
                      </span>
                      {dia.estado !== 'cerrado' ? (
                        <span className="tabular text-[10px] leading-none opacity-80">
                          {dia.huecosLibres}
                        </span>
                      ) : null}
                      {dia.etiqueta ? (
                        <span className="bg-primary absolute top-1 right-1 size-1.5 rounded-full" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
              {(['libre', 'parcial', 'lleno', 'cerrado'] as const).map((estado) => (
                <span key={estado} className="flex items-center gap-1.5">
                  <span className={cn('size-3 rounded border', COLOR_ESTADO[estado])} />
                  <span className="text-muted-foreground">{ETIQUETA_ESTADO[estado]}</span>
                </span>
              ))}
              <span className="flex items-center gap-1.5">
                <span className="bg-primary size-1.5 rounded-full" />
                <span className="text-muted-foreground">Festivo o fecha especial</span>
              </span>
            </div>
          </TarjetaContenido>
        </Tarjeta>

        {/* --------------------------- Detalle del día --------------------- */}
        <Tarjeta className="h-fit">
          <TarjetaContenido className="p-4 pt-4">
            <h3 className="font-semibold capitalize">{fechaLarga(`${diaElegido}T12:00:00`)}</h3>

            {cargandoDia ? (
              <div className="mt-4 space-y-3">
                <Esqueleto className="h-5 w-32" />
                <Esqueleto className="h-24 w-full" />
              </div>
            ) : !delDia?.laborable ? (
              <p className="bg-muted text-muted-foreground mt-4 rounded-md px-3 py-6 text-center text-sm">
                {delDia?.motivo ?? 'No se atiende este día'}
              </p>
            ) : (
              <div className="mt-4 space-y-5">
                {delDia.barberos.map((barbero) => (
                  <div key={barbero.barberoId}>
                    <div className="mb-2 flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-medium">
                        {barbero.alias ?? barbero.barberoNombre}
                      </p>
                      {barbero.trabaja ? (
                        <p className="text-muted-foreground tabular shrink-0 text-xs">
                          {barbero.librestotal} libres
                        </p>
                      ) : null}
                    </div>

                    {!barbero.trabaja ? (
                      <p className="text-muted-foreground bg-muted/50 rounded-md px-2 py-2 text-xs">
                        {barbero.motivoNoTrabaja ?? 'No atiende'}
                      </p>
                    ) : (
                      <div className="grid grid-cols-4 gap-1.5">
                        {barbero.huecos.map((hueco) => (
                          <button
                            key={hueco.inicioEn}
                            type="button"
                            disabled={!hueco.disponible || !puede('reservas:crear')}
                            onClick={() => {
                              setBarberoId(barbero.barberoId);
                              setReservaAbierta(true);
                            }}
                            className={cn(
                              'tabular rounded border py-1 text-xs font-medium transition-colors',
                              hueco.disponible
                                ? 'hover:border-primary hover:bg-primary/10'
                                : 'text-muted-foreground/40 cursor-not-allowed border-dashed line-through',
                            )}
                          >
                            {hueco.hora}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {delDia.barberos.length === 0 ? (
                  <p className="text-muted-foreground py-6 text-center text-sm">
                    Ningún barbero tiene cronograma configurado en esta sede.
                  </p>
                ) : null}

                {puede('reservas:crear') ? (
                  <p className="text-muted-foreground flex items-start gap-1.5 border-t pt-3 text-xs">
                    <Clock className="mt-0.5 size-3.5 shrink-0" />
                    Pulsa una hora libre para registrar una cita a esa hora.
                  </p>
                ) : null}
              </div>
            )}
          </TarjetaContenido>
        </Tarjeta>
      </div>

      <DialogoNuevaReserva
        abierto={reservaAbierta}
        onCambio={setReservaAbierta}
        onGuardado={() => {
          void cliente.invalidateQueries({ queryKey: ['calendario'] });
          void cliente.invalidateQueries({ queryKey: ['disponibilidad'] });
        }}
      />

      {!sedeId ? (
        <Tarjeta className="mt-4">
          <TarjetaContenido className="p-10 pt-10 text-center">
            <CalendarCheck className="text-muted-foreground mx-auto size-8" />
            <p className="mt-2 text-sm">Elige una sede para ver su disponibilidad.</p>
          </TarjetaContenido>
        </Tarjeta>
      ) : null}
    </>
  );
}
