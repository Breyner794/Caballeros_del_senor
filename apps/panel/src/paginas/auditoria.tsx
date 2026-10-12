import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bug,
  ChevronLeft,
  ChevronRight,
  Check,
  Search,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import type { PaginaRespuesta } from '@cds/shared';
import { api } from '@/lib/api';
import { aFechaISO, cn, tiempoRelativo } from '@/lib/utils';
import { Encabezado } from '@/componentes/armazon';
import { Boton } from '@/componentes/ui/boton';
import { AreaTexto, Campo, Entrada } from '@/componentes/ui/campo';
import { Tarjeta, TarjetaContenido } from '@/componentes/ui/tarjeta';
import {
  Dialogo,
  DialogoCabecera,
  DialogoContenido,
  DialogoDescripcion,
  DialogoPie,
  DialogoTitulo,
  Esqueleto,
  EstadoVacio,
  Insignia,
  Selector,
  SelectorContenido,
  SelectorDisparador,
  SelectorOpcion,
  SelectorValor,
} from '@/componentes/ui/varios';

interface Entrada_ {
  id: string;
  accion: string;
  entidad: string;
  entidadId: string | null;
  usuarioNombre: string | null;
  usuarioRol: string | null;
  resumen: string | null;
  antes: unknown;
  despues: unknown;
  ip: string | null;
  creadoEn: string;
}

interface ErrorRegistrado {
  id: string;
  nivel: 'WARN' | 'ERROR' | 'FATAL';
  codigo: string;
  mensaje: string;
  ocurrencias: number;
  origen: string | null;
  ruta: string | null;
  metodo: string | null;
  statusHttp: number | null;
  primeraVezEn: string;
  ultimaVezEn: string;
  resueltoEn: string | null;
  notas: string | null;
  usuario: { id: string; nombre: string } | null;
}

const ETIQUETAS_ACCION: Record<string, string> = {
  CREAR: 'Creó',
  ACTUALIZAR: 'Editó',
  ELIMINAR: 'Eliminó',
  INICIAR_SESION: 'Inició sesión',
  CERRAR_SESION: 'Cerró sesión',
  INICIO_SESION_FALLIDO: 'Intento fallido',
  CAMBIAR_PASSWORD: 'Cambió contraseña',
  RESTABLECER_PASSWORD: 'Restableció contraseña',
  CANJEAR_FIDELIDAD: 'Entregó premio',
  CANCELAR_RESERVA: 'Canceló cita',
  REPROGRAMAR_RESERVA: 'Movió cita',
  COMPLETAR_RESERVA: 'Cobró cita',
  ANULAR_VENTA: 'Anuló venta',
  AJUSTAR_INVENTARIO: 'Ajustó inventario',
  EXPORTAR_DATOS: 'Exportó datos',
};

/** Las acciones que conviene poder mirar aparte. */
const ACCIONES_DESTACADAS = [
  'CANJEAR_FIDELIDAD',
  'CANCELAR_RESERVA',
  'REPROGRAMAR_RESERVA',
  'COMPLETAR_RESERVA',
  'INICIO_SESION_FALLIDO',
  'ELIMINAR',
];

/**
 * Auditoría y errores.
 *
 * Son dos preguntas distintas y por eso van en pestañas: «¿quién hizo esto?»
 * y «¿qué se está rompiendo?».
 *
 * La de auditoría se busca por texto porque los resúmenes están escritos en
 * lenguaje natural: se puede teclear el nombre de un cliente o un código de
 * reserva y encontrar todo lo que pasó con él. Es lo que resuelve un «el
 * cliente dice que vino ocho veces» o un «yo no cancelé esa cita».
 */
export function PaginaAuditoria() {
  const [pestana, setPestana] = React.useState<'auditoria' | 'errores'>('auditoria');

  return (
    <>
      <Encabezado
        titulo="Auditoría"
        descripcion="Quién hizo qué y qué se está rompiendo. Solo lectura."
      />

      <div className="mb-4 flex gap-1.5">
        <Boton
          variante={pestana === 'auditoria' ? 'primario' : 'contorno'}
          tamano="sm"
          onClick={() => setPestana('auditoria')}
        >
          <ShieldCheck />
          Registro de actividad
        </Boton>
        <Boton
          variante={pestana === 'errores' ? 'primario' : 'contorno'}
          tamano="sm"
          onClick={() => setPestana('errores')}
        >
          <Bug />
          Errores
        </Boton>
      </div>

      {pestana === 'auditoria' ? <Actividad /> : <Errores />}
    </>
  );
}

