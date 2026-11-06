import { useState, type ReactNode } from 'react';
import { Turnstile } from '@/componentes/turnstile';
import { Aviso } from '@/componentes/ui/aviso';
import { Boton } from '@/componentes/ui/boton';

/**
 * El captcha rechazado llega con el mensaje genérico de `VALIDACION`
 * («Revisa los datos del formulario»), que no le sirve al cliente: el captcha
 * no es algo que él haya escrito. Es, con el de abajo, el único texto de las
 * pantallas con captcha que no sale de `MENSAJES_ERROR`.
 */
export const TEXTO_CAPTCHA = 'No pudimos verificar que eres una persona. Inténtalo de nuevo.';

/**
 * El widget de verificación no cargó (falta la clave o el script no llegó):
 * es un fallo nuestro o de un bloqueador, no de la conexión del cliente, así
 * que no se le dice «revisa tu conexión».
 */
export const TEXTO_VERIFICACION_NO_CARGA =
  'No pudimos cargar la verificación de seguridad. Recarga la página o inténtalo en unos minutos.';

export interface Captcha {
  /** Token verificado, o `null` mientras no hay uno válido. */
  token: string | null;
  /** El widget, para pintarlo donde convenga. */
  widget: ReactNode;
  /** Un token sirve una sola petición: tras cada intento, sea cual sea su resultado, se pide otro. */
  pedirOtro: () => void;
  /** El widget no pudo cargarse. */
  fallo: boolean;
  /** Vuelve a montar el widget tras un fallo de carga. */
  reintentarWidget: () => void;
}

/**
 * El ciclo de vida de Turnstile en una pantalla con captcha: el token, su
 * renovación tras cada intento y el reintento si el widget no cargó. Lo usan el
 * paso de datos del asistente y la gestión de la cita; si Turnstile cambia algo,
 * se arregla aquí.
 */
export function useCaptcha(): Captcha {
  const [token, setToken] = useState<string | null>(null);
  const [reinicios, setReinicios] = useState(0);
  const [intentoWidget, setIntentoWidget] = useState(0);
  const [fallo, setFallo] = useState(false);

  return {
    token,
    fallo,
    pedirOtro: () => {
      setToken(null);
      setReinicios((n) => n + 1);
    },
    reintentarWidget: () => {
      setFallo(false);
      setIntentoWidget((n) => n + 1);
    },
    widget: (
      <Turnstile
        key={intentoWidget}
        claveSitio={import.meta.env.VITE_TURNSTILE_SITE_KEY}
        reinicios={reinicios}
        alCambiarToken={setToken}
        alFallar={() => setFallo(true)}
      />
    ),
  };
}

/** El aviso de que la verificación no cargó, con su salida. */
export function AvisoVerificacionNoCarga({ alReintentar }: { alReintentar: () => void }) {
  return (
    <div className="space-y-3">
      <Aviso>{TEXTO_VERIFICACION_NO_CARGA}</Aviso>
      <Boton variante="contorno" className="w-full" onClick={alReintentar}>
        Reintentar
      </Boton>
    </div>
  );
}
