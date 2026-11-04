// Punto único de entrada del paquete compartido.
// La API y los dos frontends importan de aquí: `import { ... } from '@cds/shared'`

export * from './dominio/roles.js';
export * from './dominio/horarios.js';
export * from './dominio/telefono.js';
export * from './dominio/errores.js';
export * from './dominio/paginacion.js';

export * from './validaciones/comunes.js';
export * from './validaciones/auth.js';
export * from './validaciones/catalogo.js';
export * from './validaciones/reservas.js';
export * from './validaciones/agenda.js';
export * from './validaciones/publico.js';
