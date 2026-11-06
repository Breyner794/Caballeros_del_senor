import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { HuecoPublico, ServicioPublico } from '@cds/shared';
import { BarraInferior } from '@/componentes/barra-inferior';
import { ErrorConsulta } from '@/componentes/error-consulta';
import { Aviso } from '@/componentes/ui/aviso';
import { Boton } from '@/componentes/ui/boton';
import type { ErrorApi } from '@/lib/api';
import { mensajeDeError } from '@/lib/errores';
import { fechaDeHoy, formatearDuracion, formatearPrecio } from '@/lib/formato';
import {
  claveDisponibilidad,
  claveOpciones,
  pedirOpciones,
  type RespuestaDisponibilidad,
} from './consultas';
import { PasoDatos, borradorVacio, type BorradorDatos, type ReservaCreada } from './paso-datos';
import { PasoFecha } from './paso-fecha';
import { PasoHora } from './paso-hora';
import { PasoListo } from './paso-listo';
import { PasoServicio } from './paso-servicio';
import {
  estadoInicial,
  reductor,
  totalDuracion,
  totalPrecio,
  type EstadoReserva,
  type PasoReserva,
} from './reductor';

const ORDEN: readonly PasoReserva[] = ['servicio', 'fecha', 'hora', 'datos', 'listo'];
const indice = (paso: PasoReserva) => ORDEN.indexOf(paso);

/** Los pasos que el cliente cuenta («Paso 2 de 4»); «listo» ya no es un paso, es el resultado. */
const PASOS_VISIBLES = 4;

const TITULOS: Record<PasoReserva, string> = {
  servicio: 'Reserva tu cita',
  fecha: '¿Qué día te queda bien?',
  hora: '¿A qué hora?',
  datos: 'Tus datos',
  listo: '¡Listo!',
};

/** `?paso=` desconocido o ausente es el primer paso. */
function pasoDeQuery(valor: string | null): PasoReserva {
  return ORDEN.find((paso) => paso === valor) ?? 'servicio';
}

const queryDe = (paso: PasoReserva): Record<string, string> => (paso === 'servicio' ? {} : { paso });

/**
 * Ruta del asistente de reserva.
 *
 * El reductor posee el estado; esta ruta lo conecta a la URL (`?paso=hora`)
 * para que el botón atrás —el del navegador, y sobre todo el de Android— retroceda
 * un paso en vez de sacar al cliente de la web con todo lo que llevaba.
 *
 * Qué pasa al recargar: el estado vive en memoria, así que recargar a mitad
 * del flujo pierde lo elegido y la URL vuelve al primer paso. Es deliberado:
 * persistirlo exigiría validar contra la API un estado antiguo (un hueco que
 * pudo ocuparse), y el flujo tiene cuatro pasos.
 */
