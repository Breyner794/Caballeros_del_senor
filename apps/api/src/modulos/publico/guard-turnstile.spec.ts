import { HttpStatus, Logger, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CODIGOS_ERROR, MAX_TOKEN_TURNSTILE } from '@cds/shared';
import { GuardTurnstile } from './guard-turnstile.js';

const URL_VERIFICACION = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function configuracion(secreto?: string): ConfigService {
  return {
    get: (clave: string) => (clave === 'TURNSTILE_SECRET_KEY' ? secreto : undefined),
  } as unknown as ConfigService;
}

function contexto(
  cuerpo: unknown = { tokenTurnstile: 'token-del-cliente' },
  ip = '203.0.113.7',
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ body: cuerpo, ip }) }),
  } as unknown as ExecutionContext;
}

function respuestaCloudflare(cuerpo: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => cuerpo } as unknown as Response;
}

describe('GuardTurnstile', () => {
  let fetchDoble: ReturnType<typeof vi.fn>;
  let guard: GuardTurnstile;

  beforeEach(() => {
    fetchDoble = vi.fn();
    vi.stubGlobal('fetch', fetchDoble);
    guard = new GuardTurnstile(configuracion('secreto-de-prueba'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sin secreto configurado deja pasar, avisa en el log y no llama a Cloudflare', async () => {
    // Misma convención que CorreoService: permite desarrollar y probar sin credenciales.
    const aviso = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const guardSinSecreto = new GuardTurnstile(configuracion(undefined));

    await expect(guardSinSecreto.canActivate(contexto())).resolves.toBe(true);

    expect(aviso).toHaveBeenCalledOnce();
    expect(fetchDoble).not.toHaveBeenCalled();
  });

  it('deja pasar cuando Cloudflare responde success', async () => {
    fetchDoble.mockResolvedValue(respuestaCloudflare({ success: true }));
    await expect(guard.canActivate(contexto())).resolves.toBe(true);
  });

  it('rechaza con VALIDACION señalando tokenTurnstile cuando Cloudflare responde success false', async () => {
    fetchDoble.mockResolvedValue(
      respuestaCloudflare({ success: false, 'error-codes': ['invalid-input-response'] }),
    );
    // El campo señalado permite al frontend reiniciar el widget.
    await expect(guard.canActivate(contexto())).rejects.toMatchObject({
      codigo: CODIGOS_ERROR.VALIDACION,
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      campos: { tokenTurnstile: [expect.any(String)] },
    });
  });

  it.each([
    ['no hay cuerpo', null],
    ['falta el campo', {}],
    ['no es texto', { tokenTurnstile: 123 }],
    ['está vacío', { tokenTurnstile: '   ' }],
    ['excede el máximo de Turnstile', { tokenTurnstile: 'a'.repeat(MAX_TOKEN_TURNSTILE + 1) }],
  ])('rechaza sin consultar a Cloudflare cuando el token %s', async (_caso, cuerpo) => {
    await expect(guard.canActivate(contexto(cuerpo))).rejects.toMatchObject({
      codigo: CODIGOS_ERROR.VALIDACION,
      campos: { tokenTurnstile: [expect.any(String)] },
    });
    expect(fetchDoble).not.toHaveBeenCalled();
  });

  it('falla cerrado si Cloudflare no responde', async () => {
    fetchDoble.mockRejectedValue(new TypeError('fetch failed'));
    await expect(guard.canActivate(contexto())).rejects.toMatchObject({
      codigo: CODIGOS_ERROR.SERVICIO_EXTERNO_CAIDO,
      status: HttpStatus.BAD_GATEWAY,
    });
  });

  it('un aborto por tiempo agotado también falla cerrado con SERVICIO_EXTERNO_CAIDO', async () => {
    // Lo que lanza fetch cuando AbortSignal.timeout se dispara; sin esperar 5 s reales.
    fetchDoble.mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'AbortError'));
    await expect(guard.canActivate(contexto())).rejects.toMatchObject({
      codigo: CODIGOS_ERROR.SERVICIO_EXTERNO_CAIDO,
      status: HttpStatus.BAD_GATEWAY,
    });
  });

  it('acepta un token del largo máximo', async () => {
    fetchDoble.mockResolvedValue(respuestaCloudflare({ success: true }));
    await expect(
      guard.canActivate(contexto({ tokenTurnstile: 'a'.repeat(MAX_TOKEN_TURNSTILE) })),
    ).resolves.toBe(true);
  });

  it('falla cerrado si Cloudflare responde con un error HTTP', async () => {
    fetchDoble.mockResolvedValue(respuestaCloudflare({ success: true }, false));
    await expect(guard.canActivate(contexto())).rejects.toMatchObject({
      codigo: CODIGOS_ERROR.SERVICIO_EXTERNO_CAIDO,
    });
  });

  it('falla cerrado si la respuesta de Cloudflare no es JSON', async () => {
    fetchDoble.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('no es JSON');
      },
    });
    await expect(guard.canActivate(contexto())).rejects.toMatchObject({
      codigo: CODIGOS_ERROR.SERVICIO_EXTERNO_CAIDO,
    });
  });

  it('solo deja pasar con success estrictamente true', async () => {
    fetchDoble.mockResolvedValue(respuestaCloudflare({ success: 'true' }));
    await expect(guard.canActivate(contexto())).rejects.toMatchObject({
      codigo: CODIGOS_ERROR.VALIDACION,
    });
  });

  it('aborta la verificación a los 5 segundos', async () => {
    const espiaTemporizador = vi.spyOn(AbortSignal, 'timeout');
    fetchDoble.mockResolvedValue(respuestaCloudflare({ success: true }));

    await guard.canActivate(contexto());

    expect(espiaTemporizador).toHaveBeenCalledWith(5_000);
    const opciones = fetchDoble.mock.calls[0]![1] as RequestInit;
    expect(opciones.signal).toBeInstanceOf(AbortSignal);
  });

  it('envía el secreto, el token y la IP real del cliente a Cloudflare', async () => {
    fetchDoble.mockResolvedValue(respuestaCloudflare({ success: true }));

    await guard.canActivate(contexto({ tokenTurnstile: 'token-del-cliente' }, '198.51.100.9'));

    const [url, opciones] = fetchDoble.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(URL_VERIFICACION);
    expect(opciones.method).toBe('POST');
    expect(JSON.parse(opciones.body as string)).toEqual({
      secret: 'secreto-de-prueba',
      response: 'token-del-cliente',
      remoteip: '198.51.100.9',
    });
  });
});
