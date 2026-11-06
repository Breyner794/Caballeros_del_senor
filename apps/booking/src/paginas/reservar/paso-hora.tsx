import { useQuery } from '@tanstack/react-query';
import type { BarberoPublico, HuecoPublico } from '@cds/shared';
import { ErrorConsulta } from '@/componentes/error-consulta';
import { Campo, Selector } from '@/componentes/ui/campo';
import { cn } from '@/lib/utils';
import { etiquetaFecha, etiquetaHora } from '@/lib/formato';
import { claveDisponibilidad, pedirDisponibilidad } from './consultas';

/**
 * Paso de hora. Como el de fecha, no conoce el reductor: lo reutiliza quien
 * reprograma una cita.
 */
export interface PropsPasoHora {
  sedeId: string;
  fecha: string;
  servicioIds: string[];
  /** `null` es «cualquier barbero». */
  barberoId: string | null;
  /**
   * Los barberos entre los que se puede elegir, o `null` si no se ofrece la
   * elección (`permiteElegirBarbero` desactivado). Sin elección, la rejilla
   * es la unión de huecos de la sede, sin decir de quién es cada uno.
   */
  barberos: BarberoPublico[] | null;
  /** `inicioEn` del hueco elegido. */
  huecoElegido: string | null;
  alElegirHueco: (hueco: HuecoPublico) => void;
  alElegirBarbero: (barberoId: string | null) => void;
}

export function PasoHora({
  sedeId,
  fecha,
  servicioIds,
  barberoId,
  barberos,
  huecoElegido,
  alElegirHueco,
  alElegirBarbero,
}: PropsPasoHora) {
  const parametros = { sedeId, fecha, servicioIds, barberoId };
  const disponibilidad = useQuery({
    queryKey: claveDisponibilidad(parametros),
    queryFn: () => pedirDisponibilidad(parametros),
  });

  const huecos = disponibilidad.data?.huecos;
  const hayLibres = huecos?.some((h) => h.disponible) ?? false;

  return (
    <div className="space-y-5">
      <p className="text-muted-foreground first-letter:uppercase">{etiquetaFecha(fecha)}</p>

      {barberos && barberos.length > 0 ? (
        <Campo etiqueta="Barbero">
          {(props) => (
            <Selector
              {...props}
              value={barberoId ?? ''}
              onChange={(e) => alElegirBarbero(e.target.value === '' ? null : e.target.value)}
            >
              <option value="">Cualquier barbero</option>
              {barberos.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nombre}
                </option>
              ))}
            </Selector>
          )}
        </Campo>
      ) : null}

      {disponibilidad.isError ? (
        <ErrorConsulta error={disponibilidad.error} alReintentar={() => void disponibilidad.refetch()} />
      ) : !huecos ? (
        <p role="status" className="text-muted-foreground py-8 text-center">
          Buscando horarios…
        </p>
      ) : !hayLibres ? (
        <p className="text-muted-foreground py-8 text-center">
          Ya no quedan horarios libres este día. Elige otro día.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {huecos.map((hueco) => (
            <button
              key={hueco.inicioEn}
              type="button"
              aria-pressed={hueco.inicioEn === huecoElegido}
              disabled={!hueco.disponible}
              onClick={() => alElegirHueco(hueco)}
              className={cn(
                'min-h-12 rounded-lg border px-1 text-base font-medium transition-colors',
                'focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]',
                hueco.inicioEn === huecoElegido
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'hover:bg-accent',
                'disabled:text-muted-foreground/40 disabled:pointer-events-none disabled:line-through',
              )}
            >
              {etiquetaHora(hueco.hora)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
