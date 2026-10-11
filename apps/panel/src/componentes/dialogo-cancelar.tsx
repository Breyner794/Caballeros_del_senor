import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { Phone, TriangleAlert } from 'lucide-react';
import { telefonoVisible } from '@cds/shared';
import { api, ErrorApi } from '@/lib/api';
import { fechaCorta, hora } from '@/lib/utils';
import { Boton } from '@/componentes/ui/boton';
import { AreaTexto, Campo } from '@/componentes/ui/campo';
import {
  Dialogo,
  DialogoCabecera,
  DialogoContenido,
  DialogoDescripcion,
  DialogoPie,
  DialogoTitulo,
} from '@/componentes/ui/varios';
import type { ReservaTabla } from '@/paginas/reservas';

/**
 * Cancelar una cita.
 *
 * Cancelar libera el hueco al instante, así que es una acción que no se
 * deshace sola: si alguien reserva encima, la cita original ya no se puede
 * recuperar. Por eso hay confirmación explícita y, sobre todo, el teléfono
 * del cliente a mano — lo que hay que hacer antes de cancelar es avisarle.
 */
export function DialogoCancelar({
  reserva,
  abierto,
  onCambio,
  onCancelada,
}: {
  reserva: ReservaTabla;
  abierto: boolean;
  onCambio: (v: boolean) => void;
  onCancelada: () => void;
}) {
  const [motivo, setMotivo] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const cancelar = useMutation({
    mutationFn: () =>
      api.patch(`/reservas/${reserva.id}/cancelar`, {
        motivo: motivo || undefined,
        notificar: true,
      }),
    onSuccess: onCancelada,
    onError: (e) =>
      setError(e instanceof ErrorApi ? e.mensaje : 'No se pudo cancelar la cita.'),
  });

  const telefono = reserva.cliente?.telefono;
  const esGenerico = reserva.cliente?.esGenerico ?? true;

  return (
    <Dialogo open={abierto} onOpenChange={onCambio}>
      <DialogoContenido>
        <DialogoCabecera>
          <DialogoTitulo className="flex items-center gap-2">
            <TriangleAlert className="text-destructive size-5" />
            Cancelar la cita {reserva.codigo}
          </DialogoTitulo>
          <DialogoDescripcion className="capitalize">
            {fechaCorta(reserva.inicioEn)} a las{' '}
            <span className="tabular">{hora(reserva.inicioEn)}</span> ·{' '}
            {reserva.cliente?.nombreCompleto ?? 'Cliente sin ficha'}
          </DialogoDescripcion>
        </DialogoCabecera>

        {error ? (
          <p className="bg-destructive/10 text-destructive border-destructive/25 rounded-md border px-3 py-2 text-sm">
            {error}
          </p>
        ) : null}

        {telefono && !esGenerico ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">¿Ya avisaste al cliente?</p>
              <p className="text-muted-foreground text-xs">
                El hueco se libera al cancelar y otro cliente puede tomarlo.
              </p>
            </div>
            <Boton variante="contorno" tamano="sm" comoHijo>
              <a href={`tel:${telefono}`}>
                <Phone />
                <span className="tabular">{telefonoVisible(telefono)}</span>
              </a>
            </Boton>
          </div>
        ) : null}

        <Campo etiqueta="Motivo" ayuda="Queda registrado en la auditoría de la cita.">
          <AreaTexto
            rows={2}
            autoFocus
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="El cliente avisó que no podía venir…"
          />
        </Campo>

        <DialogoPie>
          <Boton variante="fantasma" onClick={() => onCambio(false)}>
            No cancelar
          </Boton>
          <Boton variante="destructivo" cargando={cancelar.isPending} onClick={() => cancelar.mutate()}>
            Cancelar la cita
          </Boton>
        </DialogoPie>
      </DialogoContenido>
    </Dialogo>
  );
}
