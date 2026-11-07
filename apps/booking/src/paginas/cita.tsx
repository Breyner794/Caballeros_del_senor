import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CODIGOS_ERROR,
  ETIQUETAS_ESTADO,
  MENSAJES_ERROR,
  type HuecoPublico,
  type MiReservaPublica,
  type OpcionesPublicas,
} from '@cds/shared';
import { BarraInferior } from '@/componentes/barra-inferior';
import { ErrorConsulta } from '@/componentes/error-consulta';
import { AvisosDeAccion, TEXTO_CAPTCHA, esCaptchaRechazado, useCaptcha } from '@/componentes/captcha';
import { Aviso } from '@/componentes/ui/aviso';
import { Boton, claseBoton } from '@/componentes/ui/boton';
import { ErrorApi, guardarTokenGestion, peticion } from '@/lib/api';
import { ERRORES_DE_HORARIO, esErrorDeRed, mensajeDeError } from '@/lib/errores';
import { etiquetaFechaHora, fechaDeHoy, formatearPrecio } from '@/lib/formato';
import { claveOpciones, pedirOpciones } from './reservar/consultas';
import { enlaceDeGestion } from './reservar/paso-listo';
import { PasoFecha } from './reservar/paso-fecha';
import { PasoHora } from './reservar/paso-hora';

/**
 * Pantalla de gestión de la cita: lo que abre el enlace `/cita#<token>`.
 *
 * El token vive en el FRAGMENTO de la URL, y solo ahí: un fragmento no se envía
 * nunca al servidor, así que no queda en los registros de acceso, ni en un
 * proxy, ni en la cabecera `Referer` si el cliente pulsa un enlace externo
 * desde esta pantalla. Se lee de `location.hash`, se le entrega al cliente HTTP
 * (que lo manda en `X-Token-Gestion`) y no se escribe en ningún otro sitio: ni
 * en la ruta, ni en la query, ni en un registro, ni en el texto de la pantalla.
 */

// ---- Textos que no salen del catálogo de errores ---------------------------
// El catálogo está escrito para el panel; estos son los que el canal público
// necesita decir con otras palabras o que no son errores. Cada uno dice por qué.

/**
 * `CONFLICTO` («Otro usuario modificó esta información. Recarga y vuelve a
 * intentarlo.») habla del panel y pide recargar sin dar un botón. Aquí la
 * pantalla ya releyó la cita por su cuenta y lo que el cliente ve es el estado
 * actual: solo hay que decirle que cambió.
 */
const TEXTO_LA_CITA_CAMBIO =
  'Tu cita cambió mientras la modificabas. Esto es lo que figura ahora; revísalo antes de volver a intentarlo.';

const TEXTO_REPROGRAMADA = 'Listo, tu cita quedó reprogramada.';
const TEXTO_ENLACE_CAMBIO =
  'Tu enlace anterior ya no sirve: esta cita tiene uno nuevo. Cópialo y guárdalo para volver a verla.';

// ---- Consultas ----------------------------------------------------------------

const claveCita = ['publico', 'mi-reserva'] as const;

/** Un token por petición: así ningún camino consulta con un token que no es el de la pantalla. */
function pedirMiReserva(token: string): Promise<MiReservaPublica> {
  guardarTokenGestion(token);
  return peticion<MiReservaPublica>('/publico/mi-reserva');
}

type ReservaReprogramada = MiReservaPublica & { tokenGestion: string };

const estaActiva = (cita: MiReservaPublica) => cita.estado === 'PENDIENTE' || cita.estado === 'CONFIRMADA';

/**
 * Por qué no se puede hacer la acción. Una cita ya cancelada o atendida no
 * está «fuera de plazo»: el motivo es su estado.
 */
function motivoCancelar(cita: MiReservaPublica): string {
  return estaActiva(cita)
    ? MENSAJES_ERROR.FUERA_DE_PLAZO_CANCELACION
    : MENSAJES_ERROR.ESTADO_RESERVA_INVALIDO;
}
function motivoReprogramar(cita: MiReservaPublica): string {
  return estaActiva(cita)
    ? MENSAJES_ERROR.FUERA_DE_PLAZO_REPROGRAMACION
    : MENSAJES_ERROR.ESTADO_RESERVA_INVALIDO;
}

