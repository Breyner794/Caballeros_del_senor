import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  CODIGOS_ERROR,
  MENSAJES_ERROR,
  type DiaCalendarioPublico,
  type HuecoPublico,
  type OpcionesPublicas,
  type ReservaPublica,
} from '@cds/shared';
import { ErrorApi, peticion } from '@/lib/api';
import { Reservar } from './index';

vi.mock('@/lib/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/api')>();
  return { ...real, peticion: vi.fn() };
});

// ---------------------------------------------------------------- datos de prueba

const barberoAndres = { id: '33333333-3333-4333-8333-333333333331', nombre: 'Andrés', bio: null, fotoUrl: null };
const barberoMario = { id: '33333333-3333-4333-8333-333333333332', nombre: 'Mario', bio: null, fotoUrl: null };
const barberoLuis = { id: '33333333-3333-4333-8333-333333333333', nombre: 'Luis', bio: null, fotoUrl: null };

function opciones(permiteElegirBarbero = true): OpcionesPublicas {
  return {
    sedes: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        nombre: 'Sede Centro',
        direccion: 'Calle 10 #5-20',
        ciudad: 'Medellín',
        telefono: null,
        mapsUrl: null,
        barberos: [barberoAndres, barberoMario],
      },
      {
        id: '11111111-1111-4111-8111-222222222222',
        nombre: 'Sede Norte',
        direccion: 'Carrera 70 #45-10',
        ciudad: 'Medellín',
        telefono: null,
        mapsUrl: null,
        barberos: [barberoLuis],
      },
    ],
    servicios: [
      {
        id: '22222222-2222-4222-8222-222222222221',
        nombre: 'Corte clásico',
        descripcion: 'Tijera y máquina',
        incluye: [],
        precio: 25000,
        duracionMinutos: 30,
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        nombre: 'Barba',
        descripcion: null,
        incluye: [],
        precio: 15000,
        duracionMinutos: 20,
      },
    ],
    config: {
      permiteElegirBarbero,
      maxDiasAnticipacion: 14,
      minAntelacionMinutos: 60,
      zonaHoraria: 'America/Bogota',
      moneda: 'COP',
      nombreNegocio: 'Caballeros del Señor',
    },
  };
}

const CALENDARIO: DiaCalendarioPublico[] = [
  { fecha: '2026-11-09', hayHueco: true },
  { fecha: '2026-11-10', hayHueco: false },
  { fecha: '2026-11-11', hayHueco: true },
];

const HUECOS: HuecoPublico[] = [
  { inicioEn: '2026-11-09T14:30:00.000Z', hora: '09:30', disponible: true },
  { inicioEn: '2026-11-09T15:00:00.000Z', hora: '10:00', disponible: true },
  { inicioEn: '2026-11-09T15:30:00.000Z', hora: '10:30', disponible: true },
];

const RESERVA: ReservaPublica & { tokenGestion: string } = {
  codigo: 'CDS-7F3K2M',
  estado: 'PENDIENTE',
  inicioEn: '2026-11-09T14:30:00.000Z',
  finEn: '2026-11-09T15:00:00.000Z',
  sede: {
    id: '11111111-1111-4111-8111-111111111111',
    nombre: 'Sede Centro',
    direccion: 'Calle 10 #5-20',
    ciudad: 'Medellín',
    telefono: null,
    mapsUrl: null,
  },
  barbero: barberoAndres,
  servicios: [{ nombre: 'Corte clásico', precio: 25000, duracionMinutos: 30 }],
  total: 25000,
  tokenGestion: 'tok-abc',
};

// ------------------------------------------------------------------ doble de la API

const peticionDoblada = vi.mocked(peticion);
let datosOpciones: OpcionesPublicas;
let huecosDia: HuecoPublico[];
let alReservar: () => Promise<unknown>;

function llamadasA(ruta: string) {
  return peticionDoblada.mock.calls.filter(([r]) => r.startsWith(ruta));
}