function Actividad() {
  const [pagina, setPagina] = React.useState(1);
  const [busqueda, setBusqueda] = React.useState('');
  const [termino, setTermino] = React.useState('');
  const [accion, setAccion] = React.useState('todas');
  const [desde, setDesde] = React.useState('');
  const [detalle, setDetalle] = React.useState<Entrada_ | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => {
      setTermino(busqueda.trim());
      setPagina(1);
    }, 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  const consulta = new URLSearchParams({ pagina: String(pagina), limite: '30' });
  if (termino) consulta.set('buscar', termino);
  if (accion !== 'todas') consulta.set('accion', accion);
  if (desde) consulta.set('desde', desde);

  const { data, isLoading } = useQuery({
    queryKey: ['auditoria', consulta.toString()],
    queryFn: () => api.get<PaginaRespuesta<Entrada_>>(`/auditoria?${consulta.toString()}`),
  });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Entrada
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Nombre de un cliente, código de reserva, quien lo hizo…"
            className="pl-9"
          />
        </div>

        <Selector
          value={accion}
          onValueChange={(v) => {
            setAccion(v);
            setPagina(1);
          }}
        >
          <SelectorDisparador className="w-52">
            <SelectorValor placeholder="Acción" />
          </SelectorDisparador>
          <SelectorContenido>
            <SelectorOpcion value="todas">Cualquier acción</SelectorOpcion>
            {ACCIONES_DESTACADAS.map((a) => (
              <SelectorOpcion key={a} value={a}>
                {ETIQUETAS_ACCION[a] ?? a}
              </SelectorOpcion>
            ))}
          </SelectorContenido>
        </Selector>

        <Entrada
          type="date"
          className="w-auto"
          value={desde}
          max={aFechaISO(new Date())}
          onChange={(e) => {
            setDesde(e.target.value);
            setPagina(1);
          }}
          title="Desde esta fecha"
        />
      </div>

      <Tarjeta className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <Esqueleto key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : data && data.datos.length > 0 ? (
          <>
            <ul className="divide-y">
              {data.datos.map((entrada) => (
                <li key={entrada.id}>
                  <button
                    type="button"
                    className="hover:bg-accent/40 flex w-full items-start gap-3 p-3 text-left transition-colors"
                    onClick={() => setDetalle(entrada)}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">
                        {entrada.resumen ?? `${ETIQUETAS_ACCION[entrada.accion] ?? entrada.accion} ${entrada.entidad}`}
                      </p>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        {entrada.usuarioNombre ?? 'Sistema'}
                        {entrada.usuarioRol ? ` · ${entrada.usuarioRol.toLowerCase()}` : ''} ·{' '}
                        {tiempoRelativo(entrada.creadoEn)}
                        {entrada.ip ? ` · ${entrada.ip}` : ''}
                      </p>
                    </div>
                    <Insignia variante="contorno" className="shrink-0">
                      {entrada.entidad}
                    </Insignia>
                  </button>
                </li>
              ))}
            </ul>

            <div className="text-muted-foreground flex items-center justify-between gap-2 border-t px-4 py-3 text-xs">
              <span>
                {data.meta.total} {data.meta.total === 1 ? 'registro' : 'registros'}
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
            icono={ShieldCheck}
            titulo="Sin registros"
            descripcion="Aquí aparece todo lo que se hace en el panel: quién cobró una cita, quién entregó un premio, quién canceló."
          />
        )}
      </Tarjeta>

      <Dialogo open={detalle !== null} onOpenChange={(v) => !v && setDetalle(null)}>
        <DialogoContenido anchoMaximo="max-w-xl">
          <DialogoCabecera>
            <DialogoTitulo>{ETIQUETAS_ACCION[detalle?.accion ?? ''] ?? detalle?.accion}</DialogoTitulo>
            <DialogoDescripcion>{detalle?.resumen}</DialogoDescripcion>
          </DialogoCabecera>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Quién</dt>
            <dd>
              {detalle?.usuarioNombre ?? 'Sistema'}
              {detalle?.usuarioRol ? ` (${detalle.usuarioRol.toLowerCase()})` : ''}
            </dd>
            <dt className="text-muted-foreground">Cuándo</dt>
            <dd className="tabular">
              {detalle ? new Date(detalle.creadoEn).toLocaleString('es-CO') : ''}
            </dd>
            <dt className="text-muted-foreground">Sobre</dt>
            <dd>
              {detalle?.entidad}
              {detalle?.entidadId ? ` · ${detalle.entidadId}` : ''}
            </dd>
            {detalle?.ip ? (
              <>
                <dt className="text-muted-foreground">Desde</dt>
                <dd className="tabular">{detalle.ip}</dd>
              </>
            ) : null}
          </dl>

          {/* Solo se guardan los campos que cambiaron, así que esto se lee */}
          {detalle?.despues ? (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Qué cambió</p>
              <div className="bg-muted/50 overflow-x-auto rounded-md border p-3">
                <pre className="text-xs whitespace-pre-wrap">
                  {JSON.stringify({ antes: detalle.antes, después: detalle.despues }, null, 2)}
                </pre>
              </div>
            </div>
          ) : null}

          <DialogoPie>
            <Boton onClick={() => setDetalle(null)}>Cerrar</Boton>
          </DialogoPie>
        </DialogoContenido>
      </Dialogo>
    </>
  );
}

