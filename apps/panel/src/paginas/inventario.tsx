import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ClipboardCheck,
  Package,
  Plus,
  Search,
  TriangleAlert,
} from 'lucide-react';
import type { PaginaRespuesta } from '@cds/shared';
import { api, ErrorApi } from '@/lib/api';
import { cn, pesos, tiempoRelativo } from '@/lib/utils';
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

interface Sede {
  id: string;
  nombre: string;
}

interface Categoria {
  id: string;
  nombre: string;
}

interface Producto {
  id: string;
  nombre: string;
  marca: string | null;
  sku: string | null;
  costoUnitario: string;
  precioVenta: string;
  unidadMedida: string;
  esVendible: boolean;
  stockMinimo: number;
  activo: boolean;
  stockTotal: number;
  bajoMinimo: boolean;
  valorInventario: number;
  categoria: { id: string; nombre: string } | null;
  stocks: { sedeId: string; cantidad: number; sede: { id: string; nombre: string } }[];
}

interface Movimiento {
  id: string;
  tipo: 'ENTRADA' | 'SALIDA' | 'VENTA' | 'AJUSTE' | 'DEVOLUCION';
  cantidad: number;
  stockResultante: number;
  costoUnitario: string | null;
  total: string | null;
  documento: string | null;
  motivo: string | null;
  fecha: string;
  producto: { id: string; nombre: string; unidadMedida: string };
  sede: { id: string; nombre: string };
  proveedor: { id: string; nombre: string } | null;
  registradoPor: { id: string; nombre: string } | null;
}

const ETIQUETA_TIPO: Record<Movimiento['tipo'], string> = {
  ENTRADA: 'Entrada',
  SALIDA: 'Salida',
  VENTA: 'Venta',
  AJUSTE: 'Ajuste',
  DEVOLUCION: 'Devolución',
};

const VARIANTE_TIPO: Record<Movimiento['tipo'], 'exito' | 'peligro' | 'info' | 'aviso' | 'neutra'> = {
  ENTRADA: 'exito',
  SALIDA: 'peligro',
  VENTA: 'info',
  AJUSTE: 'aviso',
  DEVOLUCION: 'neutra',
};

/**
 * Inventario.
 *
 * Dos vistas: el stock actual (qué hay y dónde) y el libro de movimientos
 * (cómo llegó a ser eso). La segunda es la que importa cuando algo no cuadra,
 * porque ahí está quién registró qué y cuándo.
 */
export function PaginaInventario() {
  const [pestana, setPestana] = React.useState<'stock' | 'movimientos'>('stock');

  return (
    <>
      <Encabezado
        titulo="Inventario"
        descripcion="Qué hay en cada sede y cómo se movió."
      />

      <div className="mb-4 flex gap-1.5">
        <Boton
          variante={pestana === 'stock' ? 'primario' : 'contorno'}
          tamano="sm"
          onClick={() => setPestana('stock')}
        >
          <Package />
          Productos y stock
        </Boton>
        <Boton
          variante={pestana === 'movimientos' ? 'primario' : 'contorno'}
          tamano="sm"
          onClick={() => setPestana('movimientos')}
        >
          <ClipboardCheck />
          Libro de movimientos
        </Boton>
      </div>

      {pestana === 'stock' ? <Stock /> : <Movimientos />}
    </>
  );
}

