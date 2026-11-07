import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Sin `globals`, Testing Library no limpia el DOM sola entre pruebas.
afterEach(() => {
  cleanup();
});
