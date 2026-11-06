import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { arrancarAplicacion, type AplicacionDePruebas } from './soporte/aplicacion.js';

/**
 * Arranque real de la aplicación: el grafo completo de módulos de Nest.
 *
 * Las pruebas unitarias construyen cada servicio a mano, sin pasar por el
 * contenedor de inyección, así que un error de cableado (un provider que falta
 * en `providers`, un módulo sin exportar lo que otro necesita, una dependencia
 * circular) pasaría en verde y solo reventaría al ejecutar `pnpm dev`. Esta
 * prueba levanta `AppModule` entero contra la base de pruebas y exige que Nest
 * resuelva todas las dependencias.
 *
 * Además hace peticiones HTTP reales: comprueba que los guards globales (límite
 * de peticiones, autenticación, permisos) están bien enlazados y que
 * `@Publico()` deja pasar a quien no tiene sesión.
 */

let aplicacion: AplicacionDePruebas;

beforeAll(async () => {
  aplicacion = await arrancarAplicacion();
});

afterAll(async () => {
  await aplicacion?.app.close();
});

describe('arranque de la aplicación', () => {
  it('Nest construye el grafo completo de módulos sin fallar', () => {
    // Si el contenedor no resolviera una dependencia, `beforeAll` habría
    // lanzado antes de llegar aquí; esto solo deja constancia de que existe.
    expect(aplicacion.app).toBeDefined();
  });

  it('una ruta pública responde sin sesión: los guards globales están bien enlazados', async () => {
    const respuesta = await fetch(`${aplicacion.base}/publico/opciones`);
    expect(respuesta.status).toBe(200);
    const cuerpo = (await respuesta.json()) as { sedes: unknown[]; servicios: unknown[] };
    expect(Array.isArray(cuerpo.sedes)).toBe(true);
    expect(Array.isArray(cuerpo.servicios)).toBe(true);
  });

  it('una ruta privada sin sesión se rechaza con 401', async () => {
    const respuesta = await fetch(`${aplicacion.base}/reservas`);
    expect(respuesta.status).toBe(401);
  });
});
