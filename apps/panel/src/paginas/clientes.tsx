import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Gift, Search, UserRound, Users } from 'lucide-react';
import type { PaginaRespuesta } from '@cds/shared';
import { api } from '@/lib/api';
import { cn, pesos, tiempoRelativo } from '@/lib/utils';
import { Encabezado } from '@/componentes/armazon';
import { Boton } from '@/componentes/ui/boton';
import { Entrada } from '@/componentes/ui/campo';
import { Tarjeta } from '@/componentes/ui/tarjeta';
import { Esqueleto, EstadoVacio, Insignia } from '@/componentes/ui/varios';

interface ClienteFila {
  id: string;
  nombreCompleto: string;
  telefonoVisible: string;
  totalVisitas: number;
  totalGastado: string;
  ultimaVisitaEn: string | null;
  regresoEstimadoEn: string | null;
  promedioDiasRegreso: number | null;
  sellosDisponibles: number;
  sellosRequeridos: number;
  tienePremio: boolean;
}

type Filtro = 'todos' | 'premio' | 'pendientes';

/**
 * Lista de clientes.
 *
 * Las dos columnas que no son obvias son las que el cliente pidió
 * explícitamente: la **tarjeta de cortes** (cuántos sellos lleva y si ya tiene
 * el premio) y **cada cuánto vuelve**, con la fecha estimada del próximo
 * regreso. Juntas convierten la lista en algo accionable: el filtro
 * "le toca volver" da directamente a quién llamar esta semana.
 */