export function Reservar() {
  const [estado, despachar] = useReducer(reductor, estadoInicial);
  const [borrador, setBorrador] = useState<BorradorDatos>(borradorVacio);
  const [reserva, setReserva] = useState<ReservaCreada | null>(null);
  const [avisoHorario, setAvisoHorario] = useState<string | null>(null);

  const [params, setParams] = useSearchParams();
  const navegar = useNavigate();
  const clienteConsultas = useQueryClient();
  const opcionesQuery = useQuery({ queryKey: claveOpciones, queryFn: pedirOpciones });

  // ---- El paso en la URL --------------------------------------------------

  const pasoUrl = pasoDeQuery(params.get('paso'));
  const pasoPrevio = useRef(estado.paso);
  useEffect(() => {
    const cambioElEstado = pasoPrevio.current !== estado.paso;
    pasoPrevio.current = estado.paso;
    if (pasoUrl === estado.paso) return;

    if (cambioElEstado) {
      // Lo llevó el estado (el cliente pulsó «Continuar»): la URL lo sigue con una
      // entrada nueva del historial. Con «listo» se reemplaza, para que atrás no
      // devuelva a un formulario cuya cita ya existe.
      setParams(queryDe(estado.paso), { replace: estado.paso === 'listo' });
      return;
    }
    // Lo llevó la URL (atrás o adelante del navegador, o una URL escrita a mano).
    const pasosAtras = indice(estado.paso) - indice(pasoUrl);
    if (estado.paso !== 'listo' && pasosAtras > 0) {
      // Puede ser más de uno si el historial saltó. Se hacen todos juntos para
      // que el estado nunca se quede a medio camino.
      for (let i = 0; i < pasosAtras; i++) despachar({ tipo: 'retroceder' });
    } else {
      // Un paso al que no se ha llegado: se vuelve al que sí.
      setParams(queryDe(estado.paso), { replace: true });
    }
  }, [pasoUrl, estado.paso, setParams]);

  // El aviso de «horario ocupado» solo tiene sentido en la rejilla de horas.
  useEffect(() => {
    if (estado.paso !== 'hora') setAvisoHorario(null);
  }, [estado.paso]);

  // ---- Callbacks estables para los pasos ---------------------------------

  const alAlternarServicio = useCallback(
    (servicio: ServicioPublico) => despachar({ tipo: 'alternarServicio', servicio }),
    [],
  );
  const alElegirSede = useCallback((sedeId: string) => despachar({ tipo: 'elegirSede', sedeId }), []);

  // ---- La hora ya no sirve -----------------------------------------------

  function alNoEstarDisponible(error: ErrorApi) {
    const { sedeId, fecha, servicios, barberoId } = estado;
    if (sedeId && fecha) {
      const clave = claveDisponibilidad({ sedeId, fecha, servicioIds: servicios.map((s) => s.id), barberoId });
      const huecos = (error.detalle as { huecos?: HuecoPublico[] } | undefined)?.huecos;
      if (Array.isArray(huecos)) {
        // La API ya trae la rejilla recalculada: se pinta tal cual, sin otra ida y vuelta.
        const recalculada: RespuestaDisponibilidad = { fecha, laborable: true, huecos };
        clienteConsultas.setQueryData(clave, recalculada);
      } else {
        void clienteConsultas.invalidateQueries({ queryKey: clave });
      }
      // Un día que parecía libre puede haberse llenado: el calendario también está viejo.
      void clienteConsultas.invalidateQueries({ queryKey: ['publico', 'calendario'] });
    }
    setAvisoHorario(mensajeDeError(error));
    despachar({ tipo: 'soltarHora' });
    // Se retrocede por el historial, como si el cliente hubiera pulsado atrás.
    navegar(-1);
  }

  // ---- Pintado ------------------------------------------------------------

  const zonaHoraria = opcionesQuery.data?.config.zonaHoraria;
  const hoy = useMemo(() => (zonaHoraria ? fechaDeHoy(zonaHoraria) : null), [zonaHoraria]);

  const cabecera = (
    <header className="mb-6 space-y-3">
      <div className="flex min-h-12 items-center gap-2">
        {estado.paso !== 'servicio' && estado.paso !== 'listo' ? (
          <Boton variante="fantasma" className="-ml-3" onClick={() => navegar(-1)}>
            Atrás
          </Boton>
        ) : (
          <p className="text-muted-foreground text-sm font-medium">
            {opcionesQuery.data?.config.nombreNegocio ?? 'Caballeros del Señor'}
          </p>
        )}
        {estado.paso !== 'listo' ? (
          <p className="text-muted-foreground ml-auto text-sm">
            Paso {indice(estado.paso) + 1} de {PASOS_VISIBLES}
          </p>
        ) : null}
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">{TITULOS[estado.paso]}</h1>
    </header>
  );

  function cuerpo() {
    if (opcionesQuery.isError) {
      return <ErrorConsulta error={opcionesQuery.error} alReintentar={() => void opcionesQuery.refetch()} />;
    }
    const opciones = opcionesQuery.data;
    if (!opciones || !hoy) {
      return (
        <p role="status" className="text-muted-foreground py-12 text-center">
          Cargando…
        </p>
      );
    }
    const { config } = opciones;
    const sede = opciones.sedes.find((s) => s.id === estado.sedeId);
    const servicioIds = estado.servicios.map((s) => s.id);

    switch (estado.paso) {
      case 'servicio':
        return (
          <PasoServicio
            opciones={opciones}
            serviciosElegidos={estado.servicios}
            sedeId={estado.sedeId}
            alAlternarServicio={alAlternarServicio}
            alElegirSede={alElegirSede}
          />
        );
      case 'fecha':
        if (!estado.sedeId) return null;
        return (
          <PasoFecha
            sedeId={estado.sedeId}
            servicioIds={servicioIds}
            hoy={hoy}
            maxDiasAnticipacion={config.maxDiasAnticipacion}
            fechaElegida={estado.fecha}
            alElegirFecha={(fecha) => despachar({ tipo: 'elegirFecha', fecha })}
          />
        );
      case 'hora':
        if (!estado.sedeId || !estado.fecha) return null;
        return (
          <div className="space-y-5">
            {avisoHorario ? <Aviso tono="aviso">{avisoHorario}</Aviso> : null}
            <PasoHora
              sedeId={estado.sedeId}
              fecha={estado.fecha}
              servicioIds={servicioIds}
              barberoId={estado.barberoId}
              barberos={config.permiteElegirBarbero ? (sede?.barberos ?? null) : null}
              huecoElegido={estado.hueco?.inicioEn ?? null}
              alElegirHueco={(hueco) => {
                setAvisoHorario(null);
                despachar({ tipo: 'elegirHora', hueco });
              }}
              alElegirBarbero={(barberoId) => despachar({ tipo: 'elegirBarbero', barberoId })}
            />
          </div>
        );
      case 'datos':
        return (
          <PasoDatos
            estado={estado}
            moneda={config.moneda}
            sedeNombre={sede?.nombre ?? ''}
            borrador={borrador}
            alCambiarBorrador={(cambios) => setBorrador((previo) => ({ ...previo, ...cambios }))}
            alCrearse={(creada) => {
              setReserva(creada);
              despachar({ tipo: 'confirmar' });
            }}
            alNoEstarDisponible={alNoEstarDisponible}
          />
        );
      case 'listo':
        return reserva ? (
          <PasoListo reserva={reserva} zonaHoraria={config.zonaHoraria} moneda={config.moneda} />
        ) : null;
    }
  }

  // «Datos» y «listo» llevan su propia acción; los otros tres, la barra de continuar.
  const conBarraContinuar =
    opcionesQuery.data !== undefined &&
    (estado.paso === 'servicio' || estado.paso === 'fecha' || estado.paso === 'hora');

  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg px-4 pt-4 pb-32">
      {cabecera}
      <main>{cuerpo()}</main>

      {conBarraContinuar ? (
        <BarraInferior>
          <div className="min-w-0 flex-1">
            {estado.servicios.length > 0 ? (
              <>
                <p className="font-semibold">
                  {formatearPrecio(totalPrecio(estado), opcionesQuery.data.config.moneda)}
                </p>
                <p className="text-muted-foreground text-sm">{formatearDuracion(totalDuracion(estado))}</p>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">Elige al menos un servicio</p>
            )}
          </div>
          <Boton
            className="flex-[2]"
            disabled={!puedeContinuar(estado)}
            onClick={() => despachar({ tipo: 'avanzar' })}
          >
            Continuar
          </Boton>
        </BarraInferior>
      ) : null}
    </div>
  );
}

/** Lo mismo que exige el reductor para avanzar, para desactivar el botón sin duplicar la regla en otro sitio. */
function puedeContinuar(estado: EstadoReserva): boolean {
  return reductor(estado, { tipo: 'avanzar' }) !== estado;
}
