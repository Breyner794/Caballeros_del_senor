import { describe, expect, expectTypeOf, it } from 'vitest';
import { Prisma } from '@prisma/client';
import type { BarberoPublico, HuecoPublico, ReservaPublica, ServicioReservado } from '@cds/shared';
import { ID, lineaServicio, reserva, servicio } from '../../../test/soporte/datos.js';
import {
  aBarberoPublico,
  aHuecoPublico,
  aReservaPublica,
  aSedePublica,
  aServicioPublico,
  aServicioReservado,
} from './dto-publico.js';

const ordenadas = (objeto: object) => Object.keys(objeto).sort();

const usuarioBarbero = (cambios: Record<string, unknown> = {}) => ({
  id: ID.barbero,
  nombre: 'Andrés',
  apellido: 'Gómez',
  alias: null as string | null,
  email: 'andres@cds.test',
  telefono: '+573001112233',
  rol: 'BARBERO',
  passwordHash: 'hash-secreto',
  bio: 'Quince años afilando navajas.',
  fotoUrl: 'https://cds.test/andres.jpg',
  ...cambios,
});

const hueco = (cambios: Record<string, unknown> = {}) => ({
  inicioEn: '2026-03-11T14:30:00.000Z',
  hora: '09:30',
  disponible: false,
  ...cambios,
});

describe('aReservaPublica', () => {
  it('la reserva pública tiene exactamente estas claves', () => {
    expect(ordenadas(aReservaPublica(reserva()))).toEqual([
      'barbero', 'codigo', 'estado', 'finEn', 'inicioEn', 'sede', 'servicios', 'total',
    ]);
  });

  it('no filtra el UUID, el token, las notas ni la ficha del cliente', () => {
    const salida = JSON.stringify(
      aReservaPublica(
        reserva({ notaInterna: 'cliente conflictivo', notaCliente: 'más corto' }),
      ),
    );
    for (const secreto of [ID.reserva, 'tok_123', 'conflictivo', 'Juan', '+573001234567']) {
      expect(salida).not.toContain(secreto);
    }
  });

  it('serializa instantes en ISO y el total como número', () => {
    const salida = aReservaPublica(reserva());
    expect(salida.inicioEn).toBe('2026-03-11T15:00:00.000Z');
    expect(salida.finEn).toBe('2026-03-11T15:30:00.000Z');
    expect(salida.total).toBe(30000);
    expect(salida.codigo).toBe('CDS-A1B2');
    expect(salida.estado).toBe('CONFIRMADA');
  });

  it('las líneas salen como servicios reservados, sin descripción ni incluye', () => {
    const [linea] = aReservaPublica(reserva()).servicios;
    expect(ordenadas(linea!)).toEqual(['duracionMinutos', 'nombre', 'precio', 'servicioId']);
    expect(linea).toMatchObject({ nombre: 'Corte clásico', precio: 30000, duracionMinutos: 30 });
  });

  it('el barbero de la reserva sale con alias y sin datos internos', () => {
    const { barbero, sede } = aReservaPublica(reserva());
    expect(barbero.nombre).toBe('Andy');
    expect(ordenadas(barbero)).toEqual(['bio', 'fotoUrl', 'id', 'nombre']);
    expect(ordenadas(sede)).toEqual(['ciudad', 'direccion', 'id', 'mapsUrl', 'nombre', 'telefono']);
  });
});

describe('aServicioPublico', () => {
  it('el servicio público no expone el buffer interno', () => {
    // bufferMinutos es tiempo de limpieza: el modelo dice explícitamente que el
    // cliente no lo ve.
    expect(ordenadas(aServicioPublico(servicio({ bufferMinutos: 10 })))).toEqual([
      'descripcion', 'duracionMinutos', 'id', 'incluye', 'nombre', 'precio',
    ]);
  });

  it('convierte el precio Decimal en número y rellena lo opcional', () => {
    const salida = aServicioPublico(servicio({ precio: new Prisma.Decimal('45000.50') }));
    expect(salida.precio).toBe(45000.5);
    expect(salida.descripcion).toBeNull();
    expect(salida.incluye).toEqual([]);
  });
});

