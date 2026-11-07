import { useState } from 'react';
import { ETIQUETAS_ESTADO, type EstadoReserva } from '@cds/shared';
import { Boton, claseBoton } from '@/componentes/ui/boton';
import { descargarIcs } from '@/lib/ics';
import { etiquetaFechaHora, formatearPrecio } from '@/lib/formato';
import type { ReservaCreada } from './paso-datos';

interface Props {
  reserva: ReservaCreada;
  zonaHoraria: string;
  moneda: string;
}

/** El enlace de gestión lleva el token en el fragmento: el fragmento no viaja al servidor ni a los registros. */
export function enlaceDeGestion(tokenGestion: string): string {
  return `${window.location.origin}/cita#${tokenGestion}`;
}

type EstadoCopia = 'inicial' | 'copiado' | 'fallo';

/**
 * Qué se le dice al cliente según el estado REAL de la cita que devolvió la API.
 *
 * El canal público nunca confirma una cita: pasa `confirmar: false` al dominio
 * a propósito, para que la aprobación siga siendo de recepción. Si el dueño
 * activa `requiereConfirmacion` en el panel —un interruptor, no un despliegue—,
 * el dominio crea la cita `PENDIENTE`, y una pantalla que dijera «confirmada»
 * con texto fijo estaría mintiéndole al cliente. El tono es el del correo
 * («Recibimos tu cita»), que sí está redactado para los dos casos.
 */
function textoDelEstado(estado: EstadoReserva): { titulo: string; detalle: string | null } {
  switch (estado) {
    case 'CONFIRMADA':
      return { titulo: 'Tu cita está confirmada', detalle: null };
    case 'PENDIENTE':
      return {
        titulo: 'Recibimos tu cita',
        detalle: 'Te avisamos en cuanto la barbería la confirme.',
      };
    default:
      // Ningún otro estado nace al reservar; si alguno llegara, se dice el
      // estado tal cual en vez de inventarle una frase tranquilizadora.
      return { titulo: `Tu cita quedó registrada`, detalle: `Estado: ${ETIQUETAS_ESTADO[estado]}.` };
  }
}

export function PasoListo({ reserva, zonaHoraria, moneda }: Props) {
  const [copia, setCopia] = useState<EstadoCopia>('inicial');
  const enlace = enlaceDeGestion(reserva.tokenGestion);
  const { titulo, detalle } = textoDelEstado(reserva.estado);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(enlace);
      setCopia('copiado');
    } catch {
      // Sin permiso de portapapeles (o navegador viejo): el enlace queda seleccionable.
      setCopia('fallo');
    }
  }

  return (
    <div className="space-y-8">
      <section aria-label="Código de tu cita" className="space-y-2 text-center">
        <p className="text-muted-foreground">{titulo}</p>
        <p className="font-mono text-4xl font-bold tracking-wider">{reserva.codigo}</p>
        {detalle ? <p className="text-muted-foreground text-sm">{detalle}</p> : null}
      </section>

      <section aria-label="Detalle de tu cita" className="bg-muted/50 space-y-1 rounded-xl p-4">
        <p className="font-medium first-letter:uppercase">{etiquetaFechaHora(reserva.inicioEn, zonaHoraria)}</p>
        <p>{reserva.servicios.map((s) => s.nombre).join(' + ')}</p>
        <p className="text-muted-foreground text-sm">
          {reserva.sede.nombre}
          {reserva.sede.direccion ? ` · ${reserva.sede.direccion}` : ''}
        </p>
        <p className="text-muted-foreground text-sm">Con {reserva.barbero.nombre}</p>
        <p className="pt-1 font-semibold">{formatearPrecio(reserva.total, moneda)}</p>
      </section>

      <section aria-label="Enlace para gestionar tu cita" className="space-y-3">
        <h2 className="font-semibold">Guarda este enlace</h2>
        <p className="text-muted-foreground text-sm">
          Es la única forma de ver, cambiar o cancelar tu cita. No lo compartas.
        </p>
        <p className="bg-muted rounded-lg p-3 font-mono text-sm break-all select-all">{enlace}</p>
        <Boton variante="contorno" className="w-full" onClick={() => void copiar()}>
          Copiar enlace
        </Boton>
        <p role="status" className="text-muted-foreground text-sm">
          {copia === 'copiado' ? 'Enlace copiado.' : null}
          {copia === 'fallo' ? 'No se pudo copiar solo: mantén pulsado el enlace para copiarlo.' : null}
        </p>
      </section>

      <div className="space-y-3">
        <Boton variante="contorno" className="w-full" onClick={() => descargarIcs(reserva)}>
          Añadir al calendario
        </Boton>
        {/* Un enlace normal, no una acción del reductor: recargar es el reinicio completo, y no deja nada a medias. */}
        <a href="/" className={claseBoton('fantasma', 'w-full')}>
          Reservar otra cita
        </a>
      </div>
    </div>
  );
}
