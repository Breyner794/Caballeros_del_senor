import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { ZodError, ZodSchema } from 'zod';
import { ErrorNegocio } from '../excepciones/error-negocio.js';

/**
 * Pipe de validación con Zod.
 *
 * El mismo esquema que valida el formulario en el navegador valida aquí la
 * entrada, de modo que no hay dos listas de reglas que se desincronicen. Y al
 * ser Zod, el pipe también *transforma*: el teléfono entra como "300 123 4567"
 * y sale como "+573001234567" listo para guardar.
 *
 * Uso: `@Body(new ValidacionZod(crearClienteSchema)) datos: CrearClienteDto`
 */
@Injectable()
export class ValidacionZod<T> implements PipeTransform<unknown, T> {
  constructor(private readonly esquema: ZodSchema<T>) {}

  transform(valor: unknown, _metadata: ArgumentMetadata): T {
    try {
      return this.esquema.parse(valor);
    } catch (error) {
      if (error instanceof ZodError) {
        const campos: Record<string, string[]> = {};
        for (const issue of error.issues) {
          const clave = issue.path.length > 0 ? issue.path.join('.') : '_general';
          (campos[clave] ??= []).push(issue.message);
        }
        throw ErrorNegocio.validacion(campos);
      }
      throw error;
    }
  }
}

/** Azúcar para leer mejor en los controladores. */
export const validar = <T>(esquema: ZodSchema<T>): ValidacionZod<T> => new ValidacionZod(esquema);
