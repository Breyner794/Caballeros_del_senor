import { afterEach, describe, expect, it, vi } from 'vitest';
import { CorreoService } from './correo.service.js';

const envio = { para: 'a@b.co', asunto: 'Hola', html: '<p>Hola</p>', texto: 'Hola' };
const crear = (clave?: string) =>
  new CorreoService({
    get: (k: string) => (k === 'BREVO_API_KEY' ? clave : undefined),
    getOrThrow: () => clave,
  } as never);

afterEach(() => vi.unstubAllGlobals());

describe('CorreoService.enviarDetallado', () => {
  it('distingue «no configurado» de un fallo, y no llama a Brevo', async () => {
    const fetchDoble = vi.fn();
    vi.stubGlobal('fetch', fetchDoble);
    expect(await crear(undefined).enviarDetallado(envio)).toEqual({ estado: 'SIN_CONFIGURAR' });
    expect(fetchDoble).not.toHaveBeenCalled();
  });

  it('devuelve el messageId de Brevo cuando acepta el envío', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ messageId: '<m1>' }), { status: 201 })));
    expect(await crear('clave').enviarDetallado(envio)).toEqual({ estado: 'ENVIADO', idExterno: '<m1>' });
  });

  it('un envío aceptado sin cuerpo legible sigue siendo ENVIADO', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 201 })));
    expect(await crear('clave').enviarDetallado(envio)).toEqual({ estado: 'ENVIADO', idExterno: undefined });
  });

  it('un rechazo de Brevo es FALLO con el estado HTTP', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('sender inválido', { status: 400 })));
    expect(await crear('clave').enviarDetallado(envio)).toEqual({
      estado: 'FALLO',
      motivo: expect.stringContaining('400'),
    });
  });

  it('un error de red es FALLO', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('ECONNRESET'))));
    expect(await crear('clave').enviarDetallado(envio)).toEqual({
      estado: 'FALLO',
      motivo: expect.stringContaining('ECONNRESET'),
    });
  });
});

describe('CorreoService.enviar (contrato booleano de los consumidores existentes)', () => {
  it('devuelve false sin configurar, como antes', async () => {
    expect(await crear(undefined).enviar(envio)).toBe(false);
  });

  it('devuelve true si Brevo acepta', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 201 })));
    expect(await crear('clave').enviar(envio)).toBe(true);
  });

  it('devuelve false si Brevo falla, sin lanzar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500 })));
    expect(await crear('clave').enviar(envio)).toBe(false);
  });
});