function Errores() {
  const cliente = useQueryClient();
  const [pagina, setPagina] = React.useState(1);
  const [soloPendientes, setSoloPendientes] = React.useState(true);
  const [detalle, setDetalle] = React.useState<ErrorRegistrado | null>(null);
  const [notas, setNotas] = React.useState('');

  const { data: resumen } = useQuery({
    queryKey: ['errores', 'resumen'],
    queryFn: () =>
      api.get<{
        sinResolver: number;
        ultimas24h: number;
        masFrecuente: { codigo: string; ocurrencias: number; ruta: string | null } | null;
      }>('/errores/resumen'),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['errores', pagina, soloPendientes],
    queryFn: () =>
      api.get<PaginaRespuesta<ErrorRegistrado>>(
        `/errores?pagina=${pagina}&limite=25${soloPendientes ? '&resueltos=false' : ''}`,
      ),
  });

  const marcar = useMutation({
    mutationFn: ({ id, resuelto }: { id: string; resuelto: boolean }) =>
      api.patch(`/errores/${id}/resuelto`, { resuelto, notas: notas || undefined }),
    onSuccess: () => {
      setDetalle(null);
      setNotas('');
      void cliente.invalidateQueries({ queryKey: ['errores'] });
    },
  });

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tarjeta>
          <TarjetaContenido className="p-4 pt-4">
            <p className="text-muted-foreground text-xs font-medium">Sin resolver</p>
            <p
              className={cn(
                'tabular mt-0.5 text-2xl font-semibold',
                (resumen?.sinResolver ?? 0) > 0 && 'text-destructive',
              )}
            >
              {resumen?.sinResolver ?? 0}
            </p>
          </TarjetaContenido>
        </Tarjeta>
        <Tarjeta>
          <TarjetaContenido className="p-4 pt-4">
            <p className="text-muted-foreground text-xs font-medium">En las últimas 24 h</p>
            <p className="tabular mt-0.5 text-2xl font-semibold">{resumen?.ultimas24h ?? 0}</p>
          </TarjetaContenido>
        </Tarjeta>
        <Tarjeta className="col-span-2 sm:col-span-1">
          <TarjetaContenido className="p-4 pt-4">
            <p className="text-muted-foreground text-xs font-medium">El más repetido</p>
            {resumen?.masFrecuente ? (
              <>
                <p className="mt-0.5 truncate font-medium">{resumen.masFrecuente.codigo}</p>
                <p className="text-muted-foreground tabular text-xs">
                  {resumen.masFrecuente.ocurrencias} veces
                </p>
              </>
            ) : (
              <p className="text-muted-foreground mt-1 text-sm">Ninguno</p>
            )}
          </TarjetaContenido>
        </Tarjeta>
      </div>

      <div className="mb-3 flex gap-1.5">
        <Boton
          variante={soloPendientes ? 'secundario' : 'fantasma'}
          tamano="sm"
          onClick={() => {
            setSoloPendientes(true);
            setPagina(1);
          }}
        >
          Pendientes
        </Boton>
        <Boton
          variante={!soloPendientes ? 'secundario' : 'fantasma'}
          tamano="sm"
          onClick={() => {
            setSoloPendientes(false);
            setPagina(1);
          }}
        >
          Todos
        </Boton>
      </div>

      <Tarjeta className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <Esqueleto key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : data && data.datos.length > 0 ? (
          <ul className="divide-y">
            {data.datos.map((error) => (
              <li key={error.id}>
                <button
                  type="button"
                  className="hover:bg-accent/40 flex w-full items-start gap-3 p-4 text-left transition-colors"
                  onClick={() => {
                    setDetalle(error);
                    setNotas(error.notas ?? '');
                  }}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full',
                      error.resueltoEn
                        ? 'bg-exito/10 text-exito'
                        : error.nivel === 'FATAL'
                          ? 'bg-destructive/10 text-destructive'
                          : 'bg-aviso/10 text-aviso',
                    )}
                  >
                    {error.resueltoEn ? (
                      <Check className="size-4" />
                    ) : (
                      <TriangleAlert className="size-4" />
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium">{error.codigo}</p>
                      {error.ocurrencias > 1 ? (
                        <Insignia variante="contorno">{error.ocurrencias} veces</Insignia>
                      ) : null}
                      {error.resueltoEn ? <Insignia variante="exito">Resuelto</Insignia> : null}
                    </div>
                    <p className="text-muted-foreground mt-0.5 line-clamp-2 text-sm">
                      {error.mensaje}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {error.metodo} {error.ruta} · última vez {tiempoRelativo(error.ultimaVezEn)}
                      {error.usuario ? ` · ${error.usuario.nombre}` : ''}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EstadoVacio
            icono={Bug}
            titulo={soloPendientes ? 'Ningún error pendiente' : 'Sin errores registrados'}
            descripcion="Los fallos inesperados se guardan aquí agrupados, con su traza y el usuario que los provocó."
          />
        )}
      </Tarjeta>

      <Dialogo open={detalle !== null} onOpenChange={(v) => !v && setDetalle(null)}>
        <DialogoContenido anchoMaximo="max-w-2xl">
          <DialogoCabecera>
            <DialogoTitulo>{detalle?.codigo}</DialogoTitulo>
            <DialogoDescripcion>
              {detalle?.ocurrencias} {detalle?.ocurrencias === 1 ? 'vez' : 'veces'} · desde{' '}
              {detalle ? tiempoRelativo(detalle.primeraVezEn) : ''}
            </DialogoDescripcion>
          </DialogoCabecera>

          <div className="bg-muted/50 overflow-x-auto rounded-md border p-3">
            <pre className="text-xs whitespace-pre-wrap">{detalle?.mensaje}</pre>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Ruta</dt>
            <dd className="tabular truncate">
              {detalle?.metodo} {detalle?.ruta ?? '—'}
            </dd>
            <dt className="text-muted-foreground">Respuesta</dt>
            <dd className="tabular">{detalle?.statusHttp ?? '—'}</dd>
            <dt className="text-muted-foreground">Usuario</dt>
            <dd>{detalle?.usuario?.nombre ?? 'Sin sesión'}</dd>
          </dl>

          <Campo etiqueta="Notas" ayuda="Qué se hizo para arreglarlo.">
            <AreaTexto rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} />
          </Campo>

          <DialogoPie>
            <Boton variante="fantasma" onClick={() => setDetalle(null)}>
              Cerrar
            </Boton>
            <Boton
              cargando={marcar.isPending}
              onClick={() =>
                detalle && marcar.mutate({ id: detalle.id, resuelto: !detalle.resueltoEn })
              }
            >
              {detalle?.resueltoEn ? 'Reabrir' : 'Marcar como resuelto'}
            </Boton>
          </DialogoPie>
        </DialogoContenido>
      </Dialogo>
    </>
  );
}
