import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  CODIGOS_ERROR,
  MENSAJES_ERROR,
  type DiaCalendarioPublico,
  type HuecoPublico,
  type MiReservaPublica,
  type OpcionesPublicas,
} from '@cds/shared';
import { ErrorApi, guardarTokenGestion, peticion } from '@/lib/api';
import { Cita } from './cita';

vi.mock('@/lib/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/api')>();
  return { ...real, peticion: vi.fn(), guardarTokenGestion: vi.fn() };
});

// ---------------------------------------------------------------- datos de prueba

const TOKEN_VIEJO = 'token-viejo-0123456789';
const TOKEN_NUEVO = 'token-nuevo-9876543210';
const TOKEN_OTRO = 'token-otro-5555555555';

const barberoAndres = { id: '33333333-3333-4333-8333-333333333331', nombre: 'Andrés', bio: null, fotoUrl: null };
const SEDE_ID = '11111111-1111-4111-8111-111111111111';
const SERVICIO_ID = '22222222-2222-4222-8222-222222222221';

const OPCIONES: OpcionesPublicas = {
  sedes: [
    {
      id: SEDE_ID,
      nombre: 'Sede Centro',
      direccion: 'Calle 10 #5-20',
      ciudad: 'Medellín',
      telefono: null,
      mapsUrl: null,
      barberos: [barberoAndres],
    },
  ],
  servicios: [
    {
      id: SERVICIO_ID,
      nombre: 'Corte clásico',
      descripcion: null,
      incluye: [],
      precio: 25000,
      duracionMinutos: 30,
    },
  ],
  config: {
    permiteElegirBarbero: false,
    maxDiasAnticipacion: 14,
    minAntelacionMinutos: 60,
    zonaHoraria: 'America/Bogota',
    moneda: 'COP',
    nombreNegocio: 'Caballeros del Señor',
  },
};

const CALENDARIO: DiaCalendarioPublico[] = [
  { fecha: '2026-11-09', hayHueco: true },
  { fecha: '2026-11-11', hayHueco: true },
];

const HUECOS: HuecoPublico[] = [
  { inicioEn: '2026-11-09T14:30:00.000Z', hora: '09:30', disponible: true },
  { inicioEn: '2026-11-09T15:00:00.000Z', hora: '10:00', disponible: true },
];

function cita(cambios: Partial<MiReservaPublica> = {}): MiReservaPublica {
  return {
    codigo: 'CDS-7F3K2M',
    estado: 'CONFIRMADA',
    inicioEn: '2026-11-12T15:00:00.000Z',
    finEn: '2026-11-12T15:30:00.000Z',
    sede: OPCIONES.sedes[0],
    barbero: barberoAndres,
    servicios: [{ servicioId: SERVICIO_ID, nombre: 'Corte clásico', precio: 25000, duracionMinutos: 30 }],
    total: 25000,
    puedeCancelar: true,
    puedeReprogramar: true,
    ...cambios,
  };
}

// ------------------------------------------------------------------ doble de la API

const peticionDoblada = vi.mocked(peticion);
const tokenGuardado = vi.mocked(guardarTokenGestion);

/** Lo que haría el servidor: solo el token vigente abre la cita. */
let tokenVigente: string | null;
let citaActual: MiReservaPublica;
let alCancelar: () => Promise<unknown>;
let alReprogramar: (cuerpo: unknown) => Promise<unknown>;
let datosOpciones: OpcionesPublicas;

type Opciones = { method?: string; body?: unknown } | undefined;

const llamadasA = (metodo: 'GET' | 'POST', ruta: string) =>
  peticionDoblada.mock.calls.filter(([r, o]) => (r === ruta || r.startsWith(`${ruta}?`)) && ((o as Opciones)?.method ?? 'GET') === metodo);

/** El token que el cliente HTTP mandaría ahora: el último que se le dio. */
const tokenEnviado = () => tokenGuardado.mock.calls.at(-1)?.[0] ?? null;

