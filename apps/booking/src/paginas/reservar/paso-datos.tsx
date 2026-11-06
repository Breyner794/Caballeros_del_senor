import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  CODIGOS_ERROR,
  MENSAJES_ERROR,
  crearReservaPublicaSchema,
  type ReservaPublica,
} from '@cds/shared';
import { BarraInferior } from '@/componentes/barra-inferior';
import { Turnstile } from '@/componentes/turnstile';
import { Aviso } from '@/componentes/ui/aviso';
import { Boton, claseBoton } from '@/componentes/ui/boton';
import { AreaTexto, Campo, Entrada } from '@/componentes/ui/campo';
import { peticion, ErrorApi } from '@/lib/api';
import { mensajeDeError } from '@/lib/errores';
import { etiquetaFecha, etiquetaHora, formatearDuracion, formatearPrecio } from '@/lib/formato';
import { totalDuracion, totalPrecio, type EstadoReserva } from './reductor';

/** Lo que el cliente escribe. Vive en la ruta para no perderse al ir y volver entre pasos. */
export interface BorradorDatos {
  nombre: string;
  telefono: string;
  email: string;
  nota: string;
}

export const borradorVacio: BorradorDatos = { nombre: '', telefono: '', email: '', nota: '' };

export type ReservaCreada = ReservaPublica & { tokenGestion: string };

type CampoFormulario = keyof BorradorDatos;

/**
 * El captcha rechazado llega con el mensaje genérico de `VALIDACION`
 * («Revisa los datos del formulario»), que no le sirve al cliente: el captcha
 * no es algo que él haya escrito. Este es el único texto que no sale de
 * `MENSAJES_ERROR`.
 */
export const TEXTO_CAPTCHA = 'No pudimos verificar que eres una persona. Inténtalo de nuevo.';

/**
 * El widget de verificación no cargó (falta la clave o el script no llegó):
 * es un fallo nuestro o de un bloqueador, no de la conexión del cliente, así
 * que no se le dice «revisa tu conexión». Tampoco sale de `MENSAJES_ERROR`.
 */
export const TEXTO_VERIFICACION_NO_CARGA =
  'No pudimos cargar la verificación de seguridad. Recarga la página o inténtalo en unos minutos.';

/**
 * Errores que significan «esa hora ya no sirve»: no se arreglan en este
 * formulario, sino eligiendo otra hora, así que los atiende la ruta.
 */
export const ERRORES_DE_HORARIO: ReadonlySet<string> = new Set([
  CODIGOS_ERROR.RESERVA_SOLAPADA,
  CODIGOS_ERROR.ANTELACION_INSUFICIENTE,
  CODIGOS_ERROR.HORARIO_FUERA_DE_JORNADA,
  CODIGOS_ERROR.BARBERO_NO_TRABAJA_ESE_DIA,
  CODIGOS_ERROR.SEDE_CERRADA,
  CODIGOS_ERROR.DIA_NO_LABORABLE,
  CODIGOS_ERROR.RESERVA_EN_EL_PASADO,
  CODIGOS_ERROR.FECHA_DEMASIADO_LEJANA,
]);

/** Errores que significan «algo de lo elegido ya no existe»: lo sano es empezar de nuevo. */
const ERRORES_DE_CATALOGO: ReadonlySet<string> = new Set([
  CODIGOS_ERROR.RECURSO_NO_ENCONTRADO,
  CODIGOS_ERROR.BARBERO_NO_PERTENECE_A_SEDE,
]);

/** `cliente.nombreCompleto` → `nombre`. La API y el esquema nombran los campos distinto que el formulario. */
function campoDelFormulario(ruta: ReadonlyArray<string | number>): CampoFormulario | null {
  switch (String(ruta[ruta.length - 1])) {
    case 'nombreCompleto':
      return 'nombre';
    case 'telefono':
      return 'telefono';
    case 'email':
      return 'email';
    case 'notaCliente':
      return 'nota';
    default:
      return null;
  }
}

