import { beforeEach, describe, expect, it, vi } from 'vitest';
import { crearPrismaDoble } from '../../../test/soporte/dobles.js';
import { AdaptadorEmail } from './adaptador-email.js';
import { ProveedorSinConfigurar } from './correo.service.js';
import { NotificacionesService, type AdaptadorNotificacion } from './notificaciones.service.js';

const PLANTILLA = {
  id: 'plantilla-1',
  clave: 'reserva.confirmada',
  canal: 'EMAIL',
  asunto: 'Tu cita {{codigo}} quedó registrada',
  cuerpo: 'Hola {{cliente}}, te esperamos el {{fecha}}.\nGestiónala aquí: {{enlace}}',
  activa: true,
};

const DATOS = {
  reservaId: 'reserva-1',
  clienteId: 'cliente-1',
  clave: 'reserva.confirmada',
  canal: 'EMAIL' as const,
  destino: 'juan@correo.co',
  variables: { cliente: 'Juan', codigo: 'CDS-A1B2', enlace: 'https://reservas.test/cita#tok_secreto' },
};

describe('NotificacionesService.encolar', () => {
  let prisma: ReturnType<typeof crearPrismaDoble>;
  let email: { enviar: ReturnType<typeof vi.fn> };
  let servicio: NotificacionesService;

  beforeEach(() => {
    prisma = crearPrismaDoble();
    prisma.plantillaNotificacion.findFirst.mockResolvedValue(PLANTILLA);
    prisma.notificacion.create.mockResolvedValue({ id: 'notif-1' });
    prisma.notificacion.update.mockResolvedValue({});
    email = { enviar: vi.fn(async () => ({ idExterno: '<msg-1@brevo>' })) };
    servicio = new NotificacionesService(prisma as never, { EMAIL: email as AdaptadorNotificacion });
  });

  it('registra la notificación como PENDIENTE antes de intentar enviarla', async () => {
    const orden: string[] = [];
    prisma.notificacion.create.mockImplementation(async () => {
      orden.push('registrar');
      return { id: 'notif-1' };
    });
    email.enviar.mockImplementation(async () => {
      orden.push('enviar');
      return {};
    });

    await servicio.encolar(DATOS);

    expect(orden).toEqual(['registrar', 'enviar']);
    expect(prisma.notificacion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        canal: 'EMAIL',
        destino: 'juan@correo.co',
        reservaId: 'reserva-1',
        clienteId: 'cliente-1',
        plantillaId: 'plantilla-1',
        estado: 'PENDIENTE',
      }),
    });
  });

  it('resuelve la plantilla por clave y canal', async () => {
    await servicio.encolar(DATOS);
    expect(prisma.plantillaNotificacion.findFirst).toHaveBeenCalledWith({
      where: { clave: 'reserva.confirmada', canal: 'EMAIL', activa: true },
    });
  });

  it('marca ENVIADA con el id externo del proveedor', async () => {
    await servicio.encolar(DATOS);
    expect(prisma.notificacion.update).toHaveBeenCalledWith({
      where: { id: 'notif-1' },
      data: expect.objectContaining({
        estado: 'ENVIADA',
        idExterno: '<msg-1@brevo>',
        intentos: 1,
        enviadaEn: expect.any(Date),
      }),
    });
  });

  it('entrega al adaptador la plantilla, el destino y las variables', async () => {
    await servicio.encolar(DATOS);
    expect(email.enviar).toHaveBeenCalledWith(PLANTILLA, 'juan@correo.co', DATOS.variables);
  });

  it('marca FALLIDA con el error y cuenta el intento', async () => {
    email.enviar.mockRejectedValue(new Error('Brevo respondió 400: sender inválido'));
    await servicio.encolar(DATOS);
    expect(prisma.notificacion.update).toHaveBeenCalledWith({
      where: { id: 'notif-1' },
      data: expect.objectContaining({
        estado: 'FALLIDA',
        intentos: 1,
        error: 'Brevo respondió 400: sender inválido',
      }),
    });
  });

  it('no lanza si el proveedor falla: el correo es una comodidad, no el recibo', async () => {
    email.enviar.mockRejectedValue(new Error('caído'));
    await expect(servicio.encolar(DATOS)).resolves.toBeUndefined();
  });

  it('no lanza si ni siquiera se puede registrar la notificación', async () => {
    prisma.notificacion.create.mockRejectedValue(new Error('base caída'));
    await expect(servicio.encolar(DATOS)).resolves.toBeUndefined();
    expect(email.enviar).not.toHaveBeenCalled();
  });

  it('deja en PENDIENTE un canal sin adaptador todavía, sin lanzar', async () => {
    // WHATSAPP está en el enum y planificado: la fila queda encolada, no se pierde
    // ni revienta. Cuando llegue su adaptador, nada más cambia.
    await expect(
      servicio.encolar({ ...DATOS, canal: 'WHATSAPP', destino: '+573001234567' }),
    ).resolves.toBeUndefined();
    expect(prisma.notificacion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ canal: 'WHATSAPP', estado: 'PENDIENTE' }),
    });
    expect(prisma.notificacion.update).not.toHaveBeenCalled();
    expect(email.enviar).not.toHaveBeenCalled();
  });

  it('con un adaptador de WhatsApp registrado, despacha por él sin tocar el servicio', async () => {
    const whatsapp = { enviar: vi.fn(async () => ({ idExterno: 'wamid.1' })) };
    const conWhatsapp = new NotificacionesService(prisma as never, {
      EMAIL: email as AdaptadorNotificacion,
      WHATSAPP: whatsapp as AdaptadorNotificacion,
    });
    await conWhatsapp.encolar({ ...DATOS, canal: 'WHATSAPP', destino: '+573001234567' });
    expect(whatsapp.enviar).toHaveBeenCalledOnce();
    expect(email.enviar).not.toHaveBeenCalled();
    expect(prisma.notificacion.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ estado: 'ENVIADA', idExterno: 'wamid.1' }) }),
    );
  });

  it('deja en PENDIENTE, sin marcar FALLIDA, si el proveedor no está configurado', async () => {
    // Estado normal de un entorno de desarrollo sin credenciales: no es un fallo.
    email.enviar.mockRejectedValue(new ProveedorSinConfigurar('Brevo'));
    await expect(servicio.encolar(DATOS)).resolves.toBeUndefined();
    expect(prisma.notificacion.update).not.toHaveBeenCalled();
  });

  it('marca FALLIDA si no existe plantilla activa para esa clave y canal', async () => {
    prisma.plantillaNotificacion.findFirst.mockResolvedValue(null);
    await servicio.encolar(DATOS);
    expect(email.enviar).not.toHaveBeenCalled();
    expect(prisma.notificacion.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ estado: 'FALLIDA', intentos: 1 }) }),
    );
  });

  it('guarda las variables enviadas, menos las que se piden omitir', async () => {
    await servicio.encolar({ ...DATOS, omitirDelPayload: ['enlace'] });
    const { data } = prisma.notificacion.create.mock.calls[0]![0] as { data: { payload: unknown } };
    expect(data.payload).toEqual({ cliente: 'Juan', codigo: 'CDS-A1B2' });
    expect(JSON.stringify(prisma.notificacion.create.mock.calls)).not.toContain('tok_secreto');
  });
});

