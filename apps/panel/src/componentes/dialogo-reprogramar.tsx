import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarClock } from 'lucide-react';
import { api, ErrorApi } from '@/lib/api';
import { aFechaISO, cn, fechaCorta, hora } from '@/lib/utils';
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
  Selector,
  SelectorContenido,
  SelectorDisparador,
  SelectorOpcion,
  SelectorValor,
} from '@/componentes/ui/varios';
import type { ReservaTabla } from '@/paginas/reservas';

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
  laborable: boolean;
  motivo?: string;
  duracionNecesaria: number;
  barberos: {
    barberoId: string;
    trabaja: boolean;
    motivoNoTrabaja?: string;
    slotMinutos: number;
    huecos: Hueco[];
  }[];
}

/**
 * Mover una cita.
 *
 * Permite cambiar hora, barbero y sede a la vez, porque en la práctica van
 * juntos: el caso real es «me cambio a la sede del norte, ¿te viene bien el
 * jueves con Camilo?».
 *
 * La consulta de huecos excluye esta misma reserva. Sin eso, la cita chocaría
 * consigo misma y su propia hora aparecería ocupada, que es justo la que a
 * veces se quiere conservar al cambiar solo de barbero.
 */
export function DialogoReprogramar({
  reserva,
  abierto,
  onCambio,
  onGuardado,
}: {
  reserva: ReservaTabla;
  abierto: boolean;
  onCambio: (v: boolean) => void;
  onGuardado: () => void;
}) {
  const [sedeId, setSedeId] = React.useState(reserva.sede.id);
  const [barberoId, setBarberoId] = React.useState(reserva.barbero.id);
  const [fecha, setFecha] = React.useState(aFechaISO(new Date(reserva.inicioEn)));
  const [inicioEn, setInicioEn] = React.useState<string | null>(null);
  const [motivo, setMotivo] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

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

  const servicioIds = reserva.servicios.map((s) => s.servicioId);

  const { data: disponibilidad, isFetching } = useQuery({
    queryKey: ['disponibilidad', 'reprogramar', sedeId, barberoId, fecha, reserva.id],
    queryFn: () =>
      api.get<Disponibilidad>(
        `/disponibilidad/dia?sedeId=${sedeId}&barberoId=${barberoId}&fecha=${fecha}` +
          servicioIds.map((id) => `&servicioIds=${id}`).join('') +
          `&excluirReservaId=${reserva.id}`,
      ),
    enabled: abierto && Boolean(sedeId && barberoId),
  });

  const barbero = disponibilidad?.barberos.find((b) => b.barberoId === barberoId);

  const guardar = useMutation({
    mutationFn: () =>
      api.patch(`/reservas/${reserva.id}/reprogramar`, {
        inicioEn,
        sedeId,
        barberoId,
        motivo: motivo || undefined,
        notificar: true,
      }),
    onSuccess: onGuardado,
    onError: (e) =>
      setError(e instanceof ErrorApi ? e.mensaje : 'No se pudo mover la cita.'),
  });

  return (
    <Dialogo open={abierto} onOpenChange={onCambio}>
      <DialogoContenido anchoMaximo="max-w-xl">
        <DialogoCabecera>
          <DialogoTitulo>Mover la cita {reserva.codigo}</DialogoTitulo>
          <DialogoDescripcion>
            {reserva.cliente?.nombreCompleto ?? 'Cliente sin ficha'} ·{' '}
            {reserva.servicios.map((s) => s.nombreSnapshot).join(' + ')}
          </DialogoDescripcion>
        </DialogoCabecera>

        {error ? (
          <p className="bg-destructive/10 text-destructive border-destructive/25 rounded-md border px-3 py-2 text-sm">
            {error}
          </p>
        ) : null}

        {/* De dónde a dónde */}
        <div className="bg-muted/50 flex items-center gap-3 rounded-lg border p-3 text-sm">
          <div>
            <p className="text-muted-foreground text-xs">Ahora</p>
            <p className="font-medium capitalize">
              {fechaCorta(reserva.inicioEn)} <span className="tabular">{hora(reserva.inicioEn)}</span>
            </p>
          </div>
          <ArrowRight className="text-muted-foreground size-4 shrink-0" />
          <div>
            <p className="text-muted-foreground text-xs">Pasa a</p>
            <p className={cn('font-medium capitalize', !inicioEn && 'text-muted-foreground')}>
              {inicioEn ? (
                <>
                  {fechaCorta(inicioEn)} <span className="tabular">{hora(inicioEn)}</span>
                </>
              ) : (
                'elige una hora abajo'
              )}
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Sede">
            <Selector
              value={sedeId}
              onValueChange={(v) => {
                setSedeId(v);
                setInicioEn(null);
              }}
            >
              <SelectorDisparador>
                <SelectorValor />
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

          <Campo etiqueta="Barbero">
            <Selector
              value={barberoId}
              onValueChange={(v) => {
                setBarberoId(v);
                setInicioEn(null);
              }}
            >
              <SelectorDisparador>
                <SelectorValor />
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

        <Campo etiqueta="Fecha">
          <Entrada
            type="date"
            min={aFechaISO(new Date())}
            value={fecha}
            onChange={(e) => {
              setFecha(e.target.value);
              setInicioEn(null);
            }}
            className="w-auto"
          />
        </Campo>

        {isFetching ? (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <Esqueleto key={i} className="h-9" />
            ))}
          </div>
        ) : !disponibilidad?.laborable ? (
          <p className="bg-aviso/10 text-aviso border-aviso/30 rounded-md border px-3 py-2 text-sm">
            Ese día no se atiende{disponibilidad?.motivo ? `: ${disponibilidad.motivo}` : ''}.
          </p>
        ) : !barbero?.trabaja ? (
          <p className="bg-aviso/10 text-aviso border-aviso/30 rounded-md border px-3 py-2 text-sm">
            {barbero?.motivoNoTrabaja ?? 'El barbero no atiende ese día'}.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {barbero.huecos.map((hueco) => (
                <button
                  key={hueco.inicioEn}
                  type="button"
                  disabled={!hueco.disponible}
                  onClick={() => setInicioEn(hueco.inicioEn)}
                  className={cn(
                    'tabular h-9 rounded-md border text-sm font-medium transition-all',
                    inicioEn === hueco.inicioEn
                      ? 'bg-primary border-primary text-primary-foreground'
                      : hueco.disponible
                        ? 'hover:border-primary hover:bg-accent'
                        : 'text-muted-foreground/50 cursor-not-allowed border-dashed line-through',
                  )}
                >
                  {hueco.hora}
                </button>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">
              Se necesitan {disponibilidad.duracionNecesaria} minutos seguidos. La hora actual de
              esta cita aparece libre porque no cuenta contra sí misma.
            </p>
          </>
        )}

        <Campo etiqueta="Motivo del cambio" ayuda="Queda en la auditoría de la cita.">
          <AreaTexto
            rows={2}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Opcional"
          />
        </Campo>

        <DialogoPie>
          <Boton variante="fantasma" onClick={() => onCambio(false)}>
            Cancelar
          </Boton>
          <Boton
            cargando={guardar.isPending}
            disabled={!inicioEn}
            onClick={() => guardar.mutate()}
          >
            <CalendarClock />
            Mover la cita
          </Boton>
        </DialogoPie>
      </DialogoContenido>
    </Dialogo>
  );
}