beforeEach(() => {
  datosOpciones = opciones();
  huecosDia = HUECOS;
  alReservar = async () => RESERVA;
  peticionDoblada.mockImplementation((async (ruta: string) => {
    if (ruta.startsWith('/publico/opciones')) return datosOpciones;
    if (ruta.startsWith('/publico/calendario')) return CALENDARIO;
    if (ruta.startsWith('/publico/disponibilidad')) {
      return { fecha: '2026-11-09', laborable: true, huecos: huecosDia };
    }
    if (ruta.startsWith('/publico/reservas')) return alReservar();
    throw new Error(`Ruta sin doblar: ${ruta}`);
  }) as typeof peticion);

  // Solo se falsea la fecha: los temporizadores reales hacen falta para `waitFor`.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-06T17:00:00Z'));

  // Turnstile entrega el token en cuanto se pinta el widget; `reset` pide otro.
  const turnstile = {
    render: vi.fn((_contenedor: unknown, opciones: { callback: (token: string) => void }) => {
      opciones.callback('token-1');
      alReiniciar = () => opciones.callback('token-2');
      return 'widget-1';
    }),
    reset: vi.fn(() => alReiniciar()),
    remove: vi.fn(),
  };
  vi.stubGlobal('turnstile', turnstile);
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '1x00000000000000000000AA');
});

let alReiniciar: () => void = () => undefined;

afterEach(() => {
  vi.useRealTimers();
});

// ------------------------------------------------------------------------ montaje

let ubicacion = '';
function SondaUbicacion() {
  const { pathname, search } = useLocation();
  ubicacion = pathname + search;
  const navegar = useNavigate();
  return <button onClick={() => navegar(-1)}>(atrás del navegador)</button>;
}

