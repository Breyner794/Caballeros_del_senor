import { Injectable } from '@nestjs/common';
import type { PlantillaNotificacion } from '@prisma/client';
import { CorreoService, ProveedorSinConfigurar } from './correo.service.js';
import type { AdaptadorNotificacion } from './notificaciones.service.js';

/** Sustituye `{{nombre}}` por su valor; un placeholder sin variable queda vacío. */
export function rellenar(texto: string, variables: Record<string, string>): string {
  return texto.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, nombre: string) => variables[nombre] ?? '');
}

const escapar = (texto: string) =>
  texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Texto plano a HTML: escapa, enlaza las direcciones y respeta los saltos de línea. */
function aHtml(texto: string): string {
  const cuerpo = escapar(texto)
    .replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}" style="color:#b45309;">${url}</a>`)
    .replace(/\n/g, '<br>');
  return `<!doctype html><html lang="es"><body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.6;color:#18181b;">${cuerpo}</body></html>`;
}

/**
 * Despacha una plantilla de canal `EMAIL` por Brevo. Lanza si no se pudo enviar:
 * `ProveedorSinConfigurar` si faltan credenciales (no es un fallo) y `Error`
 * con el motivo si Brevo falló. Qué estado merece cada caso lo decide el servicio.
 */
@Injectable()
export class AdaptadorEmail implements AdaptadorNotificacion {
  constructor(private readonly correo: CorreoService) {}

  async enviar(
    plantilla: Pick<PlantillaNotificacion, 'asunto' | 'cuerpo'>,
    destino: string,
    variables: Record<string, string>,
  ): Promise<{ idExterno?: string }> {
    const texto = rellenar(plantilla.cuerpo, variables);
    const resultado = await this.correo.enviarDetallado({
      para: destino,
      nombreDestinatario: variables['cliente'],
      asunto: rellenar(plantilla.asunto ?? '', variables),
      texto,
      html: aHtml(texto),
    });

    if (resultado.estado === 'SIN_CONFIGURAR') throw new ProveedorSinConfigurar('Brevo');
    if (resultado.estado === 'FALLO') throw new Error(resultado.motivo);
    return { idExterno: resultado.idExterno };
  }
}
