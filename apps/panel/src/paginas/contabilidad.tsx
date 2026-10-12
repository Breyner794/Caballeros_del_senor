import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BarChart3, Calculator, Download, RotateCcw, Store, TrendingUp } from 'lucide-react';
import { api } from '@/lib/api';
import { aFechaISO, cn, pesos } from '@/lib/utils';
import { useSesion } from '@/hooks/sesion';
import { Encabezado } from '@/componentes/armazon';
import { Boton } from '@/componentes/ui/boton';
import { Entrada } from '@/componentes/ui/campo';
import {
  Tarjeta,
  TarjetaCabecera,
  TarjetaContenido,
  TarjetaDescripcion,
  TarjetaTitulo,
} from '@/componentes/ui/tarjeta';
import {
  Esqueleto,
  EstadoVacio,
  Selector,
  SelectorContenido,
  SelectorDisparador,
  SelectorOpcion,
  SelectorValor,
  Separador,
} from '@/componentes/ui/varios';

interface Sede {
  id: string;
  nombre: string;
}

interface Resumen {
  ingresos: number;
  cortesias: number;
  descuentos: number;
  ingresosServicios: number;
  ingresosProductos: number;
  costoProductos: number;
  margenProductos: number;
  comisiones: number;
  paraElNegocio: number;
  totalVentas: number;
  totalCitas: number;
  ticketPromedio: number;
}

interface FilaBarbero {
  barberoId: string | null;
  nombre: string;
  sede: string;
  ventas: number;
  ingresos: number;
  cortesias: number;
  comision: number;
  paraElNegocio: number;
  porcentajeEfectivo: number;
}

interface FilaSede {
  sedeId: string;
  nombre: string;
  ventas: number;
  ingresos: number;
  comisiones: number;
  paraElNegocio: number;
}

interface PuntoDia {
  dia: string;
  ingresos: number;
  comisiones: number;
  ventas: number;
}

interface FilaServicio {
  nombre: string;
  veces: number;
  ingresos: number;
  cortesias: number;
}

interface Simulacion {
  filas: (FilaBarbero & {
    porcentajeSimulado: number;
    comisionSimulada: number;
    diferencia: number;
  })[];
  totales: {
    ingresos: number;
    comisionActual: number;
    comisionSimulada: number;
    diferencia: number;
    paraElNegocioActual: number;
    paraElNegocioSimulado: number;
  };
}

type Periodo = 'mes' | 'mesPasado' | 'semana' | 'anio';

/**
 * Contabilidad.
 *
 * Los gráficos usan una sola serie y tinta neutra a propósito: el panel es
 * blanco y negro, y una barra no necesita color para comunicar magnitud — la
 * longitud ya lo hace. El color queda libre para lo que sí lo necesita, como
 * marcar una diferencia negativa en el simulador.
 */