describe('aServicioReservado', () => {
  it('el servicio reservado tiene exactamente estas claves', () => {
    expect(ordenadas(aServicioReservado(lineaServicio()))).toEqual([
      'duracionMinutos', 'nombre', 'precio', 'servicioId',
    ]);
  });

  it('usa el snapshot congelado, no datos vivos del catálogo', () => {
    const salida = aServicioReservado(
      lineaServicio({ nombreSnapshot: 'Corte viejo', precioSnapshot: new Prisma.Decimal(25000) }),
    );
    expect(salida).toEqual({
      servicioId: ID.servicioCorte,
      nombre: 'Corte viejo',
      precio: 25000,
      duracionMinutos: 30,
    });
  });
});

describe('aSedePublica', () => {
  it('no expone notas internas, slug ni estado', () => {
    // Fila completa de Prisma, con campos que el mapeador no debe copiar.
    const filaDePrisma = {
      id: ID.sede,
      nombre: 'Sede Centro',
      direccion: 'Calle 1',
      ciudad: 'Bogotá',
      telefono: '+576011234567',
      mapsUrl: null,
      notas: 'la llave está bajo el tapete',
      slug: 'centro',
      activa: true,
    };
    const salida = aSedePublica(filaDePrisma);
    expect(ordenadas(salida)).toEqual(['ciudad', 'direccion', 'id', 'mapsUrl', 'nombre', 'telefono']);
    expect(JSON.stringify(salida)).not.toContain('tapete');
  });
});

describe('aBarberoPublico', () => {
  it('el barbero público no expone contacto ni rol', () => {
    expect(ordenadas(aBarberoPublico(usuarioBarbero()))).toEqual(['bio', 'fotoUrl', 'id', 'nombre']);
  });

  it('con alias, el nombre real no sale en ningún campo', () => {
    const salida = aBarberoPublico(usuarioBarbero({ alias: 'Andy' }));
    expect(salida.nombre).toBe('Andy');
    expect(JSON.stringify(salida)).not.toContain('Andrés');
    expect(JSON.stringify(salida)).not.toContain('Gómez');
  });

  it('sin alias, usa el nombre', () => {
    expect(aBarberoPublico(usuarioBarbero()).nombre).toBe('Andrés');
  });
});

describe('aHuecoPublico', () => {
  it('colapsa los motivos internos de ocupación', () => {
    for (const motivo of ['OCUPADO', 'ALMUERZO', 'DESCANSO', 'PASADO'] as const) {
      const salida = aHuecoPublico(hueco({ motivo }));
      expect(salida.disponible).toBe(false);
      expect(salida.motivo).toBeUndefined();
      expect('motivo' in salida).toBe(false);
    }
  });

  it('conserva los motivos que ayudan al cliente', () => {
    // ANTELACION y NO_CABE sí le explican por qué no puede elegir esa hora.
    expect(aHuecoPublico(hueco({ motivo: 'ANTELACION' })).motivo).toBe('ANTELACION');
    expect(aHuecoPublico(hueco({ motivo: 'NO_CABE' })).motivo).toBe('NO_CABE');
  });

  it('PASADO, motivo interno de la disponibilidad, no sale', () => {
    const salida = aHuecoPublico(hueco({ motivo: 'PASADO' }));
    expect(salida).toEqual({ inicioEn: '2026-03-11T14:30:00.000Z', hora: '09:30', disponible: false });
  });

  it('un hueco libre sale con claves exactas y sin motivo', () => {
    expect(ordenadas(aHuecoPublico(hueco({ disponible: true })))).toEqual([
      'disponible', 'hora', 'inicioEn',
    ]);
  });
});

describe('contrato de tipos', () => {
  it('los motivos internos no son representables', () => {
    expectTypeOf<HuecoPublico['motivo']>().toEqualTypeOf<'ANTELACION' | 'NO_CABE' | undefined>();
    // @ts-expect-error OCUPADO no puede salir al público
    const _fuga: HuecoPublico = { inicioEn: '', hora: '', disponible: false, motivo: 'OCUPADO' };
    void _fuga;
  });

  it('la reserva pública lista servicios reservados, no del catálogo', () => {
    expectTypeOf<ReservaPublica['servicios']>().toEqualTypeOf<ServicioReservado[]>();
    expectTypeOf<keyof ServicioReservado>().toEqualTypeOf<
      'servicioId' | 'nombre' | 'precio' | 'duracionMinutos'
    >();
  });

  it('el barbero público no tiene campo alias', () => {
    expectTypeOf<keyof BarberoPublico>().toEqualTypeOf<'id' | 'nombre' | 'bio' | 'fotoUrl'>();
  });
});