// ================================================================== la ruta

export function Cita() {
  const { hash } = useLocation();
  const tokenDeLaUrl = hash.slice(1) || null;
  const [token, setToken] = useState<string | null>(tokenDeLaUrl);
  // Cada vez que el cliente abre OTRO enlace, la pantalla empieza de cero.
  const [apertura, setApertura] = useState(0);
  const tokenVigente = useRef(token);
  const navegar = useNavigate();
  const clienteConsultas = useQueryClient();

  // Pegar otro enlace de gestión en la misma pestaña solo cambia el fragmento:
  // no recarga la página. Con dos citas activas por cliente es el caso normal.
  useEffect(() => {
    // Un cambio hecho por esta pantalla (reprogramar) ya dejó `tokenVigente` al día.
    if (tokenDeLaUrl === tokenVigente.current) return;
    tokenVigente.current = tokenDeLaUrl;
    // La cita anterior no es la de este enlace: ni su caché ni sus avisos sobreviven.
    clienteConsultas.removeQueries({ queryKey: claveCita });
    /**
     * Y tampoco su disponibilidad. Las claves de `consultas.ts` distinguen
     * `mi-cita` de `general`, pero no CUÁL cita se está excluyendo: la rejilla
     * y el calendario de `mi-reserva` se calculan sin contar la propia cita, y
     * con dos citas activas por cliente —la configuración lo permite— los
     * datos cacheados para la cita A valdrían para la B si comparten sede,
     * servicios y rango. El tramo de A saldría libre sin estarlo y el propio
     * de B saldría ocupado: justo lo que la exclusión existe para evitar.
     *
     * Se borran las dos ramas enteras en vez de meter el código de la cita en
     * la clave: el token no entra en la caché por decisión expresa, y añadir
     * una parte más a la clave obligaría a bajar el código de la cita hasta
     * `PasoFecha` y `PasoHora` para acertar siempre. Borrar es exacto por
     * construcción; el coste es una consulta de más al cambiar de enlace.
     */
    clienteConsultas.removeQueries({ queryKey: ['publico', 'disponibilidad'] });
    clienteConsultas.removeQueries({ queryKey: ['publico', 'calendario'] });
    setToken(tokenDeLaUrl);
    setApertura((n) => n + 1);
  }, [tokenDeLaUrl, clienteConsultas]);

  function alCambiarToken(nuevo: string) {
    // Primero el cliente HTTP, luego la URL, y solo después el estado: si algo
    // falla a mitad, el cliente no se queda con un enlace que no abre su cita.
    guardarTokenGestion(nuevo);
    tokenVigente.current = nuevo;
    navegar({ hash: nuevo }, { replace: true });
    setToken(nuevo);
  }

  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg px-4 pt-4 pb-32">
      <header className="mb-6 space-y-3">
        <p className="text-muted-foreground flex min-h-12 items-center text-sm font-medium">
          Caballeros del Señor
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Tu cita</h1>
      </header>
      <main>
        {token === null ? (
          <EnlaceNoValido texto={MENSAJES_ERROR.TOKEN_INVALIDO} />
        ) : (
          <GestionCita key={apertura} token={token} alCambiarToken={alCambiarToken} />
        )}
      </main>
    </div>
  );
}

/** Sin fragmento, o con uno que la API no reconoce: una salida, nunca una pantalla en blanco. */
function EnlaceNoValido({ texto }: { texto: string }) {
  return (
    <div className="space-y-4">
      <Aviso>{texto}</Aviso>
      <p className="text-muted-foreground text-sm">
        Abre el enlace completo que recibiste al reservar, o haz una reserva nueva.
      </p>
      <a href="/" className={claseBoton('primario', 'w-full')}>
        Reservar una cita
      </a>
    </div>
  );
}

// ============================================================ la gestión

type Vista = 'detalle' | 'cancelando' | 'reprogramando' | 'cancelada';

interface PropsGestion {
  token: string;
  alCambiarToken: (nuevo: string) => void;
}

