import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/** Códigos de error de Postgres que la API traduce a errores de negocio. */
export const CODIGOS_POSTGRES = {
  VIOLACION_UNICIDAD: '23505',
  VIOLACION_EXCLUSION: '23P01',
  VIOLACION_CHECK: '23514',
  VIOLACION_FK: '23503',
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
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;

    const meta = error.meta as Record<string, unknown> | undefined;
    const texto = [
      typeof meta?.['constraint'] === 'string' ? meta['constraint'] : '',
      typeof meta?.['target'] === 'string' ? meta['target'] : '',
      Array.isArray(meta?.['target']) ? (meta['target'] as string[]).join(',') : '',
      error.message,
    ].join(' ');

    return texto.includes(nombreRestriccion);
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
