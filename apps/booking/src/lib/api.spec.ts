import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CODIGOS_ERROR, MENSAJES_ERROR } from '@cds/shared';
import { ErrorApi, guardarTokenGestion, peticion } from '@/lib/api';

/** Respuesta JSON mínima, como la devolvería `fetch`. */
function respuestaJson(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Usado cuando la petición debía fallar: si resuelve, la prueba falla con un mensaje claro. */
function noDebioResolver(): never {
  throw new Error('La petición debía fallar y resolvió.');
}

/** Espera el rechazo de la promesa y lo devuelve ya tipado como ErrorApi. */
async function errorDe(promesa: Promise<unknown>): Promise<ErrorApi> {
  const error = await promesa.then(noDebioResolver, (e: unknown) => e);
  expect(error).toBeInstanceOf(ErrorApi);
  return error as ErrorApi;
}

describe('cliente HTTP del canal público', () => {
  beforeEach(() => {
    guardarTokenGestion(null);
    vi.stubGlobal('fetch', vi.fn(async () => respuestaJson({ ok: true })));
  });

  it('manda el token de gestión en la cabecera cuando lo hay', async () => {
    guardarTokenGestion('abc');

    await peticion('/publico/mi-reserva');

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-token-gestion': 'abc' }),
      }),
    );
  });

  it('no manda la cabecera si no hay token', async () => {
    await peticion('/publico/sedes');

    const opciones = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(Object.keys(opciones.headers as Record<string, string>)).not.toContain('x-token-gestion');
  });

  it('deja de mandar la cabecera cuando se borra el token', async () => {
    guardarTokenGestion('abc');
    guardarTokenGestion(null);

    await peticion('/publico/sedes');

    const opciones = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(Object.keys(opciones.headers as Record<string, string>)).not.toContain('x-token-gestion');
  });

  it('no usa cookies ni credenciales: el canal público no tiene sesión', async () => {
    await peticion('/publico/sedes');

    const opciones = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(opciones.credentials).toBeUndefined();
  });

  it('envía el cuerpo como JSON con su Content-Type', async () => {
    await peticion('/publico/reservas', { method: 'POST', body: { nombre: 'Ana' } });

    const opciones = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(opciones.method).toBe('POST');
    expect(opciones.body).toBe(JSON.stringify({ nombre: 'Ana' }));
    expect(opciones.headers).toEqual(expect.objectContaining({ 'Content-Type': 'application/json' }));
  });

  it('devuelve undefined ante un 204 sin cuerpo', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(peticion('/publico/mi-reserva', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('traduce RespuestaError a ErrorApi conservando codigo y detalle', async () => {
    // El frontend ramifica por `codigo`, nunca por status HTTP. Y `detalle`
    // lleva los huecos recalculados cuando el horario se acaba de ocupar.
    const detalle = { huecos: [{ inicio: '2026-11-10T15:00:00.000Z', barberoId: 'b1' }] };
    vi.mocked(fetch).mockResolvedValueOnce(
      respuestaJson(
        {
          ok: false,
          codigo: 'RESERVA_SOLAPADA',
          mensaje: 'Ese horario acaba de ocuparse.',
          campos: { inicio: ['Ocupado'] },
          detalle,
          statusHttp: 409,
          requestId: 'req-1',
          marcaTiempo: '2026-11-06T10:00:00.000Z',
        },
        409,
      ),
    );

    const error = await errorDe(peticion('/publico/reservas', { method: 'POST', body: {} }));

    expect(error.codigo).toBe('RESERVA_SOLAPADA');
    expect(error.mensaje).toBe('Ese horario acaba de ocuparse.');
    expect(error.status).toBe(409);
    expect(error.campos).toEqual({ inicio: ['Ocupado'] });
    expect(error.detalle).toEqual(detalle);
    expect(error.requestId).toBe('req-1');
  });

  it('no intenta refrescar sesión ante un 401', async () => {
    // Este cliente es más simple que el del panel a propósito: no hay sesión.
    // Un 401 significa que el enlace de gestión no vale; se cuenta, no se reintenta.
    guardarTokenGestion('caducado');
    vi.mocked(fetch).mockResolvedValue(
      respuestaJson(
        { ok: false, codigo: 'TOKEN_INVALIDO', mensaje: 'Enlace no válido.', statusHttp: 401, marcaTiempo: 'x' },
        401,
      ),
    );

    const error = await errorDe(peticion('/publico/mi-reserva'));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(error.codigo).toBe('TOKEN_INVALIDO');
    expect(error.status).toBe(401);
  });

  it('usa un error genérico si la respuesta de error no trae el formato esperado', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('<html>Bad gateway</html>', { status: 502 }));

    const error = await errorDe(peticion('/publico/sedes'));

    expect(error.codigo).toBe('ERROR_DESCONOCIDO');
    expect(error.status).toBe(502);
  });

  it('traduce un fallo de red a ErrorApi con ERROR_RED y status 0', async () => {
    // Sin conexión `fetch` rechaza con un TypeError sin código. Se traduce
    // para que las pantallas ramifiquen siempre por `codigo`.
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const error = await errorDe(peticion('/publico/sedes'));

    expect(error.codigo).toBe(CODIGOS_ERROR.ERROR_RED);
    expect(error.mensaje).toBe(MENSAJES_ERROR.ERROR_RED);
    expect(error.status).toBe(0);
  });
});

// =============================================================== URL base

describe('URL base de la API', () => {
  /**
   * `VITE_API_URL` se lee al importar el módulo, así que cada caso reimporta
   * el módulo con la variable ya puesta.
   */
  async function urlPedida(valor?: string): Promise<string> {
    vi.resetModules();
    vi.stubEnv('VITE_API_URL', valor as string);
    vi.stubGlobal('fetch', vi.fn(async () => respuestaJson({ ok: true })));
    const modulo = await import('@/lib/api');
    await modulo.peticion('/publico/sedes');
    return String(vi.mocked(fetch).mock.calls[0]![0]);
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('usa la variable cuando trae una URL', async () => {
    expect(await urlPedida('https://api.reservas.test/api/v1')).toBe(
      'https://api.reservas.test/api/v1/publico/sedes',
    );
  });

  it('una variable vacía cuenta como no configurada', async () => {
    // Es el error más fácil de cometer en un panel de despliegue: crear la
    // variable y dejarla sin valor. Con `??` la cadena vacía pasaba el filtro
    // y todas las peticiones salían a una URL relativa: la web no cargaría
    // nada, y solo en producción.
    expect(await urlPedida('')).toBe('http://localhost:3001/api/v1/publico/sedes');
    expect(await urlPedida('   ')).toBe('http://localhost:3001/api/v1/publico/sedes');
  });

  it('sin la variable cae al valor de desarrollo', async () => {
    expect(await urlPedida(undefined)).toBe('http://localhost:3001/api/v1/publico/sedes');
  });
});
