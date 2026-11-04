import { HttpStatus, type ExecutionContext } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { CODIGOS_ERROR } from '@cds/shared';
import { crearPrismaDoble, type PrismaDoble } from '../../../test/soporte/dobles.js';
import { ID, reserva } from '../../../test/soporte/datos.js';
import type { PrismaService } from '../../comun/prisma/prisma.service.js';
import { GuardTokenGestion } from './guard-token-gestion.js';

/** Construye un contexto HTTP mínimo con las cabeceras y la petición dadas. */
function contexto(cabeceras: Record<string, unknown>, peticion: object = {}): ExecutionContext {
  Object.assign(peticion, { headers: cabeceras });
  return {
    switchToHttp: () => ({ getRequest: () => peticion }),
  } as unknown as ExecutionContext;
}

describe('GuardTokenGestion', () => {
  let prisma: PrismaDoble;
  let guard: GuardTokenGestion;

  beforeEach(() => {
    prisma = crearPrismaDoble();
    guard = new GuardTokenGestion(prisma as unknown as PrismaService);
  });

  it('rechaza la petición sin cabecera, con 401 y sin consultar la base', async () => {
    await expect(guard.canActivate(contexto({}))).rejects.toMatchObject({
      codigo: CODIGOS_ERROR.TOKEN_INVALIDO,
      status: HttpStatus.UNAUTHORIZED,
    });
    expect(prisma.reserva.findUnique).not.toHaveBeenCalled();
  });

  it('rechaza una cabecera vacía o repetida', async () => {
    for (const valor of ['', '   ', ['a', 'b']]) {
      await expect(
        guard.canActivate(contexto({ 'x-token-gestion': valor })),
      ).rejects.toMatchObject({ codigo: CODIGOS_ERROR.TOKEN_INVALIDO });
    }
    expect(prisma.reserva.findUnique).not.toHaveBeenCalled();
  });

  it('rechaza un token que no existe', async () => {
    prisma.reserva.findUnique.mockResolvedValue(null);
    await expect(
      guard.canActivate(contexto({ 'x-token-gestion': 'inexistente' })),
    ).rejects.toMatchObject({
      codigo: CODIGOS_ERROR.TOKEN_INVALIDO,
      status: HttpStatus.UNAUTHORIZED,
    });
  });

  it('rechaza el token de una cita ya cancelada', async () => {
    // Al cancelar, `tokenGestion` queda en null, así que `findUnique` no la
    // encuentra. Esta prueba fija que no existe ninguna otra vía de acceso:
    // el guard no tiene un segundo camino para citas canceladas.
    prisma.reserva.findUnique.mockResolvedValue(null);
    await expect(
      guard.canActivate(contexto({ 'x-token-gestion': 'token-de-cita-cancelada' })),
    ).rejects.toMatchObject({ codigo: CODIGOS_ERROR.TOKEN_INVALIDO });
    expect(prisma.reserva.findFirst).not.toHaveBeenCalled();
    expect(prisma.reserva.findMany).not.toHaveBeenCalled();
  });

  it('no incluye el token en el mensaje del error', async () => {
    prisma.reserva.findUnique.mockResolvedValue(null);
    const error = await guard
      .canActivate(contexto({ 'x-token-gestion': 'secreto-que-no-debe-salir' }))
      .catch((e: Error) => e);
    expect((error as Error).message).not.toContain('secreto-que-no-debe-salir');
  });

  it('resuelve la reserva y la deja en la petición', async () => {
    prisma.reserva.findUnique.mockResolvedValue(reserva());
    const peticion: { reservaPublica?: { id: string } } = {};
    await expect(
      guard.canActivate(contexto({ 'x-token-gestion': 'abc' }, peticion)),
    ).resolves.toBe(true);
    expect(peticion.reservaPublica?.id).toBe(ID.reserva);
  });

  it('consulta por el campo único y no por un barrido', async () => {
    prisma.reserva.findUnique.mockResolvedValue(reserva());
    await guard.canActivate(contexto({ 'x-token-gestion': 'abc' }));
    expect(prisma.reserva.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenGestion: 'abc' } }),
    );
    expect(prisma.reserva.findFirst).not.toHaveBeenCalled();
    expect(prisma.reserva.findMany).not.toHaveBeenCalled();
  });

  it('no cachea: cada petición vuelve a consultar', async () => {
    prisma.reserva.findUnique.mockResolvedValue(reserva());
    await guard.canActivate(contexto({ 'x-token-gestion': 'abc' }));
    await guard.canActivate(contexto({ 'x-token-gestion': 'abc' }));
    expect(prisma.reserva.findUnique).toHaveBeenCalledTimes(2);
  });
});
