import { useEffect } from 'react';
import type { OpcionesPublicas, ServicioPublico } from '@cds/shared';
import { formatearDuracion, formatearPrecio } from '@/lib/formato';

interface Props {
  opciones: OpcionesPublicas;
  serviciosElegidos: ServicioPublico[];
  sedeId: string | null;
  alAlternarServicio: (servicio: ServicioPublico) => void;
  alElegirSede: (sedeId: string) => void;
}

/** Tarjeta de elección: toda la superficie es el área táctil, no solo el casillero. */
const TARJETA =
  'flex min-h-16 cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors has-[:checked]:border-primary has-[:checked]:bg-accent has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50';

export function PasoServicio({
  opciones,
  serviciosElegidos,
  sedeId,
  alAlternarServicio,
  alElegirSede,
}: Props) {
  const { sedes, servicios, config } = opciones;

  // Con una sola sede no hay nada que preguntar: preguntarlo sería ruido.
  const sedeUnica = sedes.length === 1 ? sedes[0].id : null;
  useEffect(() => {
    if (sedeUnica && sedeId !== sedeUnica) alElegirSede(sedeUnica);
  }, [sedeUnica, sedeId, alElegirSede]);

  return (
    <div className="space-y-8">
      {sedes.length > 1 ? (
        <fieldset className="space-y-3">
          <legend className="mb-3 text-lg font-semibold">¿En qué sede?</legend>
          {sedes.map((sede) => (
            <label key={sede.id} className={TARJETA}>
              <input
                type="radio"
                name="sede"
                value={sede.id}
                checked={sedeId === sede.id}
                onChange={() => alElegirSede(sede.id)}
                className="accent-primary mt-0.5 size-5 shrink-0"
              />
              <span className="min-w-0">
                <span className="block font-medium">{sede.nombre}</span>
                {sede.direccion ? (
                  <span className="text-muted-foreground block text-sm">
                    {[sede.direccion, sede.ciudad].filter(Boolean).join(', ')}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      <fieldset className="space-y-3">
        <legend className="mb-3 text-lg font-semibold">¿Qué te hacemos?</legend>
        {servicios.map((servicio) => (
          <label key={servicio.id} className={TARJETA}>
            <input
              type="checkbox"
              checked={serviciosElegidos.some((s) => s.id === servicio.id)}
              onChange={() => alAlternarServicio(servicio)}
              className="accent-primary mt-0.5 size-5 shrink-0"
            />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{servicio.nombre}</span>
              {servicio.descripcion ? (
                <span className="text-muted-foreground block text-sm">{servicio.descripcion}</span>
              ) : null}
              <span className="text-muted-foreground mt-1 block text-sm">
                {formatearPrecio(servicio.precio, config.moneda)} ·{' '}
                {formatearDuracion(servicio.duracionMinutos)}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}
