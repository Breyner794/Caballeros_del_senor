import { describe, expect, it } from 'vitest';
import { validarEntorno } from './entorno.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};

describe('validarEntorno · TURNSTILE_SECRET_KEY', () => {
  it('en producción, sin la clave la API no arranca', () => {
    expect(() => validarEntorno({ ...base, NODE_ENV: 'production' })).toThrow(/TURNSTILE_SECRET_KEY/);
  });

  it('en producción, con la clave arranca', () => {
    const entorno = validarEntorno({ ...base, NODE_ENV: 'production', TURNSTILE_SECRET_KEY: 'secreto' });
    expect(entorno.TURNSTILE_SECRET_KEY).toBe('secreto');
  });

  it('en desarrollo es opcional', () => {
    expect(() => validarEntorno({ ...base, NODE_ENV: 'development' })).not.toThrow();
  });
});
