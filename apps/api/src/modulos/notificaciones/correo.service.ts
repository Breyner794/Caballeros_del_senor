import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface EnvioCorreo {
  para: string;
  nombreDestinatario?: string;
  asunto: string;
  html: string;
  texto?: string;
}

/**
 * El proveedor no tiene credenciales: no es un fallo, es un entorno sin
 * configurar. Los adaptadores de notificación lo lanzan para que el servicio
 * deje la fila `PENDIENTE` en lugar de marcarla `FALLIDA`.
 */
export class ProveedorSinConfigurar extends Error {
  constructor(proveedor: string) {
    super(`${proveedor} no está configurado`);
    this.name = 'ProveedorSinConfigurar';
  }
}

export type ResultadoEnvioCorreo =
  | { estado: 'ENVIADO'; idExterno?: string }
  | { estado: 'SIN_CONFIGURAR' }
  | { estado: 'FALLO'; motivo: string };

/**
 * Envío de correo transaccional con Brevo.
 *
 * Se habla con la API HTTP directamente en lugar de usar el SDK: es una sola
 * llamada POST, y así no se arrastra una dependencia que hay que actualizar.
 *
 * Si `BREVO_API_KEY` no está configurada, el servicio no falla: escribe el
 * correo en el log y sigue. Eso permite desarrollar el flujo de recuperación de
 * contraseña sin credenciales (el código aparece en la consola) y, sobre todo,
 * evita que un problema con el proveedor de correo tumbe operaciones del panel
 * que no dependen de él.
 */
@Injectable()
export class CorreoService {
  private readonly logger = new Logger(CorreoService.name);
  private static readonly URL_BREVO = 'https://api.brevo.com/v3/smtp/email';

  constructor(private readonly config: ConfigService) {}

  private get habilitado(): boolean {
    return Boolean(this.config.get<string>('BREVO_API_KEY'));
  }

  /**
   * Envío con resultado distinguible: quien necesita saber POR QUÉ no salió el
   * correo (las notificaciones, que guardan estado) usa este método; `enviar`
   * lo reduce a un booleano para quien solo quiere saber si salió.
   */
  async enviarDetallado(envio: EnvioCorreo): Promise<ResultadoEnvioCorreo> {
    if (!this.habilitado) {
      this.logger.warn(
        `Brevo sin configurar. Correo no enviado a ${envio.para} — asunto: "${envio.asunto}"`,
      );
      if (envio.texto) this.logger.debug(`Contenido:\n${envio.texto}`);
      return { estado: 'SIN_CONFIGURAR' };
    }

    try {
      const respuesta = await fetch(CorreoService.URL_BREVO, {
        method: 'POST',
        headers: {
          'api-key': this.config.getOrThrow<string>('BREVO_API_KEY'),
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: {
            email: this.config.get<string>('BREVO_SENDER_EMAIL') ?? 'no-reply@localhost',
            name: this.config.get<string>('BREVO_SENDER_NAME') ?? 'Caballeros del Señor',
          },
          to: [{ email: envio.para, name: envio.nombreDestinatario }],
          subject: envio.asunto,
          htmlContent: envio.html,
          textContent: envio.texto,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!respuesta.ok) {
        const detalle = await respuesta.text().catch(() => '');
        const motivo = `Brevo respondió ${respuesta.status}: ${detalle.slice(0, 500)}`;
        this.logger.error(motivo);
        return { estado: 'FALLO', motivo };
      }

      // El id del mensaje sirve para rastrear la entrega; que no venga no vuelve
      // fallido un envío que Brevo ya aceptó.
      const cuerpo = (await respuesta.json().catch(() => null)) as { messageId?: string } | null;
      return { estado: 'ENVIADO', idExterno: cuerpo?.messageId };
    } catch (fallo) {
      const motivo = `No se pudo enviar el correo a ${envio.para}: ${
        fallo instanceof Error ? fallo.message : String(fallo)
      }`;
      this.logger.error(motivo);
      return { estado: 'FALLO', motivo };
    }
  }

  /** `true` solo si Brevo aceptó el correo; sin configurar o con fallo, `false`. */
  async enviar(envio: EnvioCorreo): Promise<boolean> {
    return (await this.enviarDetallado(envio)).estado === 'ENVIADO';
  }

  /** Código de verificación para recuperar la contraseña. */
  async enviarCodigoRecuperacion(
    para: string,
    nombre: string,
    codigo: string,
    minutosValidez: number,
  ): Promise<boolean> {
    if (!this.habilitado) {
      // En desarrollo el código se ve en la consola: sin esto no habría forma
      // de probar el flujo completo sin credenciales de Brevo.
      this.logger.warn(`Código de recuperación para ${para}: ${codigo}`);
      return false;
    }

    const asunto = 'Tu código para restablecer la contraseña';
    const texto = `Hola ${nombre}:\n\nTu código de verificación es ${codigo}.\nCaduca en ${minutosValidez} minutos.\n\nSi no pediste este cambio, ignora este mensaje.`;

    return this.enviar({
      para,
      nombreDestinatario: nombre,
      asunto,
      texto,
      html: this.plantillaCodigo(nombre, codigo, minutosValidez),
    });
  }

  private plantillaCodigo(nombre: string, codigo: string, minutos: number): string {
    return `<!doctype html>
<html lang="es"><body style="margin:0;background:#0f0f10;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#18181b;border:1px solid #27272a;border-radius:16px;padding:32px;">
        <tr><td style="color:#fafafa;font-size:20px;font-weight:600;padding-bottom:8px;">Caballeros del Señor</td></tr>
        <tr><td style="color:#a1a1aa;font-size:14px;line-height:1.6;padding-bottom:24px;">
          Hola ${this.escapar(nombre)}, usa este código para restablecer tu contraseña:
        </td></tr>
        <tr><td align="center" style="padding-bottom:24px;">
          <div style="display:inline-block;background:#09090b;border:1px solid #3f3f46;border-radius:12px;padding:16px 28px;color:#fafafa;font-size:32px;letter-spacing:10px;font-weight:700;font-family:ui-monospace,monospace;">
            ${this.escapar(codigo)}
          </div>
        </td></tr>
        <tr><td style="color:#71717a;font-size:13px;line-height:1.6;">
          El código caduca en ${minutos} minutos y solo se puede usar una vez.
          Si no pediste este cambio, puedes ignorar este correo: tu contraseña sigue igual.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  }

  private escapar(texto: string): string {
    return texto
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