export function PaginaContabilidad() {
  const { puede } = useSesion();
  const [periodo, setPeriodo] = React.useState<Periodo>('mes');
  const [sedeId, setSedeId] = React.useState('');

  const { desde, hasta } = React.useMemo(() => calcularPeriodo(periodo), [periodo]);
  const consulta = `desde=${desde}&hasta=${hasta}${sedeId ? `&sedeId=${sedeId}` : ''}`;

  const { data: sedes } = useQuery({
    queryKey: ['sedes', 'activas'],
    queryFn: () => api.get<Sede[]>('/sedes?soloActivas=true'),
  });

  const { data: resumen, isLoading } = useQuery({
    queryKey: ['contabilidad', 'resumen', consulta],
    queryFn: () => api.get<Resumen>(`/contabilidad/resumen?${consulta}`),
  });

  const { data: porBarbero } = useQuery({
    queryKey: ['contabilidad', 'barbero', consulta],
    queryFn: () => api.get<FilaBarbero[]>(`/contabilidad/por-barbero?${consulta}`),
  });

  const { data: porSede } = useQuery({
    queryKey: ['contabilidad', 'sede', desde, hasta],
    queryFn: () => api.get<FilaSede[]>(`/contabilidad/por-sede?desde=${desde}&hasta=${hasta}`),
    enabled: puede('contabilidad:ver_todas_sedes'),
  });

  const { data: evolucion } = useQuery({
    queryKey: ['contabilidad', 'evolucion', consulta],
    queryFn: () => api.get<PuntoDia[]>(`/contabilidad/evolucion?${consulta}`),
  });

  const { data: porServicio } = useQuery({
    queryKey: ['contabilidad', 'servicio', consulta],
    queryFn: () => api.get<FilaServicio[]>(`/contabilidad/por-servicio?${consulta}`),
  });

  const vacio = resumen && resumen.totalVentas === 0;

  return (
    <>
      <Encabezado titulo="Contabilidad" descripcion="Qué entró, cuánto se llevó cada barbero y qué queda.">
        <Selector value={periodo} onValueChange={(v) => setPeriodo(v as Periodo)}>
          <SelectorDisparador className="w-44">
            <SelectorValor />
          </SelectorDisparador>
          <SelectorContenido>
            <SelectorOpcion value="semana">Últimos 7 días</SelectorOpcion>
            <SelectorOpcion value="mes">Este mes</SelectorOpcion>
            <SelectorOpcion value="mesPasado">Mes pasado</SelectorOpcion>
            <SelectorOpcion value="anio">Este año</SelectorOpcion>
          </SelectorContenido>
        </Selector>

        {puede('contabilidad:ver_todas_sedes') ? (
          <Selector value={sedeId || 'todas'} onValueChange={(v) => setSedeId(v === 'todas' ? '' : v)}>
            <SelectorDisparador className="w-48">
              <SelectorValor placeholder="Sede" />
            </SelectorDisparador>
            <SelectorContenido>
              <SelectorOpcion value="todas">Todas las sedes</SelectorOpcion>
              {(sedes ?? []).map((s) => (
                <SelectorOpcion key={s.id} value={s.id}>
                  {s.nombre}
                </SelectorOpcion>
              ))}
            </SelectorContenido>
          </Selector>
        ) : null}

        {puede('contabilidad:exportar') ? (
          <Boton variante="contorno" onClick={() => exportarCsv(desde, hasta, sedeId)}>
            <Download />
            Exportar
          </Boton>
        ) : null}
      </Encabezado>

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Esqueleto key={i} className="h-24" />
            ))}
          </div>
          <Esqueleto className="h-64" />
        </div>
      ) : vacio ? (
        <Tarjeta>
          <EstadoVacio
            icono={BarChart3}
            titulo="No hubo ventas en este periodo"
            descripcion="Las cifras salen de las citas cobradas. En cuanto se cobre la primera, aparece aquí."
          />
        </Tarjeta>
      ) : (
        <div className="space-y-4">
          {/* Cifras principales */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Cifra
              etiqueta="Entró a caja"
              valor={pesos(resumen?.ingresos ?? 0)}
              detalle={`${resumen?.totalVentas ?? 0} ventas · ${resumen?.totalCitas ?? 0} citas`}
            />
            <Cifra
              etiqueta="Para los barberos"
              valor={pesos(resumen?.comisiones ?? 0)}
              detalle="comisiones del periodo"
            />
            <Cifra
              etiqueta="Queda para el negocio"
              valor={pesos(resumen?.paraElNegocio ?? 0)}
              detalle="tras comisiones y costo de producto"
              destacado
            />
            <Cifra
              etiqueta="Ticket promedio"
              valor={pesos(resumen?.ticketPromedio ?? 0)}
              detalle={
                (resumen?.cortesias ?? 0) > 0
                  ? `${pesos(resumen?.cortesias ?? 0)} en cortesías`
                  : 'por venta'
              }
            />
          </div>

          {/* Evolución diaria */}
          <Tarjeta>
            <TarjetaCabecera>
              <TarjetaTitulo className="flex items-center gap-2">
                <TrendingUp className="size-4" />
                Día a día
              </TarjetaTitulo>
              <TarjetaDescripcion>Lo que entró a caja cada día del periodo.</TarjetaDescripcion>
            </TarjetaCabecera>
            <TarjetaContenido>
              <GraficoDiario puntos={evolucion ?? []} />
            </TarjetaContenido>
          </Tarjeta>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Por barbero */}
            <Tarjeta>
              <TarjetaCabecera>
                <TarjetaTitulo>Por barbero</TarjetaTitulo>
                <TarjetaDescripcion>
                  Lo que generó cada uno y lo que le corresponde.
                </TarjetaDescripcion>
              </TarjetaCabecera>
              <TarjetaContenido>
                <TablaBarberos filas={porBarbero ?? []} />
              </TarjetaContenido>
            </Tarjeta>

            {/* Por sede */}
            {puede('contabilidad:ver_todas_sedes') ? (
              <Tarjeta>
                <TarjetaCabecera>
                  <TarjetaTitulo className="flex items-center gap-2">
                    <Store className="size-4" />
                    Por sede
                  </TarjetaTitulo>
                  <TarjetaDescripcion>Comparación entre locales.</TarjetaDescripcion>
                </TarjetaCabecera>
                <TarjetaContenido>
                  <BarrasHorizontales
                    filas={(porSede ?? []).map((s) => ({
                      clave: s.sedeId,
                      etiqueta: s.nombre,
                      valor: s.ingresos,
                      detalle: `${s.ventas} ventas`,
                    }))}
                  />
                </TarjetaContenido>
              </Tarjeta>
            ) : null}

            {/* Por servicio */}
            <Tarjeta className={puede('contabilidad:ver_todas_sedes') ? 'lg:col-span-2' : ''}>
              <TarjetaCabecera>
                <TarjetaTitulo>Qué servicios dan el dinero</TarjetaTitulo>
                <TarjetaDescripcion>
                  Útil para decidir precios y qué promocionar.
                </TarjetaDescripcion>
              </TarjetaCabecera>
              <TarjetaContenido>
                <BarrasHorizontales
                  filas={(porServicio ?? []).map((s) => ({
                    clave: s.nombre,
                    etiqueta: s.nombre,
                    valor: s.ingresos,
                    detalle: `${s.veces} ${s.veces === 1 ? 'vez' : 'veces'}${
                      s.cortesias > 0 ? ` · ${s.cortesias} de cortesía` : ''
                    }`,
                  }))}
                />
              </TarjetaContenido>
            </Tarjeta>
          </div>

          {/* Desglose de productos */}
          {(resumen?.ingresosProductos ?? 0) > 0 ? (
            <Tarjeta>
              <TarjetaCabecera>
                <TarjetaTitulo>Productos</TarjetaTitulo>
              </TarjetaCabecera>
              <TarjetaContenido>
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div>
                    <dt className="text-muted-foreground text-xs">Vendido</dt>
                    <dd className="tabular text-lg font-semibold">
                      {pesos(resumen?.ingresosProductos ?? 0)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Costo</dt>
                    <dd className="tabular text-lg font-semibold">
                      {pesos(resumen?.costoProductos ?? 0)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Margen</dt>
                    <dd className="tabular text-lg font-semibold">
                      {pesos(resumen?.margenProductos ?? 0)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Servicios</dt>
                    <dd className="tabular text-lg font-semibold">
                      {pesos(resumen?.ingresosServicios ?? 0)}
                    </dd>
                  </div>
                </dl>
              </TarjetaContenido>
            </Tarjeta>
          ) : null}

          {/* La calculadora de reparto */}
          <Calculadora desde={desde} hasta={hasta} sedeId={sedeId} />
        </div>
      )}
    </>
  );
}

