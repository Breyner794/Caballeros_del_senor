import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/** Códigos de error de Postgres que la API traduce a errores de negocio. */
export const CODIGOS_POSTGRES = {
  VIOLACION_UNICIDAD: '23505',
  VIOLACION_EXCLUSION: '23P01',
  VIOLACION_CHECK: '23514',
  VIOLACION_FK: '23503',
  INTERBLOQUEO: '40P01',
} as const;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();

    // @ts-expect-error — el tipado de $on con log por eventos es laxo
    this.$on('warn', (e: { message: string }) => this.logger.warn(e.message));
    // @ts-expect-error — ídem
    this.$on('error', (e: { message: string }) => this.logger.error(e.message));

    this.logger.log('Conectado a PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Comprueba si un error de Prisma viene de una restricción concreta de la
   * base de datos.
   *
   * Es la pieza que convierte la garantía del motor en un mensaje humano: la
   * restricción `reservas_sin_solape_barbero` salta cuando dos recepcionistas
   * guardan la misma hora a la vez, y el usuario debe leer "ese horario acaba
   * de ocuparse", no un error 500.
   */
  static esViolacionDe(error: unknown, nombreRestriccion: string): boolean {
    // Las restricciones de exclusión y las CHECK no tienen código propio en
    // Prisma: llegan envueltas como `PrismaClientUnknownRequestError` con el
    // error crudo de Postgres dentro del mensaje. Hay que mirar los dos tipos,
    // o la restricción anti-solape acabaría como un 500 genérico en lugar del
    // mensaje "ese horario acaba de ocuparse".
    const esDePrisma =
      error instanceof Prisma.PrismaClientKnownRequestError ||
      error instanceof Prisma.PrismaClientUnknownRequestError;

    if (!esDePrisma) return false;

    const meta =
      error instanceof Prisma.PrismaClientKnownRequestError
        ? (error.meta as Record<string, unknown> | undefined)
        : undefined;

    const texto = [
      typeof meta?.['constraint'] === 'string' ? meta['constraint'] : '',
      typeof meta?.['target'] === 'string' ? meta['target'] : '',
      Array.isArray(meta?.['target']) ? (meta['target'] as string[]).join(',') : '',
      error.message,
    ].join(' ');

    return texto.includes(nombreRestriccion);
  }

  /**
   * ¿El motor abortó la transacción por un interbloqueo (`40P01`)?
   *
   * Con una restricción de exclusión, dos inserciones que chocan pueden acabar
   * de dos maneras: si una llega antes, la otra espera y recibe `23P01`; si las
   * dos ya han escrito su fila cuando comprueban el índice, cada una espera a la
   * otra y Postgres aborta a una con `40P01`. Es la misma carrera y el mismo
   * perdedor: quien escribe una cita debe tratar los dos errores por igual.
   */
  static esInterbloqueo(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === 'P2034';
    return (
      error instanceof Prisma.PrismaClientUnknownRequestError &&
      error.message.includes(CODIGOS_POSTGRES.INTERBLOQUEO)
    );
  }

  static esDuplicado(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2002' || error.code === CODIGOS_POSTGRES.VIOLACION_UNICIDAD)
    );
  }

  static esNoEncontrado(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
  }

  /** Campos que violaron la unicidad, para señalarlos en el formulario. */
  static camposDuplicados(error: unknown): string[] {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return [];
    const destino = (error.meta as { target?: string[] | string } | undefined)?.target;
    if (Array.isArray(destino)) return destino;
    if (typeof destino === 'string') return [destino];
    return [];
  }
}