function GestionCita({ token, alCambiarToken }: PropsGestion) {
  const [vista, setVista] = useState<Vista>('detalle');
  const [aviso, setAviso] = useState<string | null>(null);
  const [reprogramada, setReprogramada] = useState(false);
  const [citaCancelada, setCitaCancelada] = useState<MiReservaPublica | null>(null);
  const clienteConsultas = useQueryClient();

  const cita = useQuery({
    queryKey: claveCita,
    queryFn: () => pedirMiReserva(token),
    // Cancelada, el enlace ya no vale: consultar otra vez (también al volver a la ventana) daría TOKEN_INVALIDO.
    enabled: vista !== 'cancelada',
    // Reintentar un enlace que no vale solo retrasa el mensaje; una caída de red puntual sí merece otro intento.
    retry: (veces, error) => esErrorDeRed(error) && veces < 1,
  });
  const opciones = useQuery({ queryKey: claveOpciones, queryFn: pedirOpciones });

  /** Vuelve a la ficha con un aviso y la cita releída: lo que el cliente ve es lo que hay ahora. */
  function volverAlDetalle(texto: string | null) {
    setAviso(texto);
    setReprogramada(false);
    setVista('detalle');
    void clienteConsultas.invalidateQueries({ queryKey: claveCita });
  }

  if (vista === 'cancelada' && citaCancelada) {
    return (
      <section aria-label="Cita cancelada" className="space-y-6">
        <p role="status" className="text-lg">
          Tu cita <span className="font-mono font-semibold">{citaCancelada.codigo}</span> quedó cancelada.
        </p>
        <a href="/" className={claseBoton('primario', 'w-full')}>
          Reservar otra cita
        </a>
      </section>
    );
  }

  if (cita.isError) {
    // Un enlace que no vale no se arregla reintentando: se ofrece reservar.
    if (cita.error instanceof ErrorApi && cita.error.codigo === CODIGOS_ERROR.TOKEN_INVALIDO) {
      return <EnlaceNoValido texto={mensajeDeError(cita.error)} />;
    }
    return <ErrorConsulta error={cita.error} alReintentar={() => void cita.refetch()} />;
  }
  if (opciones.isError) {
    return <ErrorConsulta error={opciones.error} alReintentar={() => void opciones.refetch()} />;
  }
  if (!cita.data || !opciones.data) {
    return (
      <p role="status" className="text-muted-foreground py-12 text-center">
        Cargando tu cita…
      </p>
    );
  }

  const datos = cita.data;
  const catalogo = opciones.data;
  const { zonaHoraria, moneda } = catalogo.config;

  if (vista === 'cancelando') {
    return (
      <ConfirmarCancelacion
        cita={datos}
        zonaHoraria={zonaHoraria}
        alConservar={() => volverAlDetalle(null)}
        alCancelarse={(cancelada) => {
          // El dominio anuló el token: el cliente HTTP deja de mandarlo y no se vuelve a consultar.
          guardarTokenGestion(null);
          setCitaCancelada(cancelada);
          setVista('cancelada');
        }}
        alNoAdmitirse={(texto) => volverAlDetalle(texto)}
      />
    );
  }

  if (vista === 'reprogramando') {
    return (
      <Reprogramar
        cita={datos}
        servicioIds={datos.servicios.map((s) => s.servicioId)}
        opciones={catalogo}
        alVolver={() => volverAlDetalle(null)}
        alReprogramarse={(nueva) => {
          const { tokenGestion, ...sinToken } = nueva;
          // Lo más importante de la pantalla: el token viejo ya murió. Se guarda el
          // nuevo (cliente HTTP y URL) antes de pintar nada, o una recarga dejaría al
          // cliente sin acceso a su propia cita.
          alCambiarToken(tokenGestion);
          clienteConsultas.setQueryData(claveCita, sinToken);
          void clienteConsultas.invalidateQueries({ queryKey: ['publico', 'calendario'] });
          void clienteConsultas.invalidateQueries({ queryKey: ['publico', 'disponibilidad'] });
          setAviso(null);
          setReprogramada(true);
          setVista('detalle');
        }}
        alCambiarLaCita={volverAlDetalle}
      />
    );
  }

  return (
    <Detalle
      cita={datos}
      zonaHoraria={zonaHoraria}
      moneda={moneda}
      aviso={aviso}
      reprogramada={reprogramada}
      enlaceNuevo={() => enlaceDeGestion(token)}
      alCancelar={() => {
        setAviso(null);
        setReprogramada(false);
        setVista('cancelando');
      }}
      alReprogramar={() => {
        setAviso(null);
        setReprogramada(false);
        setVista('reprogramando');
      }}
    />
  );
}