function Cifra({
  etiqueta,
  valor,
  detalle,
  destacado,
}: {
  etiqueta: string;
  valor: string;
  detalle?: string;
  destacado?: boolean;
}) {
  return (
    <Tarjeta className={cn(destacado && 'border-foreground/25')}>
      <TarjetaContenido className="p-4 pt-4">
        <p className="text-muted-foreground text-xs font-medium">{etiqueta}</p>
        <p className="tabular mt-0.5 truncate text-2xl font-semibold">{valor}</p>
        {detalle ? <p className="text-muted-foreground mt-0.5 truncate text-xs">{detalle}</p> : null}
      </TarjetaContenido>
    </Tarjeta>
  );
}

/**
 * Evolución diaria.
 *
 * Una sola serie, barras finas con el extremo redondeado y apoyadas en la
 * línea base. Sin rejilla: la referencia la da el máximo etiquetado arriba, y
 * una rejilla completa en un gráfico de este tamaño solo añade ruido.
 */
function GraficoDiario({ puntos }: { puntos: PuntoDia[] }) {
  const [activo, setActivo] = React.useState<number | null>(null);

  if (puntos.length === 0) {
    return <p className="text-muted-foreground py-8 text-center text-sm">Sin datos en el periodo.</p>;
  }

  const maximo = Math.max(...puntos.map((p) => p.ingresos), 1);
  const punto = activo !== null ? puntos[activo] : null;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="text-muted-foreground tabular text-xs">Máximo: {pesos(maximo)}</p>
        {punto ? (
          <p className="text-sm">
            <span className="font-medium">{formatearDia(punto.dia)}</span>
            <span className="tabular text-muted-foreground"> · {pesos(punto.ingresos)}</span>
            <span className="text-muted-foreground"> · {punto.ventas} ventas</span>
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">Pasa el cursor por una barra</p>
        )}
      </div>

      <div
        className="flex h-40 items-end gap-[2px]"
        onMouseLeave={() => setActivo(null)}
        role="img"
        aria-label={`Ingresos diarios del periodo. Máximo ${pesos(maximo)}.`}
      >
        {puntos.map((p, i) => (
          <button
            key={p.dia}
            type="button"
            className="group relative flex h-full flex-1 cursor-default items-end"
            onMouseEnter={() => setActivo(i)}
            onFocus={() => setActivo(i)}
            aria-label={`${formatearDia(p.dia)}: ${pesos(p.ingresos)}`}
          >
            {/* Zona de activación completa, barra proporcional dentro */}
            <span
              className={cn(
                'w-full rounded-t-[4px] transition-colors',
                activo === i ? 'bg-foreground' : 'bg-foreground/70 group-hover:bg-foreground',
              )}
              style={{ height: `${Math.max((p.ingresos / maximo) * 100, p.ingresos > 0 ? 2 : 0)}%` }}
            />
          </button>
        ))}
      </div>

      <div className="text-muted-foreground flex justify-between text-xs">
        <span>{formatearDia(puntos[0]?.dia ?? '')}</span>
        <span>{formatearDia(puntos[puntos.length - 1]?.dia ?? '')}</span>
      </div>
    </div>
  );
}

