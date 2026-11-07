import { useEffect, useRef } from 'react';

/** Lo poco de la API de Cloudflare Turnstile que usamos. */
interface ApiTurnstile {
  render: (
    contenedor: HTMLElement,
    opciones: {
      sitekey: string;
      appearance?: 'always' | 'execute' | 'interaction-only';
      callback: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
    },
  ) => string;
  reset: (idWidget?: string) => void;
  remove: (idWidget?: string) => void;
}

declare global {
  interface Window {
    /** Lo pone el script de Cloudflare cargado en `index.html`. */
    turnstile?: ApiTurnstile;
  }
}

interface Props {
  /** Clave pública del sitio (`VITE_TURNSTILE_SITE_KEY`). */
  claveSitio: string | undefined;
  /** Token verificado, o `null` cuando deja de valer (caducó o se pidió reiniciar). */
  alCambiarToken: (token: string | null) => void;
  /** El widget no pudo cargarse o falló. */
  alFallar: () => void;
  /** Cada vez que sube, se pide un token nuevo: un token solo sirve para una petición. */
  reinicios: number;
}

/** Cuánto se espera al script de Cloudflare antes de darlo por perdido. */
const INTENTOS_MAXIMOS = 50;
const ESPERA_MS = 200;

/**
 * Widget de Turnstile en modo discreto: solo se ve si Cloudflare necesita
 * que el cliente haga algo. El script se carga con `async` desde
 * `index.html`, así que puede no estar listo cuando se monta el componente.
 */
export function Turnstile({ claveSitio, alCambiarToken, alFallar, reinicios }: Props) {
  const contenedor = useRef<HTMLDivElement>(null);
  const idWidget = useRef<string | null>(null);

  // Los avisos van por referencia para que cambiar de función no recree el widget.
  const avisos = useRef({ alCambiarToken, alFallar });
  avisos.current = { alCambiarToken, alFallar };

  useEffect(() => {
    if (!claveSitio) {
      console.error('Falta VITE_TURNSTILE_SITE_KEY: el formulario no puede verificar al cliente.');
      avisos.current.alFallar();
      return;
    }

    let cancelado = false;
    let temporizador: ReturnType<typeof setInterval> | undefined;

    const pintar = (): boolean => {
      if (cancelado || !contenedor.current || !window.turnstile) return false;
      idWidget.current = window.turnstile.render(contenedor.current, {
        sitekey: claveSitio,
        appearance: 'interaction-only',
        callback: (token) => avisos.current.alCambiarToken(token),
        'expired-callback': () => avisos.current.alCambiarToken(null),
        'error-callback': () => avisos.current.alFallar(),
      });
      return true;
    };

    if (!pintar()) {
      let intentos = 0;
      temporizador = setInterval(() => {
        if (pintar()) {
          clearInterval(temporizador);
        } else if (++intentos >= INTENTOS_MAXIMOS) {
          clearInterval(temporizador);
          avisos.current.alFallar();
        }
      }, ESPERA_MS);
    }

    return () => {
      cancelado = true;
      clearInterval(temporizador);
      if (idWidget.current !== null) {
        window.turnstile?.remove(idWidget.current);
        idWidget.current = null;
      }
    };
  }, [claveSitio]);

  // El primer valor de `reinicios` es el montaje: solo se reinicia cuando sube.
  const reiniciosVistos = useRef(reinicios);
  useEffect(() => {
    if (reiniciosVistos.current === reinicios) return;
    reiniciosVistos.current = reinicios;
    avisos.current.alCambiarToken(null);
    if (idWidget.current !== null) window.turnstile?.reset(idWidget.current);
  }, [reinicios]);

  return <div ref={contenedor} />;
}