function exigirTokenVigente() {
  if (tokenEnviado() !== tokenVigente) {
    throw new ErrorApi(CODIGOS_ERROR.TOKEN_INVALIDO, MENSAJES_ERROR.TOKEN_INVALIDO, 401);
  }
}

beforeEach(() => {
  tokenVigente = TOKEN_VIEJO;
  citaActual = cita();
  datosOpciones = OPCIONES;
  alCancelar = async () => ({ ...citaActual, estado: 'CANCELADA', puedeCancelar: false, puedeReprogramar: false });
  alReprogramar = async () => ({ ...cita({ inicioEn: '2026-11-09T14:30:00.000Z' }), tokenGestion: TOKEN_NUEVO });

  peticionDoblada.mockImplementation((async (ruta: string, opciones?: Opciones) => {
    if (ruta.startsWith('/publico/opciones')) return datosOpciones;
    // El calendario de quien reprograma también excluye la propia cita.
    if (ruta.startsWith('/publico/mi-reserva/calendario')) {
      exigirTokenVigente();
      return CALENDARIO;
    }
    // La rejilla de quien reprograma va por la ruta que excluye la propia cita.
    if (ruta.startsWith('/publico/mi-reserva/disponibilidad')) {
      exigirTokenVigente();
      return { fecha: '2026-11-09', laborable: true, huecos: HUECOS };
    }
    if (ruta === '/publico/mi-reserva' && !opciones?.method) {
      if (tokenEnviado() === TOKEN_OTRO) return cita({ codigo: 'CDS-OTRA00' });
      exigirTokenVigente();
      return citaActual;
    }
    if (ruta === '/publico/mi-reserva/cancelar') {
      exigirTokenVigente();
      return alCancelar();
    }
    if (ruta === '/publico/mi-reserva/reprogramar') {
      exigirTokenVigente();
      const respuesta = (await alReprogramar(opciones?.body)) as { tokenGestion?: string };
      if (respuesta.tokenGestion) tokenVigente = respuesta.tokenGestion;
      return respuesta;
    }
    throw new Error(`Ruta sin doblar: ${ruta}`);
  }) as typeof peticion);

  // Solo se falsea la fecha: los temporizadores reales hacen falta para `waitFor`.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-06T17:00:00Z'));

  // Turnstile entrega un token en cuanto se pinta el widget; `reset` pide otro.
  let numero = 0;
  let alRenderizar: ((token: string) => void) | null = null;
  vi.stubGlobal('turnstile', {
    render: vi.fn((_c: unknown, o: { callback: (token: string) => void }) => {
      alRenderizar = o.callback;
      o.callback(`captcha-${++numero}`);
      return `widget-${numero}`;
    }),
    reset: vi.fn(() => alRenderizar?.(`captcha-${++numero}`)),
    remove: vi.fn(),
  });
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '1x00000000000000000000AA');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// ------------------------------------------------------------------------ montaje

let ubicacion = { pathname: '', search: '', hash: '' };
function SondaUbicacion() {
  ubicacion = useLocation();
  const navegar = useNavigate();
  // Pegar otro enlace de gestión en la misma pestaña solo cambia el fragmento.
  return <button onClick={() => navegar({ hash: TOKEN_OTRO })}>(pegar otro enlace)</button>;
}

function montar(ruta = `/cita#${TOKEN_VIEJO}`) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[ruta]}>
        <SondaUbicacion />
        <Routes>
          <Route path="/cita" element={<Cita />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const usuario = () => userEvent.setup();
const botonCancelar = () => screen.getByRole('button', { name: /cancelar mi cita/i });
const botonReprogramar = () => screen.getByRole('button', { name: /cambiar fecha u hora/i });
const botonConfirmarCambio = () => screen.getByRole('button', { name: /confirmar el cambio/i });

async function hastaDetalle() {
  await screen.findByText('CDS-7F3K2M');
}

// ================================================================ el token

describe('el token del enlace', () => {
  it('lo lee del fragmento y lo entrega al cliente HTTP antes de consultar', async () => {
    montar();
    await hastaDetalle();
    expect(tokenGuardado).toHaveBeenCalledWith(TOKEN_VIEJO);
    expect(llamadasA('GET', '/publico/mi-reserva')).toHaveLength(1);
  });

  it('no viaja en la ruta, ni en la query, ni se pinta en la pantalla', async () => {
    montar();
    await hastaDetalle();
    const rutas = peticionDoblada.mock.calls.map(([r]) => r);
    expect(rutas.some((r) => r.includes(TOKEN_VIEJO))).toBe(false);
    expect(document.body.innerHTML).not.toContain(TOKEN_VIEJO);
    expect(ubicacion.search).toBe('');
  });

  it('sin fragmento no consulta a la API: dice que el enlace no vale y lleva a reservar', async () => {
    montar('/cita');
    expect(await screen.findByRole('alert')).toHaveTextContent(MENSAJES_ERROR.TOKEN_INVALIDO);
    expect(llamadasA('GET', '/publico/mi-reserva')).toHaveLength(0);
    expect(screen.getByRole('link', { name: /reservar una cita/i })).toHaveAttribute('href', '/');
  });

  it('con un token inventado avisa que el enlace no es válido', async () => {
    montar('/cita#inventado');
    expect(await screen.findByRole('alert')).toHaveTextContent(MENSAJES_ERROR.TOKEN_INVALIDO);
    expect(screen.getByRole('link', { name: /reservar una cita/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancelar mi cita/i })).not.toBeInTheDocument();
  });

  it('si falla la conexión ofrece reintentar', async () => {
    const u = usuario();
    // Una caída de red se reintenta una vez sola; si persiste, el cliente decide.
    const caida = new ErrorApi(CODIGOS_ERROR.ERROR_RED, MENSAJES_ERROR.ERROR_RED, 0);
    peticionDoblada.mockRejectedValueOnce(caida).mockRejectedValueOnce(caida);
    montar();
    expect(await screen.findByRole('alert')).toHaveTextContent(MENSAJES_ERROR.ERROR_RED);
    await u.click(screen.getByRole('button', { name: /reintentar/i }));
    await hastaDetalle();
  });
});

// ================================================================ otro enlace en la pestaña

describe('pegar otro enlace de gestión en la misma pestaña', () => {
  it('muestra la cita del enlace nuevo, no se queda con la anterior', async () => {
    const u = usuario();
    montar();
    await hastaDetalle();
    await u.click(screen.getByRole('button', { name: /pegar otro enlace/ }));
    expect(await screen.findByText('CDS-OTRA00')).toBeInTheDocument();
    expect(screen.queryByText('CDS-7F3K2M')).not.toBeInTheDocument();
    expect(tokenGuardado).toHaveBeenLastCalledWith(TOKEN_OTRO);
  });

  it('y quita el aviso de la cita anterior: no mezcla lo de una con la otra', async () => {
    const u = usuario();
    montar();
    await reprogramarALas930(u);
    await screen.findByText(/quedó reprogramada/);
    // El token vigente cambió a TOKEN_NUEVO; el usuario pega TOKEN_OTRO.
    await u.click(screen.getByRole('button', { name: /pegar otro enlace/ }));
    expect(await screen.findByText('CDS-OTRA00')).toBeInTheDocument();
    expect(screen.queryByText(/quedó reprogramada/)).not.toBeInTheDocument();
  });

  it('reprogramar no se confunde con pegar otro enlace: la pantalla no se reinicia', async () => {
    const u = usuario();
    montar();
    await reprogramarALas930(u);
    // El hash cambió por nuestra propia acción: el aviso sigue ahí.
    expect(await screen.findByText(/quedó reprogramada/)).toBeInTheDocument();
  });
});

// ================================================================ ver la cita

describe('ver la cita', () => {
  it('muestra el código, la fecha en la zona del negocio, los servicios, la sede y el barbero', async () => {
    montar();
    await hastaDetalle();
    expect(screen.getByText(/jueves, 12 de noviembre · 10:00 a\. m\./)).toBeInTheDocument();
    expect(screen.getByText('Corte clásico')).toBeInTheDocument();
    expect(screen.getByText(/Sede Centro/)).toBeInTheDocument();
    expect(screen.getByText(/Andrés/)).toBeInTheDocument();
    expect(screen.getAllByText(/25\.000/).length).toBeGreaterThan(0);
    expect(screen.getByText('Confirmada')).toBeInTheDocument();
  });
});

// ================================================================ los plazos

describe('los dos plazos son independientes', () => {
  it('desactiva cancelar con el motivo a la vista cuando puedeCancelar es false', async () => {
    citaActual = cita({ puedeCancelar: false });
    montar();
    await hastaDetalle();
    expect(botonCancelar()).toBeDisabled();
    expect(screen.getByText(MENSAJES_ERROR.FUERA_DE_PLAZO_CANCELACION)).toBeInTheDocument();
    expect(botonReprogramar()).toBeEnabled();
  });

  it('desactiva reprogramar con su propio motivo cuando puedeReprogramar es false', async () => {
    citaActual = cita({ puedeReprogramar: false });
    montar();
    await hastaDetalle();
    expect(botonReprogramar()).toBeDisabled();
    expect(screen.getByText(MENSAJES_ERROR.FUERA_DE_PLAZO_REPROGRAMACION)).toBeInTheDocument();
    expect(botonCancelar()).toBeEnabled();
  });

  it('una cita que ya no admite acciones lo explica con el motivo del estado, no con un plazo', async () => {
    citaActual = cita({ estado: 'COMPLETADA', puedeCancelar: false, puedeReprogramar: false });
    montar();
    await hastaDetalle();
    expect(screen.getAllByText(MENSAJES_ERROR.ESTADO_RESERVA_INVALIDO)).toHaveLength(2);
    expect(screen.queryByText(MENSAJES_ERROR.FUERA_DE_PLAZO_CANCELACION)).not.toBeInTheDocument();
  });
});

// ================================================================ cancelar

describe('cancelar', () => {
  it('pide confirmación y no cancela de un toque', async () => {
    const u = usuario();
    montar();
    await hastaDetalle();
    await u.click(botonCancelar());

    expect(await screen.findByText(/¿Seguro que quieres cancelar/)).toBeInTheDocument();
    expect(llamadasA('POST', '/publico/mi-reserva/cancelar')).toHaveLength(0);

    // «Conservar» vuelve al detalle sin escribir nada.
    await u.click(screen.getByRole('button', { name: /conservar mi cita/i }));
    await hastaDetalle();
    expect(llamadasA('POST', '/publico/mi-reserva/cancelar')).toHaveLength(0);
  });

  it('al confirmar manda el captcha, muestra que quedó cancelada y no vuelve a consultar', async () => {
    const u = usuario();
    montar();
    await hastaDetalle();
    await u.click(botonCancelar());
    await u.click(await screen.findByRole('button', { name: /sí, cancelar/i }));

    expect(await screen.findByText(/quedó cancelada/)).toBeInTheDocument();
    const [[, opciones]] = llamadasA('POST', '/publico/mi-reserva/cancelar');
    expect((opciones as Opciones)?.body).toMatchObject({ tokenTurnstile: 'captcha-1' });
    // El enlace murió con la cancelación: consultar otra vez daría TOKEN_INVALIDO.
    expect(llamadasA('GET', '/publico/mi-reserva')).toHaveLength(1);
    expect(tokenGuardado).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole('button', { name: /cancelar mi cita/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /reservar otra cita/i })).toHaveAttribute('href', '/');
  });

  it('no consulta de nuevo ni al recuperar el foco de la ventana', async () => {
    const u = usuario();
    montar();
    await hastaDetalle();
    await u.click(botonCancelar());
    await u.click(await screen.findByRole('button', { name: /sí, cancelar/i }));
    await screen.findByText(/quedó cancelada/);
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 20));
    expect(llamadasA('GET', '/publico/mi-reserva')).toHaveLength(1);
  });

  it('si la cita ya no admite la cancelación dice por qué y la relee, sin ofrecer repetir', async () => {
    const u = usuario();
    alCancelar = async () => {
      citaActual = cita({ estado: 'CANCELADA', puedeCancelar: false, puedeReprogramar: false });
      throw new ErrorApi(CODIGOS_ERROR.ESTADO_RESERVA_INVALIDO, 'x', 409);
    };
    montar();
    await hastaDetalle();
    await u.click(botonCancelar());
    await u.click(await screen.findByRole('button', { name: /sí, cancelar/i }));

    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent(MENSAJES_ERROR.ESTADO_RESERVA_INVALIDO);
    await waitFor(() => expect(botonCancelar()).toBeDisabled());
    expect(screen.getByText('Cancelada')).toBeInTheDocument();
  });

  it('si el captcha se rechaza no habla de datos del formulario y pide otro captcha', async () => {
    const u = usuario();
    alCancelar = async () => {
      throw new ErrorApi(CODIGOS_ERROR.VALIDACION, 'x', 400, { tokenTurnstile: ['inválido'] });
    };
    montar();
    await hastaDetalle();
    await u.click(botonCancelar());
    await u.click(await screen.findByRole('button', { name: /sí, cancelar/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/verificar que eres una persona/);
    await waitFor(() => expect(screen.getByRole('button', { name: /sí, cancelar/i })).toBeEnabled());

    // El captcha anterior ya se gastó: el siguiente intento lleva uno nuevo.
    alCancelar = async () => ({ ...citaActual, estado: 'CANCELADA' });
    await u.click(screen.getByRole('button', { name: /sí, cancelar/i }));
    await screen.findByText(/quedó cancelada/);
    const [, segunda] = llamadasA('POST', '/publico/mi-reserva/cancelar');
    expect((segunda[1] as Opciones)?.body).toMatchObject({ tokenTurnstile: 'captcha-2' });
  });
});