type ErroresCampo = Partial<Record<CampoFormulario, string>>;

interface AvisoLocal {
  texto: string;
  /** Hay que empezar de nuevo: lo elegido ya no existe. */
  empezarDeNuevo?: boolean;
  /** El widget del captcha falló al cargar: ofrece reintentar. */
  captcha?: boolean;
}

interface Props {
  estado: EstadoReserva;
  moneda: string;
  sedeNombre: string;
  borrador: BorradorDatos;
  alCambiarBorrador: (cambios: Partial<BorradorDatos>) => void;
  alCrearse: (reserva: ReservaCreada) => void;
  /** La hora ya no sirve: la ruta lleva al cliente de vuelta a la rejilla. */
  alNoEstarDisponible: (error: ErrorApi) => void;
}

const ID_FORMULARIO = 'formulario-datos';

export function PasoDatos({
  estado,
  moneda,
  sedeNombre,
  borrador,
  alCambiarBorrador,
  alCrearse,
  alNoEstarDisponible,
}: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [reinicios, setReinicios] = useState(0);
  const [intentoWidget, setIntentoWidget] = useState(0);
  const [erroresCampo, setErroresCampo] = useState<ErroresCampo>({});
  const [aviso, setAviso] = useState<AvisoLocal | null>(null);

  // El error aparece bajo el formulario: se lleva a la vista para que el cliente lo vea sin buscarlo.
  const zonaAviso = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (aviso) zonaAviso.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [aviso]);

  const crear = useMutation({
    mutationFn: (cuerpo: unknown) =>
      peticion<ReservaCreada>('/publico/reservas', { method: 'POST', body: cuerpo }),
    onSuccess: alCrearse,
    onError: (error) => {
      // Un token de Turnstile sirve una sola vez: tras cualquier intento hace falta otro.
      setToken(null);
      setReinicios((n) => n + 1);

      if (!(error instanceof ErrorApi)) {
        setAviso({ texto: mensajeDeError(error) });
        return;
      }
      if (ERRORES_DE_HORARIO.has(error.codigo)) {
        alNoEstarDisponible(error);
        return;
      }
      if (error.codigo === CODIGOS_ERROR.VALIDACION) {
        if (error.campos?.tokenTurnstile) {
          setAviso({ texto: TEXTO_CAPTCHA });
          return;
        }
        const porCampo: ErroresCampo = {};
        for (const [ruta, mensajes] of Object.entries(error.campos ?? {})) {
          const campo = campoDelFormulario(ruta.split('.'));
          if (campo && mensajes[0]) porCampo[campo] = mensajes[0];
        }
        setErroresCampo(porCampo);
        setAviso({ texto: MENSAJES_ERROR.VALIDACION });
        return;
      }
      setAviso({
        texto: mensajeDeError(error),
        empezarDeNuevo: ERRORES_DE_CATALOGO.has(error.codigo),
      });
    },
  });

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (!token || !estado.hueco || !estado.sedeId) return;
    setAviso(null);

    // El mismo esquema que valida la API: el teléfono sale ya normalizado a +57…
    const validado = crearReservaPublicaSchema.safeParse({
      sedeId: estado.sedeId,
      servicioIds: estado.servicios.map((s) => s.id),
      inicioEn: estado.hueco.inicioEn,
      ...(estado.barberoId ? { barberoId: estado.barberoId } : {}),
      cliente: {
        nombreCompleto: borrador.nombre,
        telefono: borrador.telefono,
        ...(borrador.email.trim() ? { email: borrador.email } : {}),
      },
      ...(borrador.nota.trim() ? { notaCliente: borrador.nota } : {}),
      tokenTurnstile: token,
    });

    if (!validado.success) {
      const porCampo: ErroresCampo = {};
      for (const problema of validado.error.issues) {
        const campo = campoDelFormulario(problema.path);
        if (campo && !porCampo[campo]) porCampo[campo] = problema.message;
      }
      setErroresCampo(porCampo);
      // Si el problema no es de un campo que el cliente pueda corregir, no se puede quedar callado.
      if (Object.keys(porCampo).length === 0) setAviso({ texto: MENSAJES_ERROR.VALIDACION });
      return;
    }

    setErroresCampo({});
    crear.mutate(validado.data);
  }

  const cambiar = (campo: CampoFormulario) => (valor: string) => {
    alCambiarBorrador({ [campo]: valor });
    if (erroresCampo[campo]) setErroresCampo((previos) => ({ ...previos, [campo]: undefined }));
  };

  const enEspera = crear.isPending || token === null;

  return (
    <div className="space-y-6">
      <section aria-label="Resumen de tu cita" className="bg-muted/50 space-y-1 rounded-xl p-4 text-sm">
        <p className="font-medium">{estado.servicios.map((s) => s.nombre).join(' + ')}</p>
        {estado.fecha && estado.hueco ? (
          <p className="first-letter:uppercase">
            {etiquetaFecha(estado.fecha)} · {etiquetaHora(estado.hueco.hora)}
          </p>
        ) : null}
        <p className="text-muted-foreground">{sedeNombre}</p>
      </section>

      <form id={ID_FORMULARIO} noValidate onSubmit={enviar} className="space-y-5">
        <Campo etiqueta="Nombre completo" requerido error={erroresCampo.nombre}>
          {(props) => (
            <Entrada
              {...props}
              autoComplete="name"
              value={borrador.nombre}
              onChange={(e) => cambiar('nombre')(e.target.value)}
            />
          )}
        </Campo>
        <Campo etiqueta="Celular" requerido error={erroresCampo.telefono}>
          {(props) => (
            <Entrada
              {...props}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="300 123 4567"
              value={borrador.telefono}
              onChange={(e) => cambiar('telefono')(e.target.value)}
            />
          )}
        </Campo>
        <Campo etiqueta="Correo (opcional)" error={erroresCampo.email}>
          {(props) => (
            <Entrada
              {...props}
              type="email"
              inputMode="email"
              autoComplete="email"
              value={borrador.email}
              onChange={(e) => cambiar('email')(e.target.value)}
            />
          )}
        </Campo>
        <Campo etiqueta="Nota para el barbero (opcional)" error={erroresCampo.nota}>
          {(props) => (
            <AreaTexto
              {...props}
              maxLength={500}
              value={borrador.nota}
              onChange={(e) => cambiar('nota')(e.target.value)}
            />
          )}
        </Campo>

        <Turnstile
          key={intentoWidget}
          claveSitio={import.meta.env.VITE_TURNSTILE_SITE_KEY}
          reinicios={reinicios}
          alCambiarToken={setToken}
          alFallar={() => setAviso({ texto: TEXTO_VERIFICACION_NO_CARGA, captcha: true })}
        />
      </form>

      {aviso ? (
        <div ref={zonaAviso} className="space-y-3">
          <Aviso>{aviso.texto}</Aviso>
          {aviso.empezarDeNuevo ? (
            <a href="/" className={claseBoton('contorno', 'w-full')}>
              Empezar de nuevo
            </a>
          ) : null}
          {aviso.captcha ? (
            <Boton
              variante="contorno"
              className="w-full"
              onClick={() => {
                setAviso(null);
                setIntentoWidget((n) => n + 1);
              }}
            >
              Reintentar
            </Boton>
          ) : null}
        </div>
      ) : null}

      <BarraInferior>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{formatearPrecio(totalPrecio(estado), moneda)}</p>
          <p className="text-muted-foreground text-sm">{formatearDuracion(totalDuracion(estado))}</p>
        </div>
        <Boton type="submit" form={ID_FORMULARIO} disabled={enEspera} className="flex-[2]">
          {crear.isPending ? 'Confirmando…' : token === null ? 'Verificando…' : 'Confirmar reserva'}
        </Boton>
      </BarraInferior>
    </div>
  );
}
