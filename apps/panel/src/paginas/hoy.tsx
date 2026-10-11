import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  BadgeCheck,
  CalendarDays,
  CircleDollarSign,
  Clock,
  Gift,
  Play,
  Plus,
  UserX,
  Users,
  Zap,
} from 'lucide-react';
import { ETIQUETAS_ESTADO, type EstadoReserva } from '@cds/shared';
import { api } from '@/lib/api';
import { cn, fechaLarga, hora, pesos } from '@/lib/utils';
import { useSesion } from '@/hooks/sesion';
import { Encabezado } from '@/componentes/armazon';
import { Boton } from '@/componentes/ui/boton';
import { Tarjeta, TarjetaContenido } from '@/componentes/ui/tarjeta';
import {
  Avatar,
  Esqueleto,
  EstadoVacio,
  Insignia,
  VARIANTE_POR_ESTADO,
} from '@/componentes/ui/varios';
import { DialogoNuevaReserva } from '@/componentes/dialogo-nueva-reserva';
import { DialogoCobrar } from '@/componentes/dialogo-cobrar';

interface ReservaAgenda {
  id: string;
  codigo: string;
  estado: EstadoReserva;
  canal: 'PANEL' | 'WEB' | 'WALK_IN';
  inicioEn: string;
  finEn: string;
  total: string;
  turnoWalkIn: number | null;
  notaCliente: string | null;
  cliente: { id: string; nombreCompleto: string; telefono: string; esGenerico: boolean } | null;
  barbero: { id: string; nombre: string; alias: string | null; fotoUrl: string | null };
  sede: { id: string; nombre: string };
  servicios: { nombreSnapshot: string; precioSnapshot: string }[];
  canje: { id: string } | null;
}

interface RespuestaAgenda {
  fecha: string;
  reservas: ReservaAgenda[];
  resumen: {
    total: number;
    pendientes: number;
    confirmadas: number;
    enCurso: number;
    completadas: number;
    noAsistio: number;
    walkIns: number;
    ingresos: number;
  };
}

/**
 * La pantalla de "Hoy".
 *
 * Es la primera que se abre por la mañana y la que queda abierta todo el día,
 * así que está pensada para leerse de un vistazo desde un metro de distancia:
 * la hora grande a la izquierda, el estado por color, y la acción que toca
 * ahora mismo (empezar, cobrar) a mano derecha. Un barbero con las manos
 * ocupadas no va a navegar tres niveles para marcar que empezó un corte.
 */