export function PaginaClientes() {
  const [busqueda, setBusqueda] = React.useState('');
  const [termino, setTermino] = React.useState('');
  const [pagina, setPagina] = React.useState(1);
  const [filtro, setFiltro] = React.useState<Filtro>('todos');

  React.useEffect(() => {
    const t = setTimeout(() => {
      setTermino(busqueda.trim());
      setPagina(1);
    }, 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  const { data, isLoading } = useQuery({
    queryKey: ['clientes', pagina, termino, filtro],
    queryFn: () =>
      api.get<PaginaRespuesta<ClienteFila>>(
        `/clientes?pagina=${pagina}&limite=20` +
          (termino ? `&buscar=${encodeURIComponent(termino)}` : '') +
          (filtro === 'premio' ? '&conPremioDisponible=true' : '') +
          (filtro === 'pendientes' ? '&pendientesDeRegreso=true' : ''),
      ),
  });

  return (
    <>
      <Encabezado titulo="Clientes" descripcion="Historial, visitas y tarjeta de cortes." />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Entrada
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o celular…"
            className="pl-9"
          />
        </div>

        {(
          [
            ['todos', 'Todos'],
            ['premio', 'Con premio'],
            ['pendientes', 'Le toca volver'],
          ] as const
        ).map(([valor, texto]) => (
          <Boton
            key={valor}
            variante={filtro === valor ? 'primario' : 'contorno'}
            tamano="sm"
            onClick={() => {
              setFiltro(valor);
              setPagina(1);
            }}
          >
            {texto}
          </Boton>
        ))}
      </div>

      <Tarjeta className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <Esqueleto key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : data && data.datos.length > 0 ? (
          <>
            {/* Tabla en pantalla ancha, tarjetas en móvil */}
            <table className="hidden w-full text-sm sm:table">
              <thead className="bg-muted/50 text-muted-foreground border-b text-xs">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Cliente</th>
                  <th className="px-4 py-2.5 text-right font-medium">Visitas</th>
                  <th className="px-4 py-2.5 text-right font-medium">Gastado</th>
                  <th className="px-4 py-2.5 text-left font-medium">Última</th>
                  <th className="px-4 py-2.5 text-left font-medium">Vuelve cada</th>
                  <th className="px-4 py-2.5 text-left font-medium">Tarjeta</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.datos.map((cliente) => (
                  <tr key={cliente.id} className="hover:bg-accent/40 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="bg-secondary text-secondary-foreground flex size-8 shrink-0 items-center justify-center rounded-full">
                          <UserRound className="size-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{cliente.nombreCompleto}</p>
                          <p className="text-muted-foreground tabular text-xs">
                            {cliente.telefonoVisible}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="tabular px-4 py-3 text-right">{cliente.totalVisitas}</td>
                    <td className="tabular px-4 py-3 text-right">{pesos(cliente.totalGastado)}</td>
                    <td className="text-muted-foreground px-4 py-3">
                      {tiempoRelativo(cliente.ultimaVisitaEn)}
                    </td>
                    <td className="px-4 py-3">
                      {cliente.promedioDiasRegreso ? (
                        <span className="tabular">{cliente.promedioDiasRegreso} días</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">sin datos</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <TarjetaCortes
                        sellos={cliente.sellosDisponibles}
                        requeridos={cliente.sellosRequeridos}
                        premio={cliente.tienePremio}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="divide-y sm:hidden">
              {data.datos.map((cliente) => (
                <li key={cliente.id} className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{cliente.nombreCompleto}</p>
                      <p className="text-muted-foreground tabular text-xs">
                        {cliente.telefonoVisible}
                      </p>
                    </div>
                    {cliente.tienePremio ? (
                      <Insignia variante="primaria">
                        <Gift className="size-3" />
                        Premio
                      </Insignia>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {cliente.totalVisitas} visitas · {pesos(cliente.totalGastado)} · última{' '}
                    {tiempoRelativo(cliente.ultimaVisitaEn)}
                  </p>
                  <TarjetaCortes
                    sellos={cliente.sellosDisponibles}
                    requeridos={cliente.sellosRequeridos}
                    premio={cliente.tienePremio}
                  />
                </li>
              ))}
            </ul>

            <div className="text-muted-foreground flex items-center justify-between gap-2 border-t px-4 py-3 text-xs">
              <span>
                {data.meta.total} {data.meta.total === 1 ? 'cliente' : 'clientes'}
                {data.meta.totalPaginas > 1
                  ? ` · página ${data.meta.pagina} de ${data.meta.totalPaginas}`
                  : ''}
              </span>
              <div className="flex gap-1">
                <Boton
                  variante="contorno"
                  tamano="iconoSm"
                  disabled={!data.meta.hayAnterior}
                  onClick={() => setPagina((p) => p - 1)}
                >
                  <ChevronLeft />
                </Boton>
                <Boton
                  variante="contorno"
                  tamano="iconoSm"
                  disabled={!data.meta.haySiguiente}
                  onClick={() => setPagina((p) => p + 1)}
                >
                  <ChevronRight />
                </Boton>
              </div>
            </div>
          </>
        ) : (
          <EstadoVacio
            icono={Users}
            titulo={termino ? 'Ningún cliente coincide' : 'Todavía no hay clientes'}
            descripcion={
              termino
                ? 'Prueba con el celular o con una parte del nombre.'
                : filtro === 'premio'
                  ? 'Cuando alguien complete su tarjeta de cortes aparecerá aquí.'
                  : 'Los clientes se van creando al registrar reservas.'
            }
          />
        )}
      </Tarjeta>
    </>
  );
}

/**
 * La tarjeta de cortes, dibujada como la de cartón que se sella a mano.
 *
 * Es deliberado: el barbero y el cliente ya entienden ese objeto, así que no
 * hay que explicar nada. Un número suelto («5/7») se lee; una fila de sellos
 * se reconoce de un golpe de vista.
 */
function TarjetaCortes({
  sellos,
  requeridos,
  premio,
}: {
  sellos: number;
  requeridos: number;
  premio: boolean;
}) {
  if (premio) {
    return (
      <Insignia variante="primaria">
        <Gift className="size-3" />
        Corte gratis
      </Insignia>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex gap-0.5">
        {Array.from({ length: requeridos }).map((_, i) => (
          <span
            key={i}
            className={cn(
              'size-2 rounded-full',
              i < sellos ? 'bg-primary' : 'bg-muted border-border border',
            )}
          />
        ))}
      </div>
      <span className="text-muted-foreground tabular text-xs">
        {sellos}/{requeridos}
      </span>
    </div>
  );
}