function Stock() {
  const cliente = useQueryClient();
  const [busqueda, setBusqueda] = React.useState('');
  const [termino, setTermino] = React.useState('');
  const [sedeId, setSedeId] = React.useState('');
  const [soloBajoMinimo, setSoloBajoMinimo] = React.useState(false);
  const [creando, setCreando] = React.useState(false);
  const [movimiento, setMovimiento] = React.useState<{ producto: Producto; tipo: 'ENTRADA' | 'SALIDA' } | null>(null);
  const [conteo, setConteo] = React.useState<Producto | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setTermino(busqueda.trim()), 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  const { data: sedes } = useQuery({
    queryKey: ['sedes', 'activas'],
    queryFn: () => api.get<Sede[]>('/sedes?soloActivas=true'),
  });

  const { data: resumen } = useQuery({
    queryKey: ['inventario', 'resumen', sedeId],
    queryFn: () => api.get<{ totalProductos: number; valorInventario: number; bajoMinimo: { id: string; nombre: string; stock: number }[] }>(
      `/inventario/resumen${sedeId ? `?sedeId=${sedeId}` : ''}`,
    ),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['inventario', 'productos', termino, sedeId, soloBajoMinimo],
    queryFn: () =>
      api.get<PaginaRespuesta<Producto>>(
        `/inventario?limite=100${termino ? `&buscar=${encodeURIComponent(termino)}` : ''}` +
          `${sedeId ? `&sedeId=${sedeId}` : ''}${soloBajoMinimo ? '&soloBajoMinimo=true' : ''}`,
      ),
  });

  function refrescar() {
    void cliente.invalidateQueries({ queryKey: ['inventario'] });
  }

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tarjeta>
          <TarjetaContenido className="p-4 pt-4">
            <p className="text-muted-foreground text-xs font-medium">Productos</p>
            <p className="tabular mt-0.5 text-2xl font-semibold">{resumen?.totalProductos ?? '—'}</p>
          </TarjetaContenido>
        </Tarjeta>
        <Tarjeta>
          <TarjetaContenido className="p-4 pt-4">
            <p className="text-muted-foreground text-xs font-medium">Valor del inventario</p>
            <p className="tabular mt-0.5 text-2xl font-semibold">
              {resumen ? pesos(resumen.valorInventario) : '—'}
            </p>
            <p className="text-muted-foreground text-xs">a precio de costo</p>
          </TarjetaContenido>
        </Tarjeta>
        <Tarjeta className="col-span-2 sm:col-span-1">
          <TarjetaContenido className="p-4 pt-4">
            <p className="text-muted-foreground text-xs font-medium">Hay que reponer</p>
            <p
              className={cn(
                'tabular mt-0.5 text-2xl font-semibold',
                (resumen?.bajoMinimo.length ?? 0) > 0 && 'text-aviso',
              )}
            >
              {resumen?.bajoMinimo.length ?? 0}
            </p>
            {resumen && resumen.bajoMinimo.length > 0 ? (
              <p className="text-muted-foreground truncate text-xs">
                {resumen.bajoMinimo.slice(0, 2).map((p) => p.nombre).join(', ')}
                {resumen.bajoMinimo.length > 2 ? '…' : ''}
              </p>
            ) : null}
          </TarjetaContenido>
        </Tarjeta>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Entrada
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre, marca o código…"
            className="pl-9"
          />
        </div>

        <Selector value={sedeId || 'todas'} onValueChange={(v) => setSedeId(v === 'todas' ? '' : v)}>
          <SelectorDisparador className="w-44">
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

        <Boton
          variante={soloBajoMinimo ? 'primario' : 'contorno'}
          tamano="sm"
          onClick={() => setSoloBajoMinimo((v) => !v)}
        >
          <TriangleAlert />
          Bajo mínimo
        </Boton>

        <Boton onClick={() => setCreando(true)}>
          <Plus />
          Nuevo producto
        </Boton>
      </div>

      <Tarjeta className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Esqueleto key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : data && data.datos.length > 0 ? (
          <ul className="divide-y">
            {data.datos.map((producto) => (
              <li key={producto.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium">{producto.nombre}</p>
                    {producto.bajoMinimo ? (
                      <Insignia variante="aviso">
                        <TriangleAlert className="size-3" />
                        Reponer
                      </Insignia>
                    ) : null}
                    {!producto.esVendible ? (
                      <Insignia variante="contorno">Consumo interno</Insignia>
                    ) : null}
                    {!producto.activo ? <Insignia variante="peligro">Inactivo</Insignia> : null}
                  </div>
                  <p className="text-muted-foreground truncate text-sm">
                    {producto.marca ? `${producto.marca} · ` : ''}
                    {producto.categoria?.nombre ?? 'Sin categoría'}
                    {producto.sku ? ` · ${producto.sku}` : ''}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Costo {pesos(producto.costoUnitario)}
                    {producto.esVendible ? ` · se vende a ${pesos(producto.precioVenta)}` : ''}
                    {producto.stocks.length > 0
                      ? ` · ${producto.stocks.map((s) => `${s.sede.nombre.split('—').pop()?.trim()}: ${s.cantidad}`).join(' · ')}`
                      : ''}
                  </p>
                </div>

                <div className="text-right">
                  <p
                    className={cn(
                      'tabular text-xl font-semibold',
                      producto.bajoMinimo && 'text-aviso',
                    )}
                  >
                    {producto.stockTotal}
                  </p>
                  <p className="text-muted-foreground text-xs">mín. {producto.stockMinimo}</p>
                </div>

                <div className="flex items-center gap-1.5">
                  <Boton
                    variante="contorno"
                    tamano="iconoSm"
                    title="Registrar entrada"
                    onClick={() => setMovimiento({ producto, tipo: 'ENTRADA' })}
                  >
                    <ArrowDownToLine />
                  </Boton>
                  <Boton
                    variante="contorno"
                    tamano="iconoSm"
                    title="Registrar salida"
                    onClick={() => setMovimiento({ producto, tipo: 'SALIDA' })}
                  >
                    <ArrowUpFromLine />
                  </Boton>
                  <Boton
                    variante="fantasma"
                    tamano="iconoSm"
                    title="Conteo físico"
                    onClick={() => setConteo(producto)}
                  >
                    <ClipboardCheck />
                  </Boton>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EstadoVacio
            icono={Package}
            titulo={termino || soloBajoMinimo ? 'Ningún producto coincide' : 'Sin productos'}
            descripcion="Registra lo que compras para la barbería y lo que vendes al cliente: ceras, aceites, lo que sea."
          >
            <Boton onClick={() => setCreando(true)}>
              <Plus />
              Nuevo producto
            </Boton>
          </EstadoVacio>
        )}
      </Tarjeta>

      {creando ? (
        <DialogoProducto
          abierto
          onCambio={(v) => !v && setCreando(false)}
          onGuardado={() => {
            setCreando(false);
            refrescar();
          }}
        />
      ) : null}

      {movimiento ? (
        <DialogoMovimiento
          producto={movimiento.producto}
          tipo={movimiento.tipo}
          sedes={sedes ?? []}
          abierto
          onCambio={(v) => !v && setMovimiento(null)}
          onGuardado={() => {
            setMovimiento(null);
            refrescar();
          }}
        />
      ) : null}

      {conteo ? (
        <DialogoConteo
          producto={conteo}
          sedes={sedes ?? []}
          abierto
          onCambio={(v) => !v && setConteo(null)}
          onGuardado={() => {
            setConteo(null);
            refrescar();
          }}
        />
      ) : null}
    </>
  );
}

function Movimientos() {
  const [sedeId, setSedeId] = React.useState('');
  const [tipo, setTipo] = React.useState('todos');

  const { data: sedes } = useQuery({
    queryKey: ['sedes', 'activas'],
    queryFn: () => api.get<Sede[]>('/sedes?soloActivas=true'),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['inventario', 'movimientos', sedeId, tipo],
    queryFn: () =>
      api.get<PaginaRespuesta<Movimiento>>(
        `/inventario/movimientos?limite=50${sedeId ? `&sedeId=${sedeId}` : ''}${
          tipo !== 'todos' ? `&tipo=${tipo}` : ''
        }`,
      ),
  });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Selector value={sedeId || 'todas'} onValueChange={(v) => setSedeId(v === 'todas' ? '' : v)}>
          <SelectorDisparador className="w-44">
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

        <Selector value={tipo} onValueChange={setTipo}>
          <SelectorDisparador className="w-40">
            <SelectorValor placeholder="Tipo" />
          </SelectorDisparador>
          <SelectorContenido>
            <SelectorOpcion value="todos">Todos</SelectorOpcion>
            {(Object.keys(ETIQUETA_TIPO) as Movimiento['tipo'][]).map((t) => (
              <SelectorOpcion key={t} value={t}>
                {ETIQUETA_TIPO[t]}
              </SelectorOpcion>
            ))}
          </SelectorContenido>
        </Selector>
      </div>

      <Tarjeta className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Esqueleto key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : data && data.datos.length > 0 ? (
          <ul className="divide-y">
            {data.datos.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 p-4">
                <Insignia variante={VARIANTE_TIPO[m.tipo]} className="w-24 shrink-0 justify-center">
                  {ETIQUETA_TIPO[m.tipo]}
                </Insignia>

                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{m.producto.nombre}</p>
                  <p className="text-muted-foreground truncate text-sm">
                    {m.sede.nombre} · queda {m.stockResultante}
                    {m.proveedor ? ` · ${m.proveedor.nombre}` : ''}
                    {m.documento ? ` · ${m.documento}` : ''}
                  </p>
                  {m.motivo ? (
                    <p className="text-muted-foreground truncate text-xs">{m.motivo}</p>
                  ) : null}
                </div>

                <div className="text-right">
                  {/*
                    Un ajuste no suma ni resta: fija el stock al valor contado.
                    Mostrarlo como «+3» diría lo contrario de lo que pasó
                    cuando faltan unidades, así que se muestra el valor al que
                    quedó. El desfase y su dirección están en el motivo.
                  */}
                  <p className="tabular font-semibold">
                    {m.tipo === 'AJUSTE'
                      ? `= ${m.stockResultante}`
                      : `${m.tipo === 'SALIDA' || m.tipo === 'VENTA' ? '−' : '+'}${m.cantidad}`}
                  </p>
                  {m.total ? (
                    <p className="text-muted-foreground tabular text-xs">{pesos(m.total)}</p>
                  ) : null}
                </div>

                <div className="text-muted-foreground w-28 shrink-0 text-right text-xs">
                  <p>{tiempoRelativo(m.fecha)}</p>
                  <p className="truncate">{m.registradoPor?.nombre ?? 'Sistema'}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EstadoVacio
            icono={ClipboardCheck}
            titulo="Sin movimientos"
            descripcion="Cada entrada, salida, venta y ajuste queda aquí. No se edita ninguno: para corregir se registra un conteo físico."
          />
        )}
      </Tarjeta>
    </>
  );
}

function DialogoProducto({
  abierto,
  onCambio,
  onGuardado,
}: {
  abierto: boolean;
  onCambio: (v: boolean) => void;
  onGuardado: () => void;
}) {
  const [nombre, setNombre] = React.useState('');
  const [marca, setMarca] = React.useState('');
  const [categoriaId, setCategoriaId] = React.useState('');
  const [costoUnitario, setCostoUnitario] = React.useState('0');
  const [precioVenta, setPrecioVenta] = React.useState('0');
  const [esVendible, setEsVendible] = React.useState(true);
  const [stockMinimo, setStockMinimo] = React.useState('0');
  const [sku, setSku] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [campos, setCampos] = React.useState<Record<string, string[]>>({});

  const { data: categorias } = useQuery({
    queryKey: ['inventario', 'categorias'],
    queryFn: () => api.get<Categoria[]>('/inventario/categorias'),
    enabled: abierto,
  });

  const guardar = useMutation({
    mutationFn: () =>
      api.post('/inventario', {
        nombre,
        marca: marca || undefined,
        sku: sku || undefined,
        categoriaId: categoriaId || undefined,
        costoUnitario: Number(costoUnitario),
        precioVenta: Number(precioVenta),
        esVendible,
        stockMinimo: Number(stockMinimo),
      }),
    onSuccess: onGuardado,
    onError: (e) => {
      if (e instanceof ErrorApi) {
        setError(e.mensaje);
        setCampos(e.campos ?? {});
      }
    },
  });

  const margen = Number(precioVenta) - Number(costoUnitario);

  return (
    <Dialogo open={abierto} onOpenChange={onCambio}>
      <DialogoContenido>
        <DialogoCabecera>
          <DialogoTitulo>Nuevo producto</DialogoTitulo>
          <DialogoDescripcion>
            El stock se registra después, con una entrada por sede.
          </DialogoDescripcion>
        </DialogoCabecera>

        {error ? (
          <p className="bg-destructive/10 text-destructive border-destructive/25 rounded-md border px-3 py-2 text-sm">
            {error}
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Nombre" requerido error={campos.nombre?.[0]} className="sm:col-span-2">
            <Entrada autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </Campo>
          <Campo etiqueta="Marca">
            <Entrada value={marca} onChange={(e) => setMarca(e.target.value)} />
          </Campo>
          <Campo etiqueta="Código o SKU">
            <Entrada value={sku} onChange={(e) => setSku(e.target.value)} />
          </Campo>
          <Campo etiqueta="Categoría" className="sm:col-span-2">
            <Selector value={categoriaId} onValueChange={setCategoriaId}>
              <SelectorDisparador>
                <SelectorValor placeholder="Sin categoría" />
              </SelectorDisparador>
              <SelectorContenido>
                {(categorias ?? []).map((c) => (
                  <SelectorOpcion key={c.id} value={c.id}>
                    {c.nombre}
                  </SelectorOpcion>
                ))}
              </SelectorContenido>
            </Selector>
          </Campo>
          <Campo etiqueta="Costo de compra" error={campos.costoUnitario?.[0]}>
            <Entrada
              type="number"
              min={0}
              value={costoUnitario}
              onChange={(e) => setCostoUnitario(e.target.value)}
            />
          </Campo>
          <Campo
            etiqueta="Precio de venta"
            error={campos.precioVenta?.[0]}
            ayuda={
              esVendible && margen !== 0
                ? `Margen: ${pesos(margen)} por unidad`
                : undefined
            }
          >
            <Entrada
              type="number"
              min={0}
              value={precioVenta}
              onChange={(e) => setPrecioVenta(e.target.value)}
              disabled={!esVendible}
            />
          </Campo>
          <Campo
            etiqueta="Avisar cuando queden"
            ayuda="Aparecerá como «hay que reponer»."
          >
            <Entrada
              type="number"
              min={0}
              value={stockMinimo}
              onChange={(e) => setStockMinimo(e.target.value)}
            />
          </Campo>
        </div>

        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-foreground mt-0.5"
            checked={esVendible}
            onChange={(e) => setEsVendible(e.target.checked)}
          />
          <span>
            Se vende al cliente
            <span className="text-muted-foreground block text-xs">
              Si no, es de consumo interno (toallas, desinfectante) y no aparece al cobrar.
            </span>
          </span>
        </label>

        <DialogoPie>
          <Boton variante="fantasma" onClick={() => onCambio(false)}>
            Cancelar
          </Boton>
          <Boton cargando={guardar.isPending} disabled={!nombre} onClick={() => guardar.mutate()}>
            Crear producto
          </Boton>
        </DialogoPie>
      </DialogoContenido>
    </Dialogo>
  );
}

function DialogoMovimiento({
  producto,
  tipo,
  sedes,
  abierto,
  onCambio,
  onGuardado,
}: {
  producto: Producto;
  tipo: 'ENTRADA' | 'SALIDA';
  sedes: Sede[];
  abierto: boolean;
  onCambio: (v: boolean) => void;
  onGuardado: () => void;
}) {
  const [sedeId, setSedeId] = React.useState(sedes[0]?.id ?? '');
  const [cantidad, setCantidad] = React.useState('1');
  const [costoUnitario, setCostoUnitario] = React.useState(producto.costoUnitario);
  const [documento, setDocumento] = React.useState('');
  const [motivo, setMotivo] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const esEntrada = tipo === 'ENTRADA';
  const stockEnSede = producto.stocks.find((s) => s.sedeId === sedeId)?.cantidad ?? 0;

  const guardar = useMutation({
    mutationFn: () =>
      api.post('/inventario/movimientos', {
        productoId: producto.id,
        sedeId,
        tipo,
        cantidad: Number(cantidad),
        ...(esEntrada ? { costoUnitario: Number(costoUnitario) } : {}),
        documento: documento || undefined,
        motivo: motivo || undefined,
      }),
    onSuccess: onGuardado,
    onError: (e) => setError(e instanceof ErrorApi ? e.mensaje : 'No se pudo registrar.'),
  });

  return (
    <Dialogo open={abierto} onOpenChange={onCambio}>
      <DialogoContenido>
        <DialogoCabecera>
          <DialogoTitulo>
            {esEntrada ? 'Entrada de' : 'Salida de'} {producto.nombre}
          </DialogoTitulo>
          <DialogoDescripcion>
            {esEntrada
              ? 'Una compra al proveedor. El costo que pongas pasa a ser el de referencia.'
              : 'Consumo interno, merma o producto dañado. Las ventas no se registran aquí.'}
          </DialogoDescripcion>
        </DialogoCabecera>

        {error ? (
          <p className="bg-destructive/10 text-destructive border-destructive/25 rounded-md border px-3 py-2 text-sm">
            {error}
          </p>
        ) : null}

        <Campo etiqueta="Sede" requerido ayuda={`Ahora hay ${stockEnSede} unidades allí.`}>
          <Selector value={sedeId} onValueChange={setSedeId}>
            <SelectorDisparador>
              <SelectorValor placeholder="Elige la sede" />
            </SelectorDisparador>
            <SelectorContenido>
              {sedes.map((s) => (
                <SelectorOpcion key={s.id} value={s.id}>
                  {s.nombre}
                </SelectorOpcion>
              ))}
            </SelectorContenido>
          </Selector>
        </Campo>

        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Cantidad" requerido>
            <Entrada
              type="number"
              min={1}
              autoFocus
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
            />
          </Campo>

          {esEntrada ? (
            <Campo etiqueta="Costo por unidad">
              <Entrada
                type="number"
                min={0}
                value={costoUnitario}
                onChange={(e) => setCostoUnitario(e.target.value)}
              />
            </Campo>
          ) : null}
        </div>

        {esEntrada ? (
          <Campo etiqueta="Factura o remisión">
            <Entrada
              value={documento}
              onChange={(e) => setDocumento(e.target.value)}
              placeholder="N.º de factura del proveedor"
            />
          </Campo>
        ) : null}

        <Campo etiqueta="Motivo" ayuda="Lo verá el contador al revisar.">
          <AreaTexto rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </Campo>

        <div className="bg-muted/50 rounded-md border px-3 py-2 text-sm">
          Quedarán{' '}
          <strong className="tabular">
            {esEntrada ? stockEnSede + Number(cantidad || 0) : stockEnSede - Number(cantidad || 0)}
          </strong>{' '}
          unidades en esa sede.
        </div>

        <DialogoPie>
          <Boton variante="fantasma" onClick={() => onCambio(false)}>
            Cancelar
          </Boton>
          <Boton
            cargando={guardar.isPending}
            disabled={!sedeId || Number(cantidad) < 1}
            onClick={() => guardar.mutate()}
          >
            Registrar {esEntrada ? 'entrada' : 'salida'}
          </Boton>
        </DialogoPie>
      </DialogoContenido>
    </Dialogo>
  );
}

function DialogoConteo({
  producto,
  sedes,
  abierto,
  onCambio,
  onGuardado,
}: {
  producto: Producto;
  sedes: Sede[];
  abierto: boolean;
  onCambio: (v: boolean) => void;
  onGuardado: () => void;
}) {
  const [sedeId, setSedeId] = React.useState(sedes[0]?.id ?? '');
  const [contada, setContada] = React.useState('');
  const [motivo, setMotivo] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const stockSistema = producto.stocks.find((s) => s.sedeId === sedeId)?.cantidad ?? 0;
  const diferencia = contada === '' ? null : Number(contada) - stockSistema;

  const guardar = useMutation({
    mutationFn: () =>
      api.post('/inventario/conteo', {
        productoId: producto.id,
        sedeId,
        cantidadContada: Number(contada),
        motivo: motivo || undefined,
      }),
    onSuccess: onGuardado,
    onError: (e) => setError(e instanceof ErrorApi ? e.mensaje : 'No se pudo ajustar.'),
  });

  return (
    <Dialogo open={abierto} onOpenChange={onCambio}>
      <DialogoContenido>
        <DialogoCabecera>
          <DialogoTitulo>Conteo físico de {producto.nombre}</DialogoTitulo>
          <DialogoDescripcion>
            Cuenta lo que hay en el estante y escríbelo. El sistema calcula el desfase y lo deja
            registrado.
          </DialogoDescripcion>
        </DialogoCabecera>

        {error ? (
          <p className="bg-destructive/10 text-destructive border-destructive/25 rounded-md border px-3 py-2 text-sm">
            {error}
          </p>
        ) : null}

        <Campo etiqueta="Sede" requerido>
          <Selector value={sedeId} onValueChange={setSedeId}>
            <SelectorDisparador>
              <SelectorValor placeholder="Elige la sede" />
            </SelectorDisparador>
            <SelectorContenido>
              {sedes.map((s) => (
                <SelectorOpcion key={s.id} value={s.id}>
                  {s.nombre}
                </SelectorOpcion>
              ))}
            </SelectorContenido>
          </Selector>
        </Campo>

        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Según el sistema">
            <Entrada value={stockSistema} disabled className="tabular" />
          </Campo>
          <Campo etiqueta="Contadas en el estante" requerido>
            <Entrada
              type="number"
              min={0}
              autoFocus
              value={contada}
              onChange={(e) => setContada(e.target.value)}
              className="tabular"
            />
          </Campo>
        </div>

        {diferencia !== null && diferencia !== 0 ? (
          <div
            className={cn(
              'rounded-md border px-3 py-2 text-sm',
              diferencia < 0 ? 'bg-destructive/10 border-destructive/25' : 'bg-aviso/10 border-aviso/30',
            )}
          >
            {diferencia < 0 ? (
              <>
                Faltan <strong className="tabular">{Math.abs(diferencia)}</strong> unidades. Puede
                ser una merma, un robo o una venta que no se registró.
              </>
            ) : (
              <>
                Sobran <strong className="tabular">{diferencia}</strong> unidades. Probablemente una
                entrada que no se registró.
              </>
            )}
          </div>
        ) : null}

        <Campo etiqueta="Observación" ayuda="Qué crees que pasó.">
          <AreaTexto rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </Campo>

        <DialogoPie>
          <Boton variante="fantasma" onClick={() => onCambio(false)}>
            Cancelar
          </Boton>
          <Boton
            cargando={guardar.isPending}
            disabled={contada === '' || diferencia === 0}
            onClick={() => guardar.mutate()}
          >
            <ClipboardCheck />
            Registrar conteo
          </Boton>
        </DialogoPie>
      </DialogoContenido>
    </Dialogo>
  );
}