function montar(ruta = '/') {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[ruta]}>
        <SondaUbicacion />
        <Routes>
          <Route path="/" element={<Reservar />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const usuario = () => userEvent.setup();
const continuar = () => screen.getByRole('button', { name: /continuar/i });

async function elegirServicio(u: ReturnType<typeof usuario>) {
  await u.click(await screen.findByRole('radio', { name: /Sede Centro/ }));
  await u.click(screen.getByRole('checkbox', { name: /Corte clásico/ }));
}

async function hastaFecha(u: ReturnType<typeof usuario>) {
  await elegirServicio(u);
  await u.click(continuar());
}

async function hastaHora(u: ReturnType<typeof usuario>) {
  await hastaFecha(u);
  await u.click(await screen.findByRole('button', { name: /lunes, 9 de noviembre/ }));
  await u.click(continuar());
}

async function hastaDatos(u: ReturnType<typeof usuario>) {
  await hastaHora(u);
  await u.click(await screen.findByRole('button', { name: '9:30 a. m.' }));
  await u.click(continuar());
}

async function rellenarDatos(u: ReturnType<typeof usuario>) {
  await u.type(await screen.findByLabelText(/nombre completo/i), 'Carlos Pérez');
  await u.type(screen.getByLabelText(/celular/i), '300 123 4567');
}

const confirmar = () => screen.getByRole('button', { name: /confirmar reserva/i });

// =================================================================== paso: servicio

describe('paso de servicio', () => {
  it('pinta los servicios con su precio y duración', async () => {
    montar();
    const corte = await screen.findByRole('checkbox', { name: /Corte clásico/ });
    expect(corte).toHaveAccessibleName(/25\.000/);
    expect(corte).toHaveAccessibleName(/30 min/);
    expect(screen.getByRole('checkbox', { name: /Barba/ })).toHaveAccessibleName(/20 min/);
  });

  it('el botón de continuar está desactivado hasta elegir un servicio', async () => {
    const u = usuario();
    montar();
    await u.click(await screen.findByRole('radio', { name: /Sede Centro/ }));
    expect(continuar()).toBeDisabled();
    await u.click(screen.getByRole('checkbox', { name: /Corte clásico/ }));
    expect(continuar()).toBeEnabled();
  });

  it('con una sola sede la elige sin preguntar', async () => {
    const u = usuario();
    datosOpciones = { ...opciones(), sedes: [opciones().sedes[0]] };
    montar();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    await u.click(await screen.findByRole('checkbox', { name: /Corte clásico/ }));
    expect(continuar()).toBeEnabled();
  });

  it('suma el precio y la duración al pie', async () => {
    const u = usuario();
    montar();
    await elegirServicio(u);
    await u.click(screen.getByRole('checkbox', { name: /Barba/ }));
    const pie = screen.getByRole('contentinfo');
    expect(pie).toHaveTextContent(/40\.000/);
    expect(pie).toHaveTextContent(/50 min/);
  });

  it('si falla la carga ofrece reintentar en lugar de dejar la pantalla en blanco', async () => {
    const u = usuario();
    peticionDoblada.mockRejectedValueOnce(
      new ErrorApi(CODIGOS_ERROR.ERROR_RED, MENSAJES_ERROR.ERROR_RED, 0),
    );
    montar();
    expect(await screen.findByRole('alert')).toHaveTextContent(MENSAJES_ERROR.ERROR_RED);
    await u.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(await screen.findByRole('checkbox', { name: /Corte clásico/ })).toBeInTheDocument();
  });
});

// ============================================================== paso en la query

describe('paso espejado en la query', () => {
  it('espeja el paso en la query para que el botón atrás retroceda un paso', async () => {
    const u = usuario();
    montar();
    expect(ubicacion).toBe('/');
    await hastaFecha(u);
    await waitFor(() => expect(ubicacion).toBe('/?paso=fecha'));

    await u.click(screen.getByRole('button', { name: /atrás del navegador/ }));
    expect(await screen.findByRole('checkbox', { name: /Corte clásico/ })).toBeInTheDocument();
    await waitFor(() => expect(ubicacion).toBe('/'));
    // Retroceder no pierde lo elegido.
    expect(screen.getByRole('checkbox', { name: /Corte clásico/ })).toBeChecked();
  });

  it('el botón «Atrás» de la pantalla retrocede igual que el del navegador', async () => {
    const u = usuario();
    montar();
    await hastaFecha(u);
    await u.click(screen.getByRole('button', { name: /^atrás$/i }));
    expect(await screen.findByRole('checkbox', { name: /Corte clásico/ })).toBeInTheDocument();
    await waitFor(() => expect(ubicacion).toBe('/'));
  });

  it('una URL con un paso al que no se llegó vuelve al primer paso', async () => {
    montar('/?paso=hora');
    expect(await screen.findByRole('checkbox', { name: /Corte clásico/ })).toBeInTheDocument();
    await waitFor(() => expect(ubicacion).toBe('/'));
  });
});

// ===================================================================== paso: fecha

describe('paso de fecha', () => {
  it('solo habilita los días con hueco', async () => {
    const u = usuario();
    montar();
    await hastaFecha(u);
    expect(await screen.findByRole('button', { name: /lunes, 9 de noviembre/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /martes, 10 de noviembre/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /miércoles, 11 de noviembre/ })).toBeEnabled();
    // Un día que la API ni siquiera menciona tampoco se puede elegir.
    expect(screen.getByRole('button', { name: /jueves, 12 de noviembre/ })).toBeDisabled();
  });

  it('no deja continuar hasta elegir un día', async () => {
    const u = usuario();
    montar();
    await hastaFecha(u);
    await screen.findByRole('button', { name: /lunes, 9 de noviembre/ });
    expect(continuar()).toBeDisabled();
    await u.click(screen.getByRole('button', { name: /lunes, 9 de noviembre/ }));
    expect(continuar()).toBeEnabled();
  });

  it('pide el calendario con los servicios y la sede elegidos', async () => {
    const u = usuario();
    montar();
    await hastaFecha(u);
    await screen.findByRole('button', { name: /lunes, 9 de noviembre/ });
    const [ruta] = llamadasA('/publico/calendario')[0];
    const query = new URLSearchParams(ruta.split('?')[1]);
    expect(query.get('sedeId')).toBe('11111111-1111-4111-8111-111111111111');
    expect(query.getAll('servicioIds')).toEqual(['22222222-2222-4222-8222-222222222221']);
    expect(query.get('desde')).toBe('2026-11-06');
    expect(query.get('hasta')).toBe('2026-11-20');
  });
});

// ====================================================================== paso: hora

describe('paso de hora', () => {
  it('muestra los huecos de la rejilla', async () => {
    const u = usuario();
    montar();
    await hastaHora(u);
    expect(await screen.findByRole('button', { name: '9:30 a. m.' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '10:00 a. m.' })).toBeEnabled();
    expect(continuar()).toBeDisabled();
  });

  it('ofrece «cualquier barbero» por defecto', async () => {
    const u = usuario();
    montar();
    await hastaHora(u);
    const selector = await screen.findByRole('combobox', { name: /barbero/i });
    expect(selector).toHaveValue('');
    expect(within(selector).getByRole('option', { name: /cualquier barbero/i })).toBeInTheDocument();
    // Solo los barberos de la sede elegida.
    expect(within(selector).getByRole('option', { name: 'Andrés' })).toBeInTheDocument();
    expect(within(selector).queryByRole('option', { name: 'Luis' })).not.toBeInTheDocument();
  });

  it('oculta la elección de barbero si permiteElegirBarbero es false', async () => {
    const u = usuario();
    datosOpciones = opciones(false);
    montar();
    await hastaHora(u);
    await screen.findByRole('button', { name: '9:30 a. m.' });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('al elegir un barbero repite la consulta con él y suelta la hora elegida', async () => {
    const u = usuario();
    montar();
    await hastaHora(u);
    await u.click(await screen.findByRole('button', { name: '9:30 a. m.' }));
    expect(continuar()).toBeEnabled();

    await u.selectOptions(screen.getByRole('combobox', { name: /barbero/i }), 'Andrés');
    await waitFor(() => {
      const ultima = llamadasA('/publico/disponibilidad').at(-1)![0];
      expect(new URLSearchParams(ultima.split('?')[1]).get('barberoId')).toBe('33333333-3333-4333-8333-333333333331');
    });
    expect(continuar()).toBeDisabled();
  });
});

// ===================================================================== paso: datos

describe('paso de datos', () => {
  it('no envía nada y señala el campo si el nombre falta', async () => {
    const u = usuario();
    montar();
    await hastaDatos(u);
    await u.type(await screen.findByLabelText(/celular/i), '300 123 4567');
    await u.click(confirmar());
    expect(await screen.findByText(/nombre es obligatorio/i)).toBeInTheDocument();
    expect(llamadasA('/publico/reservas')).toHaveLength(0);
  });

  it('señala un celular que no es válido', async () => {
    const u = usuario();
    montar();
    await hastaDatos(u);
    await u.type(await screen.findByLabelText(/nombre completo/i), 'Carlos Pérez');
    await u.type(screen.getByLabelText(/celular/i), '123');
    await u.click(confirmar());
    expect(await screen.findByText(/10 dígitos/i)).toBeInTheDocument();
    expect(llamadasA('/publico/reservas')).toHaveLength(0);
  });

  it('conserva lo escrito al volver atrás y regresar', async () => {
    const u = usuario();
    montar();
    await hastaDatos(u);
    await rellenarDatos(u);
    await u.click(screen.getByRole('button', { name: /^atrás$/i }));
    await u.click(await screen.findByRole('button', { name: /continuar/i }));
    expect(await screen.findByLabelText(/nombre completo/i)).toHaveValue('Carlos Pérez');
  });

  it('envía la reserva con los datos elegidos y el token del captcha', async () => {
    const u = usuario();
    montar();
    await hastaDatos(u);
    await rellenarDatos(u);
    await u.click(confirmar());
    await screen.findByText('CDS-7F3K2M');

    const [ruta, opcionesPeticion] = llamadasA('/publico/reservas')[0];
    expect(ruta).toBe('/publico/reservas');
    expect(opcionesPeticion).toMatchObject({
      method: 'POST',
      body: {
        sedeId: '11111111-1111-4111-8111-111111111111',
        servicioIds: ['22222222-2222-4222-8222-222222222221'],
        inicioEn: '2026-11-09T14:30:00.000Z',
        // El teléfono viaja normalizado por el mismo esquema que valida la API.
        cliente: { nombreCompleto: 'Carlos Pérez', telefono: '+573001234567' },
        tokenTurnstile: 'token-1',
      },
    });
    // «Cualquier barbero»: no se manda barberoId.
    expect((opcionesPeticion as { body: object }).body).not.toHaveProperty('barberoId');
  });

  it('manda el barbero cuando el cliente lo eligió', async () => {
    const u = usuario();
    montar();
    await hastaHora(u);
    await u.selectOptions(await screen.findByRole('combobox', { name: /barbero/i }), 'Mario');
    await u.click(await screen.findByRole('button', { name: '9:30 a. m.' }));
    await u.click(continuar());
    await rellenarDatos(u);
    await u.click(confirmar());
    await screen.findByText('CDS-7F3K2M');
    expect(llamadasA('/publico/reservas')[0][1]).toMatchObject({ body: { barberoId: '33333333-3333-4333-8333-333333333332' } });
  });
});

// ===================================================================== paso: listo

describe('pantalla final', () => {
  it('muestra el código y el enlace de gestión con el token en el fragmento', async () => {
    const u = usuario();
    montar();
    await hastaDatos(u);
    await rellenarDatos(u);
    await u.click(confirmar());

    expect(await screen.findByText('CDS-7F3K2M')).toBeInTheDocument();
    expect(screen.getByText(`${window.location.origin}/cita#tok-abc`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copiar/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /añadir al calendario/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /reservar otra/i })).toHaveAttribute('href', '/');
    // Sin barra de continuar: la cita ya existe.
    expect(screen.queryByRole('button', { name: /continuar/i })).not.toBeInTheDocument();
  });

  it('desde la pantalla final, atrás no vuelve al formulario ni crea otra cita', async () => {
    const u = usuario();
    montar();
    await hastaDatos(u);
    await rellenarDatos(u);
    await u.click(confirmar());
    await screen.findByText('CDS-7F3K2M');
    await waitFor(() => expect(ubicacion).toBe('/?paso=listo'));

    await u.click(screen.getByRole('button', { name: /atrás del navegador/ }));
    expect(screen.getByText('CDS-7F3K2M')).toBeInTheDocument();
    await waitFor(() => expect(ubicacion).toBe('/?paso=listo'));
  });
});

// ============================================================ errores al reservar

describe('errores al reservar', () => {
  it('al ocuparse el horario muestra el aviso y refresca los huecos', async () => {
    const u = usuario();
    montar();
    await hastaDatos(u);
    await rellenarDatos(u);
    alReservar = async () => {
      throw new ErrorApi(
        CODIGOS_ERROR.RESERVA_SOLAPADA,
        MENSAJES_ERROR.RESERVA_SOLAPADA,
        409,
        undefined,
        {
          huecos: [
            { inicioEn: '2026-11-09T14:30:00.000Z', hora: '09:30', disponible: false, motivo: 'NO_CABE' },
            { inicioEn: '2026-11-09T15:00:00.000Z', hora: '10:00', disponible: true },
          ],
        },
      );
    };
    await u.click(confirmar());

    expect(await screen.findByRole('alert')).toHaveTextContent(MENSAJES_ERROR.RESERVA_SOLAPADA);
    // De vuelta en la rejilla, ya actualizada: la hora que se ocupó no se puede elegir.
    expect(await screen.findByRole('button', { name: '9:30 a. m.' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '10:00 a. m.' })).toBeEnabled();
    // El hueco que no vino en la respuesta ya no aparece.
    expect(screen.queryByRole('button', { name: '10:30 a. m.' })).not.toBeInTheDocument();
    await waitFor(() => expect(ubicacion).toBe('/?paso=hora'));
    // La hora que se perdió no sigue elegida: hay que escoger otra.
    expect(continuar()).toBeDisabled();
  });

  it('con un error de horario sin huecos adjuntos vuelve a pedir la rejilla', async () => {
    const u = usuario();
    montar();
    await hastaDatos(u);
    await rellenarDatos(u);
    alReservar = async () => {
      throw new ErrorApi(
        CODIGOS_ERROR.ANTELACION_INSUFICIENTE,
        MENSAJES_ERROR.ANTELACION_INSUFICIENTE,
        422,
      );
    };
    const antes = llamadasA('/publico/disponibilidad').length;
    await u.click(confirmar());

    expect(await screen.findByRole('alert')).toHaveTextContent(MENSAJES_ERROR.ANTELACION_INSUFICIENTE);
    await screen.findByRole('button', { name: '9:30 a. m.' });
    await waitFor(() => expect(llamadasA('/publico/disponibilidad').length).toBeGreaterThan(antes));
  });

  it('con el captcha rechazado muestra su propio texto, conserva los datos y reinicia el widget', async () => {
    const u = usuario();
    montar();
    await hastaDatos(u);
    await rellenarDatos(u);
    alReservar = async () => {
      throw new ErrorApi(CODIGOS_ERROR.VALIDACION, MENSAJES_ERROR.VALIDACION, 400, {
        tokenTurnstile: ['Verificación anti-bots no válida'],
      });
    };
    await u.click(confirmar());

    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent(/verificar que eres una persona/i);
    expect(aviso).not.toHaveTextContent(MENSAJES_ERROR.VALIDACION);
    expect(window.turnstile!.reset).toHaveBeenCalled();
    expect(screen.getByLabelText(/nombre completo/i)).toHaveValue('Carlos Pérez');

    // Se puede reintentar con el token nuevo.
    alReservar = async () => RESERVA;
    await u.click(confirmar());
    await screen.findByText('CDS-7F3K2M');
    expect(llamadasA('/publico/reservas')[1][1]).toMatchObject({ body: { tokenTurnstile: 'token-2' } });
  });

  it('con otros errores de validación señala los campos que dice la API', async () => {
    const u = usuario();
    montar();
    await hastaDatos(u);
    await rellenarDatos(u);
    alReservar = async () => {
      throw new ErrorApi(CODIGOS_ERROR.VALIDACION, MENSAJES_ERROR.VALIDACION, 400, {
        'cliente.telefono': ['Ese celular no existe'],
      });
    };
    await u.click(confirmar());
    expect(await screen.findByText('Ese celular no existe')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(MENSAJES_ERROR.VALIDACION);
  });

  it('si se cae la conexión avisa, conserva los datos y deja reintentar', async () => {
    const u = usuario();
    montar();
    await hastaDatos(u);
    await rellenarDatos(u);
    alReservar = async () => {
      throw new ErrorApi(CODIGOS_ERROR.ERROR_RED, MENSAJES_ERROR.ERROR_RED, 0);
    };
    await u.click(confirmar());
    expect(await screen.findByRole('alert')).toHaveTextContent(MENSAJES_ERROR.ERROR_RED);
    expect(screen.getByLabelText(/celular/i)).toHaveValue('300 123 4567');

    alReservar = async () => RESERVA;
    await u.click(confirmar());
    expect(await screen.findByText('CDS-7F3K2M')).toBeInTheDocument();
  });

  it('con el límite de reservas activas explica qué pasó sin sacarlo del formulario', async () => {
    const u = usuario();
    montar();
    await hastaDatos(u);
    await rellenarDatos(u);
    alReservar = async () => {
      throw new ErrorApi(
        CODIGOS_ERROR.LIMITE_RESERVAS_ACTIVAS,
        MENSAJES_ERROR.LIMITE_RESERVAS_ACTIVAS,
        422,
      );
    };
    await u.click(confirmar());
    expect(await screen.findByRole('alert')).toHaveTextContent(MENSAJES_ERROR.LIMITE_RESERVAS_ACTIVAS);
    await waitFor(() => expect(ubicacion).toBe('/?paso=datos'));
  });

  it('si algo ya no existe invita a empezar de nuevo', async () => {
    const u = usuario();
    montar();
    await hastaDatos(u);
    await rellenarDatos(u);
    alReservar = async () => {
      throw new ErrorApi(CODIGOS_ERROR.RECURSO_NO_ENCONTRADO, MENSAJES_ERROR.RECURSO_NO_ENCONTRADO, 404);
    };
    await u.click(confirmar());
    expect(await screen.findByRole('alert')).toHaveTextContent(MENSAJES_ERROR.RECURSO_NO_ENCONTRADO);
    expect(screen.getByRole('link', { name: /empezar de nuevo/i })).toHaveAttribute('href', '/');
  });

  it('un error desconocido no deja pantalla en blanco ni texto técnico', async () => {
    const u = usuario();
    montar();
    await hastaDatos(u);
    await rellenarDatos(u);
    alReservar = async () => {
      throw new Error('boom: stack interno');
    };
    await u.click(confirmar());
    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent(MENSAJES_ERROR.ERROR_INTERNO);
    expect(aviso).not.toHaveTextContent(/boom/);
  });
});
