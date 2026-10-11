import { useQuery } from '@tanstack/react-query';
import { Clock, Scissors } from 'lucide-react';
import type { PaginaRespuesta } from '@cds/shared';
import { api } from '@/lib/api';
import { pesos } from '@/lib/utils';
import { Encabezado } from '@/componentes/armazon';
import { Tarjeta, TarjetaContenido } from '@/componentes/ui/tarjeta';
import { Esqueleto, EstadoVacio, Insignia } from '@/componentes/ui/varios';

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
  color: string | null;
}

export function PaginaServicios() {
  const { data, isLoading } = useQuery({
    queryKey: ['servicios', 'lista'],
    queryFn: () => api.get<PaginaRespuesta<Servicio>>('/servicios?limite=100'),
  });

  return (
    <>
      <Encabezado
        titulo="Servicios"
        descripcion="Lo que ofrece la barbería: precio, duración y qué incluye."
      />

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Esqueleto key={i} className="h-36" />
          ))}
        </div>
      ) : data && data.datos.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.datos.map((servicio) => (
            <Tarjeta key={servicio.id} className="relative overflow-hidden">
              {/* Franja del color que el servicio usa en el calendario */}
              {servicio.color ? (
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 w-1"
                  style={{ backgroundColor: servicio.color }}
                />
              ) : null}

              <TarjetaContenido className="space-y-3 p-5 pt-5 pl-6">
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
                  <p className="text-muted-foreground line-clamp-2 text-sm">{servicio.descripcion}</p>
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

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {!servicio.activo ? <Insignia variante="peligro">Desactivado</Insignia> : null}
                  {!servicio.visibleWeb ? (
                    <Insignia variante="contorno">Solo en el panel</Insignia>
                  ) : null}
                  {!servicio.cuentaFidelidad ? (
                    <Insignia variante="contorno">No suma sellos</Insignia>
                  ) : null}
                </div>
              </TarjetaContenido>
            </Tarjeta>
          ))}
        </div>
      ) : (
        <Tarjeta>
          <EstadoVacio
            icono={Scissors}
            titulo="Todavía no hay servicios"
            descripcion="Sin servicios no se pueden registrar reservas: son los que definen el precio y, sobre todo, cuánto dura cada cita."
          />
        </Tarjeta>
      )}
    </>
  );
}
