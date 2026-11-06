import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ErrorConsulta } from '@/componentes/error-consulta';
import { cn } from '@/lib/utils';
import { etiquetaFecha, etiquetaMes, sumarDias } from '@/lib/formato';
import { claveCalendario, pedirCalendario } from './consultas';

/**
 * Paso de fecha. No conoce el reductor: recibe lo que necesita y avisa de lo
 * que se elige, así lo reutiliza también quien reprograma una cita.
 */
export interface PropsPasoFecha {
  sedeId: string;
  servicioIds: string[];
  /** Hoy en la zona del negocio (`YYYY-MM-DD`): el primer día que se puede reservar. */
  hoy: string;
  /** Cuántos días hacia adelante se deja reservar. */
  maxDiasAnticipacion: number;
  fechaElegida: string | null;
  alElegirFecha: (fecha: string) => void;
}

const DIAS_SEMANA = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

/** Primer día del mes de una fecha: `2026-11-18` → `2026-11-01`. */
const primerDiaDelMes = (fecha: string) => `${fecha.slice(0, 7)}-01`;

function diasDelMes(primerDia: string): number {
  const [anio, mes] = primerDia.split('-').map(Number);
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/** Casillas vacías antes del día 1, con la semana empezando en lunes. */
function huecosIniciales(primerDia: string): number {
  const diaSemana = new Date(`${primerDia}T12:00:00Z`).getUTCDay(); // 0 = domingo
  return (diaSemana + 6) % 7;
}

export function PasoFecha({
  sedeId,
  servicioIds,
  hoy,
  maxDiasAnticipacion,
  fechaElegida,
  alElegirFecha,
}: PropsPasoFecha) {
  const hasta = sumarDias(hoy, maxDiasAnticipacion);
  const primerMes = primerDiaDelMes(hoy);
  const ultimoMes = primerDiaDelMes(hasta);
  const [mes, setMes] = useState(() => primerDiaDelMes(fechaElegida ?? hoy));

  const parametros = { sedeId, servicioIds, desde: hoy, hasta };
  const calendario = useQuery({
    queryKey: claveCalendario(parametros),
    queryFn: () => pedirCalendario(parametros),
  });

  if (calendario.isError) {
    return <ErrorConsulta error={calendario.error} alReintentar={() => void calendario.refetch()} />;
  }
  if (!calendario.data) {
    return (
      <p role="status" className="text-muted-foreground py-8 text-center">
        Buscando días disponibles…
      </p>
    );
  }

  // Solo se habilita un día que la API marcó con hueco real: mandar al cliente
  // a un día vacío es peor que no dejarle pulsarlo.
  const diasConHueco = new Set(calendario.data.filter((d) => d.hayHueco).map((d) => d.fecha));

  if (diasConHueco.size === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center">
        No hay días con horario libre para esta combinación. Prueba con otra sede u otros servicios.
      </p>
    );
  }

  const casillas: (string | null)[] = [
    ...Array<null>(huecosIniciales(mes)).fill(null),
    ...Array.from({ length: diasDelMes(mes) }, (_, i) => `${mes.slice(0, 8)}${String(i + 1).padStart(2, '0')}`),
  ];

  const mesAnterior = sumarDias(mes, -1);
  const mesSiguiente = sumarDias(mes, 32);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Mes anterior"
          disabled={mes <= primerMes}
          onClick={() => setMes(primerDiaDelMes(mesAnterior))}
          className="hover:bg-accent flex size-12 items-center justify-center rounded-lg text-xl disabled:opacity-30"
        >
          ‹
        </button>
        <h2 className="font-semibold first-letter:uppercase" aria-live="polite">
          {etiquetaMes(mes)}
        </h2>
        <button
          type="button"
          aria-label="Mes siguiente"
          disabled={mes >= ultimoMes}
          onClick={() => setMes(primerDiaDelMes(mesSiguiente))}
          className="hover:bg-accent flex size-12 items-center justify-center rounded-lg text-xl disabled:opacity-30"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {DIAS_SEMANA.map((letra, i) => (
          <span key={i} aria-hidden className="text-muted-foreground py-1 text-center text-xs font-medium">
            {letra}
          </span>
        ))}
        {casillas.map((fecha, i) =>
          fecha === null ? (
            <span key={`vacio-${i}`} />
          ) : (
            <button
              key={fecha}
              type="button"
              aria-label={etiquetaFecha(fecha)}
              aria-pressed={fecha === fechaElegida}
              disabled={!diasConHueco.has(fecha)}
              onClick={() => alElegirFecha(fecha)}
              className={cn(
                'flex aspect-square min-h-11 items-center justify-center rounded-lg text-base font-medium transition-colors',
                'focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]',
                fecha === fechaElegida
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-accent border',
                'disabled:text-muted-foreground/40 disabled:pointer-events-none disabled:border-transparent disabled:bg-transparent',
              )}
            >
              {Number(fecha.slice(8))}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