// ================================================================ verificación y accesibilidad

describe('mientras el captcha no entrega token', () => {
  /** El widget se pinta pero no entrega nada: el cliente no ha pasado la verificación todavía. */
  function sinToken() {
    vi.stubGlobal('turnstile', { render: vi.fn(() => 'w'), reset: vi.fn(), remove: vi.fn() });
  }

  it('«Sí, cancelar» dice «Verificando…» en vez de quedarse muerto', async () => {
    const u = usuario();
    montar();
    await hastaDetalle();
    sinToken();
    await u.click(botonCancelar());
    const boton = await screen.findByRole('button', { name: /verificando/i });
    expect(boton).toBeDisabled();
    expect(screen.queryByRole('button', { name: /sí, cancelar/i })).not.toBeInTheDocument();
  });

  it('«Confirmar el cambio» dice «Verificando…» hasta tener token', async () => {
    const u = usuario();
    montar();
    await hastaDetalle();
    sinToken();
    await u.click(botonReprogramar());
    await u.click(await screen.findByRole('button', { name: /lunes, 9 de noviembre/ }));
    await u.click(await screen.findByRole('button', { name: '9:30 a. m.' }));
    expect(await screen.findByRole('button', { name: /verificando/i })).toBeDisabled();
  });
});

describe('el motivo de un botón desactivado se lee con lector de pantalla', () => {
  it('cancelar lo describe con su motivo', async () => {
    citaActual = cita({ puedeCancelar: false });
    montar();
    await hastaDetalle();
    expect(botonCancelar()).toHaveAccessibleDescription(MENSAJES_ERROR.FUERA_DE_PLAZO_CANCELACION);
  });

  it('reprogramar lo describe con el suyo', async () => {
    citaActual = cita({ puedeReprogramar: false });
    montar();
    await hastaDetalle();
    expect(botonReprogramar()).toHaveAccessibleDescription(MENSAJES_ERROR.FUERA_DE_PLAZO_REPROGRAMACION);
  });

  it('un botón activo no lleva descripción', async () => {
    montar();
    await hastaDetalle();
    expect(botonCancelar()).not.toHaveAttribute('aria-describedby');
  });
});