describe('AdaptadorEmail', () => {
  const variables = { cliente: 'Ana <b>', codigo: 'CDS-1', fecha: 'martes 10', enlace: 'https://r.test/cita#abc' };
  const correo = (resultado: unknown) => ({ enviarDetallado: vi.fn(async () => resultado) });

  it('sustituye los placeholders {{…}} en asunto y cuerpo', async () => {
    const c = correo({ estado: 'ENVIADO', idExterno: 'id-1' });
    const adaptador = new AdaptadorEmail(c as never);

    const resultado = await adaptador.enviar(PLANTILLA as never, 'ana@correo.co', variables);

    expect(resultado).toEqual({ idExterno: 'id-1' });
    expect(c.enviarDetallado).toHaveBeenCalledWith(
      expect.objectContaining({
        para: 'ana@correo.co',
        asunto: 'Tu cita CDS-1 quedó registrada',
        texto: 'Hola Ana <b>, te esperamos el martes 10.\nGestiónala aquí: https://r.test/cita#abc',
      }),
    );
  });

  it('escapa las variables en el HTML y enlaza las direcciones', async () => {
    const c = correo({ estado: 'ENVIADO' });
    await new AdaptadorEmail(c as never).enviar(PLANTILLA as never, 'ana@correo.co', variables);
    const { html } = (c.enviarDetallado.mock.calls[0] as unknown as [{ html: string }])[0];
    expect(html).toContain('Ana &lt;b&gt;');
    expect(html).not.toContain('<b>');
    expect(html).toContain('<a href="https://r.test/cita#abc"');
  });

  it('un placeholder sin variable se vacía en lugar de enviarse crudo', async () => {
    const c = correo({ estado: 'ENVIADO' });
    await new AdaptadorEmail(c as never).enviar(PLANTILLA as never, 'a@b.co', {});
    const { texto } = (c.enviarDetallado.mock.calls[0] as unknown as [{ texto: string }])[0];
    expect(texto).not.toContain('{{');
  });

  it('lanza ProveedorSinConfigurar si Brevo no está configurado', async () => {
    const adaptador = new AdaptadorEmail(correo({ estado: 'SIN_CONFIGURAR' }) as never);
    await expect(adaptador.enviar(PLANTILLA as never, 'a@b.co', variables)).rejects.toBeInstanceOf(
      ProveedorSinConfigurar,
    );
  });

  it('lanza el motivo si Brevo falla', async () => {
    const adaptador = new AdaptadorEmail(correo({ estado: 'FALLO', motivo: 'Brevo respondió 401' }) as never);
    await expect(adaptador.enviar(PLANTILLA as never, 'a@b.co', variables)).rejects.toThrow(
      'Brevo respondió 401',
    );
  });
});