// ================================================================ el detalle

/** Un botón `disabled` no recibe foco: el motivo se enlaza con `aria-describedby` para que el lector de pantalla lo lea. */
const ID_MOTIVO_CANCELAR = 'motivo-cancelar';
const ID_MOTIVO_REPROGRAMAR = 'motivo-reprogramar';

interface PropsDetalle {
  cita: MiReservaPublica;
  zonaHoraria: string;
  moneda: string;
  aviso: string | null;
  reprogramada: boolean;
  /** El enlace vigente, calculado al copiarlo: el token no se guarda ni se pinta en la ficha. */
  enlaceNuevo: () => string;
  alCancelar: () => void;
  alReprogramar: () => void;
}

function Detalle({
  cita,
  zonaHoraria,
  moneda,
  aviso,
  reprogramada,
  enlaceNuevo,
  alCancelar,
  alReprogramar,
}: PropsDetalle) {
  const [copia, setCopia] = useState<'inicial' | 'copiado' | 'fallo'>('inicial');

  async function copiarEnlaceNuevo() {
    try {
      await navigator.clipboard.writeText(enlaceNuevo());
      setCopia('copiado');
    } catch {
      setCopia('fallo');
    }
  }

  return (
    <div className="space-y-6">
      {aviso ? <Aviso tono="aviso">{aviso}</Aviso> : null}

      {reprogramada ? (
        <section aria-label="Cita reprogramada" className="bg-muted/50 space-y-3 rounded-xl p-4">
          <p role="status" className="font-medium">
            {TEXTO_REPROGRAMADA}
          </p>
          <p className="text-muted-foreground text-sm">{TEXTO_ENLACE_CAMBIO}</p>
          <Boton variante="contorno" className="w-full" onClick={() => void copiarEnlaceNuevo()}>
            Copiar enlace nuevo
          </Boton>
          <p role="status" className="text-muted-foreground text-sm">
            {copia === 'copiado' ? 'Enlace copiado.' : null}
            {copia === 'fallo' ? 'No se pudo copiar solo: copia la dirección de esta página.' : null}
          </p>
        </section>
      ) : null}

      <section aria-label="Tu cita" className="space-y-3">
        <p className="font-mono text-3xl font-bold tracking-wider">{cita.codigo}</p>
        <p className="text-muted-foreground text-sm">
          Estado: <span className="text-foreground font-medium">{ETIQUETAS_ESTADO[cita.estado]}</span>
        </p>
      </section>

      <section aria-label="Detalle de tu cita" className="bg-muted/50 space-y-1 rounded-xl p-4">
        <p className="font-medium first-letter:uppercase">{etiquetaFechaHora(cita.inicioEn, zonaHoraria)}</p>
        <ul>
          {cita.servicios.map((s, i) => (
            <li key={i}>{s.nombre}</li>
          ))}
        </ul>
        <p className="text-muted-foreground text-sm">
          {cita.sede.nombre}
          {cita.sede.direccion ? ` · ${cita.sede.direccion}` : ''}
        </p>
        <p className="text-muted-foreground text-sm">Con {cita.barbero.nombre}</p>
        <p className="pt-1 font-semibold">{formatearPrecio(cita.total, moneda)}</p>
      </section>

      <div className="space-y-5">
        <div className="space-y-2">
          <Boton
            className="w-full"
            disabled={!cita.puedeReprogramar}
            aria-describedby={cita.puedeReprogramar ? undefined : ID_MOTIVO_REPROGRAMAR}
            onClick={alReprogramar}
          >
            Cambiar fecha u hora
          </Boton>
          {!cita.puedeReprogramar ? (
            <p id={ID_MOTIVO_REPROGRAMAR} className="text-muted-foreground text-sm">
              {motivoReprogramar(cita)}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Boton
            variante="contorno"
            className="w-full"
            disabled={!cita.puedeCancelar}
            aria-describedby={cita.puedeCancelar ? undefined : ID_MOTIVO_CANCELAR}
            onClick={alCancelar}
          >
            Cancelar mi cita
          </Boton>
          {!cita.puedeCancelar ? (
            <p id={ID_MOTIVO_CANCELAR} className="text-muted-foreground text-sm">
              {motivoCancelar(cita)}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ================================================================ cancelar

interface PropsCancelacion {
  cita: MiReservaPublica;
  zonaHoraria: string;
  alConservar: () => void;
  alCancelarse: (cancelada: MiReservaPublica) => void;
  /** La cita ya no admite la cancelación (por ejemplo, otra cancelación llegó antes). */
  alNoAdmitirse: (texto: string) => void;
}

function ConfirmarCancelacion({ cita, zonaHoraria, alConservar, alCancelarse, alNoAdmitirse }: PropsCancelacion) {
  const captcha = useCaptcha();
  const [textoAviso, setTextoAviso] = useState<string | null>(null);

  const cancelar = useMutation({
    mutationFn: (tokenTurnstile: string) =>
      peticion<MiReservaPublica>('/publico/mi-reserva/cancelar', { method: 'POST', body: { tokenTurnstile } }),
    onSuccess: alCancelarse,
    onError: (error) => {
      captcha.pedirOtro();
      if (error instanceof ErrorApi && error.codigo === CODIGOS_ERROR.ESTADO_RESERVA_INVALIDO) {
        alNoAdmitirse(mensajeDeError(error));
        return;
      }
      setTextoAviso(textoDeError(error));
    },
  });

  return (
    <section aria-label="Confirmar cancelación" className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">¿Seguro que quieres cancelar tu cita?</h2>
        <p className="text-muted-foreground first-letter:uppercase">
          {etiquetaFechaHora(cita.inicioEn, zonaHoraria)} · {cita.servicios.map((s) => s.nombre).join(' + ')}
        </p>
        <p className="text-muted-foreground text-sm">Esta acción no se puede deshacer.</p>
      </div>

      {captcha.widget}
      <AvisosDeAccion captcha={captcha} texto={textoAviso} />

      <div className="space-y-3">
        <Boton
          className="w-full"
          disabled={captcha.token === null || cancelar.isPending}
          onClick={() => {
            if (!captcha.token) return;
            setTextoAviso(null);
            cancelar.mutate(captcha.token);
          }}
        >
          {cancelar.isPending ? 'Cancelando…' : captcha.token === null ? 'Verificando…' : 'Sí, cancelar mi cita'}
        </Boton>
        <Boton variante="contorno" className="w-full" disabled={cancelar.isPending} onClick={alConservar}>
          Conservar mi cita
        </Boton>
      </div>
    </section>
  );
}

// ================================================================ reprogramar

interface PropsReprogramar {
  cita: MiReservaPublica;
  servicioIds: string[];
  opciones: OpcionesPublicas;
  alVolver: () => void;
  alReprogramarse: (nueva: ReservaReprogramada) => void;
  /** La cita cambió o ya no admite la acción: se vuelve a la ficha con este texto. */
  alCambiarLaCita: (texto: string) => void;
}

function Reprogramar({ cita, servicioIds, opciones, alVolver, alReprogramarse, alCambiarLaCita }: PropsReprogramar) {
  const { config } = opciones;
  const sede = opciones.sedes.find((s) => s.id === cita.sede.id);
  const barberos = config.permiteElegirBarbero ? (sede?.barberos ?? null) : null;
  const hoy = fechaDeHoy(config.zonaHoraria);
  const clienteConsultas = useQueryClient();

  const [fecha, setFecha] = useState<string | null>(null);
  const [hueco, setHueco] = useState<HuecoPublico | null>(null);
  // Parte del barbero que ya tiene la cita, si el negocio deja elegir y sigue ofreciéndolo.
  const [barberoId, setBarberoId] = useState<string | null>(
    barberos?.some((b) => b.id === cita.barbero.id) ? cita.barbero.id : null,
  );
  const captcha = useCaptcha();
  const [textoAviso, setTextoAviso] = useState<string | null>(null);

  const reprogramar = useMutation({
    mutationFn: (cuerpo: { inicioEn: string; barberoId?: string; tokenTurnstile: string }) =>
      peticion<ReservaReprogramada>('/publico/mi-reserva/reprogramar', { method: 'POST', body: cuerpo }),
    onSuccess: alReprogramarse,
    onError: (error) => {
      captcha.pedirOtro();
      if (error instanceof ErrorApi) {
        if (error.codigo === CODIGOS_ERROR.CONFLICTO) {
          alCambiarLaCita(TEXTO_LA_CITA_CAMBIO);
          return;
        }
        if (error.codigo === CODIGOS_ERROR.ESTADO_RESERVA_INVALIDO) {
          alCambiarLaCita(mensajeDeError(error));
          return;
        }
        if (ERRORES_DE_HORARIO.has(error.codigo)) {
          // Esa hora ya no sirve: se repinta la rejilla y se elige otra, sin salir del día.
          setHueco(null);
          void clienteConsultas.invalidateQueries({ queryKey: ['publico', 'disponibilidad'] });
          void clienteConsultas.invalidateQueries({ queryKey: ['publico', 'calendario'] });
        }
      }
      setTextoAviso(textoDeError(error));
    },
  });

  function confirmar() {
    if (!hueco || !captcha.token) return;
    setTextoAviso(null);
    reprogramar.mutate({
      inicioEn: hueco.inicioEn,
      // El barbero solo viaja si el negocio deja elegirlo.
      ...(barberos && barberoId ? { barberoId } : {}),
      tokenTurnstile: captcha.token,
    });
  }

  return (
    <section aria-label="Cambiar fecha u hora" className="space-y-6">
      <div className="flex items-center gap-2">
        <Boton
          variante="fantasma"
          className="-ml-3"
          onClick={() => {
            if (fecha === null) alVolver();
            else {
              setFecha(null);
              setHueco(null);
            }
          }}
        >
          {fecha === null ? 'Volver' : 'Cambiar de día'}
        </Boton>
      </div>
      <h2 className="text-xl font-semibold">{fecha === null ? '¿Qué día te queda bien?' : '¿A qué hora?'}</h2>

      {fecha === null ? (
        <PasoFecha
          sedeId={cita.sede.id}
          servicioIds={servicioIds}
          hoy={hoy}
          maxDiasAnticipacion={config.maxDiasAnticipacion}
          fechaElegida={null}
          deMiCita
          alElegirFecha={(f) => {
            setTextoAviso(null);
            setFecha(f);
          }}
        />
      ) : (
        <PasoHora
          sedeId={cita.sede.id}
          fecha={fecha}
          servicioIds={servicioIds}
          barberoId={barberoId}
          barberos={barberos}
          deMiCita
          huecoElegido={hueco?.inicioEn ?? null}
          alElegirHueco={(h) => {
            setTextoAviso(null);
            setHueco(h);
          }}
          alElegirBarbero={(id) => {
            setBarberoId(id);
            setHueco(null);
          }}
        />
      )}

      {/* Un solo widget durante toda la pantalla: así el token no caduca al ir y volver entre día y hora. */}
      {captcha.widget}
      <AvisosDeAccion captcha={captcha} texto={textoAviso} />

      {hueco ? (
        <BarraInferior>
          <Boton
            className="w-full"
            disabled={captcha.token === null || reprogramar.isPending}
            onClick={confirmar}
          >
            {reprogramar.isPending ? 'Guardando…' : captcha.token === null ? 'Verificando…' : 'Confirmar el cambio'}
          </Boton>
        </BarraInferior>
      ) : null}
    </section>
  );
}

// ================================================================ captcha

/** Texto de un error de la acción. El captcha rechazado no es un dato que el cliente haya escrito. */
function textoDeError(error: unknown): string {
  return esCaptchaRechazado(error) ? TEXTO_CAPTCHA : mensajeDeError(error);
}