/** Barras horizontales de una sola serie, con el valor etiquetado al lado. */
function BarrasHorizontales({
  filas,
}: {
  filas: { clave: string; etiqueta: string; valor: number; detalle?: string }[];
}) {
  if (filas.length === 0) {
    return <p className="text-muted-foreground py-6 text-center text-sm">Sin datos.</p>;
  }

  const maximo = Math.max(...filas.map((f) => f.valor), 1);

  return (
    <ul className="space-y-3">
      {filas.map((fila) => (
        <li key={fila.clave}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="truncate text-sm">{fila.etiqueta}</span>
            <span className="tabular shrink-0 text-sm font-semibold">{pesos(fila.valor)}</span>
          </div>
          <div className="bg-muted h-2 overflow-hidden rounded-full">
            <div
              className="bg-foreground h-full rounded-full"
              style={{ width: `${Math.max((fila.valor / maximo) * 100, fila.valor > 0 ? 2 : 0)}%` }}
            />
          </div>
          {fila.detalle ? (
            <p className="text-muted-foreground mt-0.5 text-xs">{fila.detalle}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function TablaBarberos({ filas }: { filas: FilaBarbero[] }) {
  if (filas.length === 0) {
    return <p className="text-muted-foreground py-6 text-center text-sm">Sin ventas.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-muted-foreground border-b text-xs">
          <tr>
            <th className="py-2 text-left font-medium">Barbero</th>
            <th className="py-2 text-right font-medium">Generó</th>
            <th className="py-2 text-right font-medium">Se lleva</th>
            <th className="py-2 text-right font-medium">Queda</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {filas.map((fila) => (
            <tr key={fila.barberoId ?? fila.nombre}>
              <td className="py-2">
                <p className="truncate font-medium">{fila.nombre}</p>
                <p className="text-muted-foreground text-xs">
                  {fila.sede} · {fila.ventas} ventas
                </p>
              </td>
              <td className="tabular py-2 text-right">{pesos(fila.ingresos)}</td>
              <td className="tabular py-2 text-right">
                {pesos(fila.comision)}
                <span className="text-muted-foreground block text-xs">
                  {fila.porcentajeEfectivo}%
                </span>
              </td>
              <td className="tabular py-2 text-right font-medium">{pesos(fila.paraElNegocio)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Simulador de reparto.
 *
 * Responde a «¿y si a Andrés le subo al 55%?» sobre los datos reales del
 * periodo, sin tocar nada. Es importante que no guarde: el reparto real se
 * fija con una vigencia desde una fecha, y cambiarlo nunca reescribe los
 * cierres ya hechos. Aquí solo se mira el número antes de decidir.
 */
function Calculadora({ desde, hasta, sedeId }: { desde: string; hasta: string; sedeId: string }) {
  const [porcentajes, setPorcentajes] = React.useState<Record<string, number>>({});
  const [resultado, setResultado] = React.useState<Simulacion | null>(null);

  const { data: base } = useQuery({
    queryKey: ['contabilidad', 'barbero', 'calculadora', desde, hasta, sedeId],
    queryFn: () =>
      api.get<FilaBarbero[]>(
        `/contabilidad/por-barbero?desde=${desde}&hasta=${hasta}${sedeId ? `&sedeId=${sedeId}` : ''}`,
      ),
  });

  // Se precargan los porcentajes reales del periodo: el punto de partida es lo
  // que de verdad se pagó, no un número en blanco.
  React.useEffect(() => {
    if (!base) return;
    const inicial: Record<string, number> = {};
    for (const fila of base) {
      if (fila.barberoId) inicial[fila.barberoId] = fila.porcentajeEfectivo;
    }
    setPorcentajes(inicial);
    setResultado(null);
  }, [base]);

  const simular = useMutation({
    mutationFn: () =>
      api.post<Simulacion>('/contabilidad/simular-reparto', {
        desde,
        hasta,
        ...(sedeId ? { sedeId } : {}),
        porcentajes: Object.entries(porcentajes).map(([barberoId, porcentaje]) => ({
          barberoId,
          porcentaje,
        })),
      }),
    onSuccess: setResultado,
  });

  if (!base || base.length === 0) return null;

  return (
    <Tarjeta>
      <TarjetaCabecera>
        <TarjetaTitulo className="flex items-center gap-2">
          <Calculator className="size-4" />
          Simulador de reparto
        </TarjetaTitulo>
        <TarjetaDescripcion>
          Prueba otros porcentajes sobre las ventas reales del periodo. No guarda nada: para
          cambiarlo de verdad hay que fijar la comisión con fecha de entrada en vigor.
        </TarjetaDescripcion>
      </TarjetaCabecera>

      <TarjetaContenido className="space-y-4">
        <ul className="space-y-2">
          {base.map((fila) => {
            const simulada = resultado?.filas.find((f) => f.barberoId === fila.barberoId);
            return (
              <li key={fila.barberoId ?? fila.nombre} className="flex flex-wrap items-center gap-3">
                <div className="min-w-32 flex-1">
                  <p className="truncate text-sm font-medium">{fila.nombre}</p>
                  <p className="text-muted-foreground tabular text-xs">
                    generó {pesos(fila.ingresos)}
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  <Entrada
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    className="tabular w-20"
                    value={fila.barberoId ? (porcentajes[fila.barberoId] ?? 0) : 0}
                    onChange={(e) =>
                      fila.barberoId &&
                      setPorcentajes((p) => ({ ...p, [fila.barberoId!]: Number(e.target.value) }))
                    }
                  />
                  <span className="text-muted-foreground text-sm">%</span>
                </div>

                <div className="w-32 text-right">
                  {simulada ? (
                    <>
                      <p className="tabular text-sm font-semibold">
                        {pesos(simulada.comisionSimulada)}
                      </p>
                      {simulada.diferencia !== 0 ? (
                        <p
                          className={cn(
                            'tabular text-xs',
                            simulada.diferencia > 0 ? 'text-destructive' : 'text-exito',
                          )}
                        >
                          {simulada.diferencia > 0 ? '+' : ''}
                          {pesos(simulada.diferencia)}
                        </p>
                      ) : (
                        <p className="text-muted-foreground text-xs">sin cambio</p>
                      )}
                    </>
                  ) : (
                    <p className="text-muted-foreground tabular text-sm">{pesos(fila.comision)}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <Separador />

        {resultado ? (
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground text-xs">Entró a caja</dt>
              <dd className="tabular font-semibold">{pesos(resultado.totales.ingresos)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Se paga ahora</dt>
              <dd className="tabular font-semibold">{pesos(resultado.totales.comisionActual)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Se pagaría</dt>
              <dd className="tabular font-semibold">{pesos(resultado.totales.comisionSimulada)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Quedaría para el negocio</dt>
              <dd
                className={cn(
                  'tabular font-semibold',
                  resultado.totales.diferencia > 0 ? 'text-destructive' : 'text-exito',
                )}
              >
                {pesos(resultado.totales.paraElNegocioSimulado)}
              </dd>
            </div>
          </dl>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          {resultado ? (
            <Boton
              variante="fantasma"
              tamano="sm"
              onClick={() => {
                const inicial: Record<string, number> = {};
                for (const fila of base) {
                  if (fila.barberoId) inicial[fila.barberoId] = fila.porcentajeEfectivo;
                }
                setPorcentajes(inicial);
                setResultado(null);
              }}
            >
              <RotateCcw />
              Volver a lo real
            </Boton>
          ) : null}
          <Boton cargando={simular.isPending} onClick={() => simular.mutate()}>
            <Calculator />
            Calcular
          </Boton>
        </div>
      </TarjetaContenido>
    </Tarjeta>
  );
}

// ------------------------------------------------------------- auxiliares

function calcularPeriodo(periodo: Periodo): { desde: string; hasta: string } {
  const hoy = new Date();

  switch (periodo) {
    case 'semana':
      return {
        desde: aFechaISO(new Date(Date.now() - 6 * 86_400_000)),
        hasta: aFechaISO(hoy),
      };
    case 'mesPasado': {
      const primero = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
      const ultimo = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
      return { desde: aFechaISO(primero), hasta: aFechaISO(ultimo) };
    }
    case 'anio':
      return { desde: aFechaISO(new Date(hoy.getFullYear(), 0, 1)), hasta: aFechaISO(hoy) };
    case 'mes':
    default:
      return {
        desde: aFechaISO(new Date(hoy.getFullYear(), hoy.getMonth(), 1)),
        hasta: aFechaISO(hoy),
      };
  }
}

function formatearDia(dia: string): string {
  if (!dia) return '';
  return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short' }).format(
    new Date(`${dia}T12:00:00`),
  );
}

/**
 * Exportación para el contador.
 *
 * Se arma en el navegador con los datos que ya devuelve la API, en lugar de
 * añadir un endpoint que genere el archivo: el contador quiere el detalle que
 * ya está en pantalla, y así no hay dos definiciones de «el cierre del mes»
 * que puedan discrepar.
 */
async function exportarCsv(desde: string, hasta: string, sedeId: string) {
  const respuesta = await api.get<{
    datos: {
      numero: string;
      fecha: string;
      total: string;
      descuento: string;
      totalCortesia: string;
      metodoPago: string;
      comisionBarbero: string;
      porcentajeComision: string;
      sede: { nombre: string };
      barbero: { nombre: string; alias: string | null } | null;
      cliente: { nombreCompleto: string } | null;
      items: { tipo: string; nombre: string; cantidad: number; subtotal: string }[];
    }[];
  }>(`/contabilidad/ventas?desde=${desde}&hasta=${hasta}${sedeId ? `&sedeId=${sedeId}` : ''}&limite=1000`);

  const cabecera = [
    'Numero',
    'Fecha',
    'Sede',
    'Barbero',
    'Cliente',
    'Detalle',
    'Descuento',
    'Cortesia',
    'Total',
    'Metodo de pago',
    'Porcentaje comision',
    'Comision',
  ];

  const escapar = (valor: string) => `"${valor.replace(/"/g, '""')}"`;

  const filas = respuesta.datos.map((v) =>
    [
      v.numero,
      new Date(v.fecha).toLocaleString('es-CO'),
      v.sede.nombre,
      v.barbero?.alias ?? v.barbero?.nombre ?? '',
      v.cliente?.nombreCompleto ?? '',
      v.items.map((i) => `${i.cantidad}x ${i.nombre}`).join(' + '),
      v.descuento,
      v.totalCortesia,
      v.total,
      v.metodoPago,
      v.porcentajeComision,
      v.comisionBarbero,
    ]
      .map((c) => escapar(String(c)))
      .join(';'),
  );

  // Punto y coma y BOM: es lo que Excel en español abre bien sin pasos extra.
  const contenido = '﻿' + [cabecera.join(';'), ...filas].join('\r\n');
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(new Blob([contenido], { type: 'text/csv;charset=utf-8;' }));
  enlace.download = `ventas-${desde}-a-${hasta}.csv`;
  enlace.click();
  URL.revokeObjectURL(enlace.href);
}