// ================================================================ reprogramar

async function hastaHoras(u: ReturnType<typeof usuario>) {
  await hastaDetalle();
  await u.click(botonReprogramar());
  await u.click(await screen.findByRole('button', { name: /lunes, 9 de noviembre/ }));
}

async function reprogramarALas930(u: ReturnType<typeof usuario>) {
  await hastaHoras(u);
  await u.click(await screen.findByRole('button', { name: '9:30 a. m.' }));
  await u.click(botonConfirmarCambio());
}

describe('reprogramar', () => {
  it('reutiliza los pasos de fecha y hora con la sede y los servicios de la cita', async () => {
    const u = usuario();
    montar();
    await hastaHoras(u);
    await screen.findByRole('button', { name: '9:30 a. m.' });
    const [[ruta]] = peticionDoblada.mock.calls.filter(([r]) => r.startsWith('/publico/mi-reserva/calendario'));
    expect(ruta).toContain(`sedeId=${SEDE_ID}`);
    expect(ruta).toContain(`servicioIds=${SERVICIO_ID}`);
  });

  it('GUARDA EL TOKEN NUEVO y lo pone en la URL: recargar no pierde la cita', async () => {
    const u = usuario();
    const { unmount } = montar();
    await reprogramarALas930(u);

    expect(await screen.findByText(/quedó reprogramada/)).toBeInTheDocument();
    const [[, opciones]] = llamadasA('POST', '/publico/mi-reserva/reprogramar');
    expect((opciones as Opciones)?.body).toEqual({
      inicioEn: '2026-11-09T14:30:00.000Z',
      tokenTurnstile: 'captcha-1',
    });

    expect(tokenGuardado).toHaveBeenLastCalledWith(TOKEN_NUEVO);
    expect(ubicacion.pathname).toBe('/cita');
    expect(ubicacion.hash).toBe(`#${TOKEN_NUEVO}`);
    // El token no se pinta, ni siquiera el nuevo.
    expect(document.body.innerHTML).not.toContain(TOKEN_NUEVO);

    // El cliente recarga: lo único que le queda es la URL, y con ella se abre la cita.
    const urlTrasReprogramar = `/cita${ubicacion.hash}`;
    unmount();
    tokenGuardado.mockClear(); // una recarga empieza con el cliente HTTP en blanco
    montar(urlTrasReprogramar);
    await hastaDetalle();
  });

  it('el enlace anterior ya no abre la cita', async () => {
    const u = usuario();
    const { unmount } = montar();
    await reprogramarALas930(u);
    await screen.findByText(/quedó reprogramada/);
    unmount();

    montar(`/cita#${TOKEN_VIEJO}`);
    expect(await screen.findByRole('alert')).toHaveTextContent(MENSAJES_ERROR.TOKEN_INVALIDO);
  });

  it('avisa que el enlace cambió y deja copiar el nuevo sin escribirlo en pantalla', async () => {
    const u = usuario();
    const escribir = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: escribir } });
    montar();
    await reprogramarALas930(u);
    await screen.findByText(/quedó reprogramada/);

    expect(screen.getByText(/enlace anterior ya no sirve/i)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: /copiar enlace nuevo/i }));
    expect(escribir).toHaveBeenCalledWith(expect.stringContaining(`/cita#${TOKEN_NUEVO}`));
  });

  it('manda el barbero solo si el negocio deja elegirlo, partiendo del de la cita', async () => {
    const u = usuario();
    datosOpciones = { ...OPCIONES, config: { ...OPCIONES.config, permiteElegirBarbero: true } };
    montar();
    await hastaHoras(u);
    expect(await screen.findByLabelText('Barbero')).toHaveValue(barberoAndres.id);
    await u.click(await screen.findByRole('button', { name: '9:30 a. m.' }));
    await u.click(botonConfirmarCambio());
    await screen.findByText(/quedó reprogramada/);
    const [[, opciones]] = llamadasA('POST', '/publico/mi-reserva/reprogramar');
    expect((opciones as Opciones)?.body).toMatchObject({ barberoId: barberoAndres.id });
  });

  it('CONFLICTO: relee la cita y dice que cambió, sin el texto de panel', async () => {
    const u = usuario();
    alReprogramar = async () => {
      citaActual = cita({ inicioEn: '2026-11-13T15:00:00.000Z', finEn: '2026-11-13T15:30:00.000Z' });
      throw new ErrorApi(CODIGOS_ERROR.CONFLICTO, MENSAJES_ERROR.CONFLICTO, 409);
    };
    montar();
    await reprogramarALas930(u);

    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent(/tu cita cambió/i);
    expect(aviso).not.toHaveTextContent(/recarga/i);
    // Muestra lo que figura ahora, no lo que se leyó antes.
    expect(await screen.findByText(/viernes, 13 de noviembre/)).toBeInTheDocument();
    expect(llamadasA('GET', '/publico/mi-reserva')).toHaveLength(2);
  });

  it('si la hora se ocupó, lo dice y vuelve a la rejilla sin perder el día', async () => {
    const u = usuario();
    alReprogramar = async () => {
      throw new ErrorApi(CODIGOS_ERROR.RESERVA_SOLAPADA, 'x', 409);
    };
    montar();
    await reprogramarALas930(u);

    expect(await screen.findByRole('alert')).toHaveTextContent(MENSAJES_ERROR.RESERVA_SOLAPADA);
    expect(screen.getByRole('button', { name: '10:00 a. m.' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirmar el cambio/i })).not.toBeInTheDocument();
  });

  it('no ofrece confirmar mientras no haya una hora elegida', async () => {
    const u = usuario();
    montar();
    await hastaHoras(u);
    await screen.findByRole('button', { name: '9:30 a. m.' });
    expect(screen.queryByRole('button', { name: /confirmar el cambio/i })).not.toBeInTheDocument();
  });

  it('un servicio renombrado en el catálogo no impide reprogramar: se pide la agenda por id', async () => {
    const u = usuario();
    citaActual = cita({
      servicios: [{ servicioId: SERVICIO_ID, nombre: 'Corte (nombre antiguo)', precio: 25000, duracionMinutos: 30 }],
    });
    montar();
    await hastaDetalle();
    expect(botonReprogramar()).toBeEnabled();
    await u.click(botonReprogramar());
    await u.click(await screen.findByRole('button', { name: /lunes, 9 de noviembre/ }));
    await screen.findByRole('button', { name: '9:30 a. m.' });
    const [[ruta]] = peticionDoblada.mock.calls.filter(([r]) => r.startsWith('/publico/mi-reserva/disponibilidad'));
    expect(ruta).toContain(`servicioIds=${SERVICIO_ID}`);
  });

  it('el calendario sale de la ruta que excluye la propia cita: un día lleno salvo la suya sigue pulsable', async () => {
    const u = usuario();
    montar();
    await hastaHoras(u);
    expect(llamadasA('GET', '/publico/calendario')).toHaveLength(0);
    expect(llamadasA('GET', '/publico/mi-reserva/calendario')).toHaveLength(1);
    await screen.findByRole('button', { name: '9:30 a. m.' });
  });

  it('la rejilla sale de la ruta que excluye la propia cita, no de la pública', async () => {
    const u = usuario();
    montar();
    await hastaHoras(u);
    await screen.findByRole('button', { name: '9:30 a. m.' });
    expect(llamadasA('GET', '/publico/disponibilidad')).toHaveLength(0);
    expect(llamadasA('GET', '/publico/mi-reserva/disponibilidad')).toHaveLength(1);
  });

  it('«Volver» deja la cita como estaba sin escribir nada', async () => {
    const u = usuario();
    montar();
    await hastaDetalle();
    await u.click(botonReprogramar());
    await u.click(await screen.findByRole('button', { name: /volver/i }));
    await hastaDetalle();
    expect(llamadasA('POST', '/publico/mi-reserva/reprogramar')).toHaveLength(0);
  });
});
