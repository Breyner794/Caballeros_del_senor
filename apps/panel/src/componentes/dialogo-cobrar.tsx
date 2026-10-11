import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CircleDollarSign, Gift } from 'lucide-react';
import { METODOS_PAGO } from '@cds/shared';
import { api, ErrorApi } from '@/lib/api';
import { pesos } from '@/lib/utils';
import { Boton } from '@/componentes/ui/boton';
import { AreaTexto, Campo } from '@/componentes/ui/campo';
import {
  Dialogo,
  DialogoCabecera,
  DialogoContenido,
  DialogoDescripcion,
  DialogoPie,
  DialogoTitulo,
  Selector,
  SelectorContenido,
  SelectorDisparador,
  SelectorOpcion,
  SelectorValor,
  Separador,
} from '@/componentes/ui/varios';

interface ReservaACobrar {
  id: string;
  codigo: string;
  total: string;
  cliente: { id: string; nombreCompleto: string; esGenerico: boolean } | null;
  servicios: { nombreSnapshot: string; precioSnapshot: string }[];
}

interface EstadoFidelidad {
  activo: boolean;
  sellosDisponibles: number;
  sellosRequeridos: number;
  tienePremio: boolean;
  mensaje: string | null;
}

const ETIQUETAS_PAGO: Record<string, string> = {
  EFECTIVO: 'Efectivo',
  TARJETA: 'Tarjeta',
  TRANSFERENCIA: 'Transferencia',
  NEQUI: 'Nequi',
  DAVIPLATA: 'Daviplata',
  OTRO: 'Otro',
  CORTESIA: 'Cortesía',
};

/**
 * Cobro de una cita.
 *
 * Es el momento en el que el premio de fidelidad tiene que estar delante de
 * los ojos del barbero. Si el cliente llegó a su octavo corte y el barbero no
 * lo ve aquí, no lo va a ver en ninguna parte: por eso se consulta la tarjeta
 * al abrir el diálogo y, si hay premio, se muestra resaltado con el total ya
 * recalculado a cero.
 */
export function DialogoCobrar({
  reserva,
  abierto,
  onCambio,
  onCobrado,
}: {
  reserva: ReservaACobrar;
  abierto: boolean;
  onCambio: (abierto: boolean) => void;
  onCobrado: () => void;
}) {
  const [metodoPago, setMetodoPago] = React.useState<string>('EFECTIVO');
  const [aplicarPremio, setAplicarPremio] = React.useState(false);
  const [notas, setNotas] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const { data: fidelidad } = useQuery({
    queryKey: ['fidelidad', reserva.cliente?.id],
    queryFn: () =>
      api
        .get<{ estado: EstadoFidelidad }>(`/clientes/${reserva.cliente?.id}/fidelidad`)
        .then((r) => r.estado),
    enabled: abierto && Boolean(reserva.cliente?.id) && !reserva.cliente?.esGenerico,
  });

  // El servicio más caro es el que cubre el premio: el mismo criterio que
  // aplica la API, para que el total que se muestra sea el que se va a cobrar.
  const masCaro = React.useMemo(
    () =>
      [...reserva.servicios].sort((a, b) => Number(b.precioSnapshot) - Number(a.precioSnapshot))[0],
    [reserva.servicios],
  );

  const totalFinal = aplicarPremio
    ? Math.max(0, Number(reserva.total) - Number(masCaro?.precioSnapshot ?? 0))
    : Number(reserva.total);

  const cobrar = useMutation({
    mutationFn: () =>
      api.patch(`/reservas/${reserva.id}/completar`, {
        metodoPago: aplicarPremio && totalFinal === 0 ? 'CORTESIA' : metodoPago,
        productos: [],
        aplicarPremioFidelidad: aplicarPremio,
        notas: notas || undefined,
      }),
    onSuccess: onCobrado,
    onError: (e) =>
      setError(e instanceof ErrorApi ? (e.mensaje ?? e.message) : 'No se pudo cobrar la cita.'),
  });

  return (
    <Dialogo open={abierto} onOpenChange={onCambio}>
      <DialogoContenido>
        <DialogoCabecera>
          <DialogoTitulo>Cobrar {reserva.codigo}</DialogoTitulo>
          <DialogoDescripcion>
            {reserva.cliente?.esGenerico
              ? 'Cliente sin registrar — no acumula sellos de fidelidad'
              : reserva.cliente?.nombreCompleto}
          </DialogoDescripcion>
        </DialogoCabecera>

        {error ? (
          <p className="bg-destructive/10 text-destructive border-destructive/25 rounded-md border px-3 py-2 text-sm">
            {error}
          </p>
        ) : null}

        <ul className="space-y-1.5 text-sm">
          {reserva.servicios.map((s, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3">
              <span className="truncate">{s.nombreSnapshot}</span>
              <span className="tabular shrink-0">{pesos(s.precioSnapshot)}</span>
            </li>
          ))}
        </ul>

        {fidelidad?.tienePremio ? (
          <label className="border-primary/40 bg-primary/10 flex cursor-pointer items-start gap-2.5 rounded-lg border p-3">
            <input
              type="checkbox"
              className="accent-primary mt-0.5"
              checked={aplicarPremio}
              onChange={(e) => setAplicarPremio(e.target.checked)}
            />
            <span>
              <span className="text-primary flex items-center gap-1.5 text-sm font-medium">
                <Gift className="size-4" />
                {fidelidad.mensaje ?? 'Tiene premio disponible'}
              </span>
              <span className="text-muted-foreground block text-xs">
                Completó {fidelidad.sellosDisponibles} de {fidelidad.sellosRequeridos} sellos. Al
                aplicarlo, “{masCaro?.nombreSnapshot}” va por la casa y se consumen los sellos.
              </span>
            </span>
          </label>
        ) : fidelidad && !reserva.cliente?.esGenerico ? (
          <p className="text-muted-foreground text-xs">
            Tarjeta de cortes: {fidelidad.sellosDisponibles}/{fidelidad.sellosRequeridos}. Al cobrar
            esta cita suma un sello más.
          </p>
        ) : null}

        <Separador />

        <div className="flex items-baseline justify-between gap-3">
          <span className="font-medium">Total a cobrar</span>
          <span className="tabular text-primary text-2xl font-semibold">{pesos(totalFinal)}</span>
        </div>

        {totalFinal > 0 ? (
          <Campo etiqueta="Método de pago">
            <Selector value={metodoPago} onValueChange={setMetodoPago}>
              <SelectorDisparador>
                <SelectorValor />
              </SelectorDisparador>
              <SelectorContenido>
                {METODOS_PAGO.filter((m) => m !== 'CORTESIA').map((m) => (
                  <SelectorOpcion key={m} value={m}>
                    {ETIQUETAS_PAGO[m] ?? m}
                  </SelectorOpcion>
                ))}
              </SelectorContenido>
            </Selector>
          </Campo>
        ) : null}

        <Campo etiqueta="Nota interna" ayuda="Solo la ven los usuarios del panel.">
          <AreaTexto
            rows={2}
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Opcional"
          />
        </Campo>

        <DialogoPie>
          <Boton variante="fantasma" onClick={() => onCambio(false)}>
            Cancelar
          </Boton>
          <Boton cargando={cobrar.isPending} onClick={() => cobrar.mutate()}>
            <CircleDollarSign />
            Cobrar {pesos(totalFinal)}
          </Boton>
        </DialogoPie>
      </DialogoContenido>
    </Dialogo>
  );
}