export function PaginaHoy() {
  const { usuario, puede } = useSesion();
  const cliente = useQueryClient();
  const [nuevaAbierta, setNuevaAbierta] = React.useState(false);
  const [walkInAbierta, setWalkInAbierta] = React.useState(false);
  const [aCobrar, setACobrar] = React.useState<ReservaAgenda | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['agenda-del-dia'],
    queryFn: () => api.get<RespuestaAgenda>('/reservas/agenda-del-dia'),
    // La agenda cambia mientras el panel está abierto (la web del cliente crea
    // reservas), así que se refresca sola cada minuto.
    refetchInterval: 60_000,
  });

  const cambiarEstado = useMutation({
    mutationFn: ({ id, accion }: { id: string; accion: 'iniciar' | 'no-asistio' }) =>
      api.patch(`/reservas/${id}/${accion}`),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['agenda-del-dia'] }),
  });

  const resumen = data?.resumen;

  return (
    <>
      <Encabezado
        titulo="Hoy"
        descripcion={data ? capitalizar(fechaLarga(`${data.fecha}T12:00:00`)) : 'Cargando…'}
      >
        {puede('reservas:crear') ? (
          <>
            <Boton variante="contorno" onClick={() => setWalkInAbierta(true)}>
              <Zap />
              Llegó sin cita
            </Boton>
            <Boton onClick={() => setNuevaAbierta(true)}>
              <Plus />
              Nueva reserva
            </Boton>
          </>
        ) : null}
      </Encabezado>

      {/* Resumen del día */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metrica
          icono={CalendarDays}
          etiqueta="Citas hoy"
          valor={isLoading ? null : String(resumen?.total ?? 0)}
          detalle={resumen ? `${resumen.walkIns} sin cita` : undefined}
        />
        <Metrica
          icono={Clock}
          etiqueta="Por atender"
          valor={isLoading ? null : String((resumen?.confirmadas ?? 0) + (resumen?.pendientes ?? 0))}
          detalle={resumen?.enCurso ? `${resumen.enCurso} en curso` : undefined}
        />
        <Metrica
          icono={BadgeCheck}
          etiqueta="Atendidas"
          valor={isLoading ? null : String(resumen?.completadas ?? 0)}
          detalle={resumen?.noAsistio ? `${resumen.noAsistio} no vinieron` : undefined}
        />
        <Metrica
          icono={CircleDollarSign}
          etiqueta="Cobrado"
          valor={isLoading ? null : pesos(resumen?.ingresos ?? 0)}
          destacado
        />
      </div>

      {/* Lista de citas */}
      <Tarjeta>
        {isLoading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2].map((i) => (
              <Esqueleto key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : data && data.reservas.length > 0 ? (
          <ul className="divide-y">
            {data.reservas.map((reserva) => (
              <FilaCita
                key={reserva.id}
                reserva={reserva}
                mostrarBarbero={puede('reservas:ver_todas')}
                onIniciar={() => cambiarEstado.mutate({ id: reserva.id, accion: 'iniciar' })}
                onNoAsistio={() => cambiarEstado.mutate({ id: reserva.id, accion: 'no-asistio' })}
                onCobrar={() => setACobrar(reserva)}
                ocupado={cambiarEstado.isPending}
              />
            ))}
          </ul>
        ) : (
          <EstadoVacio
            icono={CalendarDays}
            titulo="No hay citas para hoy"
            descripcion={
              usuario?.rol === 'BARBERO'
                ? 'Cuando te asignen una cita aparecerá aquí. Si llega alguien sin reserva, puedes registrarlo con “Llegó sin cita”.'
                : 'Registra la primera reserva del día o espera a que los clientes reserven desde la web.'
            }
          >
            {puede('reservas:crear') ? (
              <Boton onClick={() => setNuevaAbierta(true)}>
                <Plus />
                Nueva reserva
              </Boton>
            ) : null}
          </EstadoVacio>
        )}
      </Tarjeta>

      <DialogoNuevaReserva
        abierto={nuevaAbierta}
        onCambio={setNuevaAbierta}
        onGuardado={() => void cliente.invalidateQueries({ queryKey: ['agenda-del-dia'] })}
      />
      <DialogoNuevaReserva
        modo="walk-in"
        abierto={walkInAbierta}
        onCambio={setWalkInAbierta}
        onGuardado={() => void cliente.invalidateQueries({ queryKey: ['agenda-del-dia'] })}
      />
      {aCobrar ? (
        <DialogoCobrar
          reserva={aCobrar}
          abierto={Boolean(aCobrar)}
          onCambio={(abierto) => !abierto && setACobrar(null)}
          onCobrado={() => {
            setACobrar(null);
            void cliente.invalidateQueries({ queryKey: ['agenda-del-dia'] });
          }}
        />
      ) : null}
    </>
  );
}

function FilaCita({
  reserva,
  mostrarBarbero,
  onIniciar,
  onNoAsistio,
  onCobrar,
  ocupado,
}: {
  reserva: ReservaAgenda;
  mostrarBarbero: boolean;
  onIniciar: () => void;
  onNoAsistio: () => void;
  onCobrar: () => void;
  ocupado: boolean;
}) {
  const cerrada = ['COMPLETADA', 'CANCELADA', 'NO_ASISTIO'].includes(reserva.estado);

  return (
    <li className={cn('flex flex-wrap items-center gap-4 p-4', cerrada && 'opacity-60')}>
      {/* Hora, grande y legible de lejos */}
      <div className="w-16 shrink-0 text-center">
        <p className="tabular text-xl leading-none font-semibold">{hora(reserva.inicioEn)}</p>
        <p className="text-muted-foreground tabular mt-1 text-xs">{hora(reserva.finEn)}</p>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-medium">
            {reserva.cliente?.esGenerico
              ? 'Cliente sin registrar'
              : (reserva.cliente?.nombreCompleto ?? 'Sin ficha')}
          </p>

          <Insignia variante={VARIANTE_POR_ESTADO[reserva.estado]}>
            {ETIQUETAS_ESTADO[reserva.estado]}
          </Insignia>

          {reserva.canal === 'WALK_IN' ? (
            <Insignia variante="contorno">
              <Zap className="size-3" />
              Turno {reserva.turnoWalkIn}
            </Insignia>
          ) : null}

          {reserva.canal === 'WEB' ? <Insignia variante="contorno">Web</Insignia> : null}

          {reserva.canje ? (
            <Insignia variante="primaria">
              <Gift className="size-3" />
              Premio
            </Insignia>
          ) : null}
        </div>

        <p className="text-muted-foreground mt-0.5 truncate text-sm">
          {reserva.servicios.map((s) => s.nombreSnapshot).join(' + ')}
          {' · '}
          <span className="tabular">{pesos(reserva.total)}</span>
          {mostrarBarbero ? ` · ${reserva.barbero.alias ?? reserva.barbero.nombre}` : ''}
        </p>

        {reserva.notaCliente ? (
          <p className="text-muted-foreground mt-1 truncate text-xs italic">
            “{reserva.notaCliente}”
          </p>
        ) : null}
      </div>

      {mostrarBarbero ? (
        <Avatar
          nombre={reserva.barbero.nombre}
          url={reserva.barbero.fotoUrl}
          className="hidden sm:flex"
        />
      ) : null}

      {/* La acción que toca ahora, sin menús intermedios */}
      <div className="flex items-center gap-1.5">
        {reserva.estado === 'CONFIRMADA' || reserva.estado === 'PENDIENTE' ? (
          <>
            <Boton variante="contorno" tamano="sm" onClick={onIniciar} disabled={ocupado}>
              <Play />
              Empezar
            </Boton>
            <Boton
              variante="fantasma"
              tamano="iconoSm"
              title="No vino"
              onClick={onNoAsistio}
              disabled={ocupado}
            >
              <UserX />
            </Boton>
          </>
        ) : null}

        {reserva.estado === 'EN_CURSO' ? (
          <Boton tamano="sm" onClick={onCobrar}>
            <CircleDollarSign />
            Cobrar
          </Boton>
        ) : null}

        {reserva.estado === 'CONFIRMADA' ? (
          <Boton variante="fantasma" tamano="sm" onClick={onCobrar} title="Cobrar directamente">
            Cobrar
          </Boton>
        ) : null}

        {reserva.cliente && !reserva.cliente.esGenerico ? (
          <Boton variante="fantasma" tamano="iconoSm" comoHijo title="Ver ficha del cliente">
            <Link to={`/clientes/${reserva.cliente.id}`}>
              <Users />
            </Link>
          </Boton>
        ) : null}
      </div>
    </li>
  );
}

function Metrica({
  icono: Icono,
  etiqueta,
  valor,
  detalle,
  destacado,
}: {
  icono: React.ComponentType<{ className?: string }>;
  etiqueta: string;
  valor: string | null;
  detalle?: string;
  destacado?: boolean;
}) {
  return (
    <Tarjeta>
      <TarjetaContenido className="p-4 pt-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-muted-foreground truncate text-xs font-medium">{etiqueta}</p>
            {valor === null ? (
              <Esqueleto className="mt-1.5 h-7 w-16" />
            ) : (
              <p
                className={cn(
                  'tabular mt-0.5 truncate text-2xl font-semibold',
                  destacado && 'text-primary',
                )}
              >
                {valor}
              </p>
            )}
            {detalle ? <p className="text-muted-foreground mt-0.5 truncate text-xs">{detalle}</p> : null}
          </div>
          <Icono className={cn('size-4 shrink-0', destacado ? 'text-primary' : 'text-muted-foreground')} />
        </div>
      </TarjetaContenido>
    </Tarjeta>
  );
}

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
