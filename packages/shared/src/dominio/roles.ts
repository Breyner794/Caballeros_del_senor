/**
 * Roles del panel administrativo y lo que cada uno puede hacer.
 *
 * El permiso es la unidad mínima: los guards de la API y los menús del panel
 * leen de aquí, de modo que añadir un rol nuevo no obliga a tocar cada módulo.
 */

export const ROLES = ['ADMIN', 'RECEPCIONISTA', 'BARBERO', 'CONTADOR'] as const;
export type Rol = (typeof ROLES)[number];

export const PERMISOS = [
  // Clientes
  'clientes:ver',
  'clientes:crear',
  'clientes:editar',
  'clientes:eliminar',
  // Reservas
  'reservas:ver', // ve las suyas si es barbero
  'reservas:ver_todas', // ve las de cualquier barbero
  'reservas:crear',
  'reservas:editar',
  'reservas:cancelar',
  'reservas:completar',
  // Servicios
  'servicios:ver',
  'servicios:gestionar',
  // Agenda / cronograma
  'agenda:ver',
  'agenda:gestionar_propia',
  'agenda:gestionar_todas',
  // Disponibilidad
  'disponibilidad:ver',
  'disponibilidad:ver_todas',
  // Inventario
  'inventario:ver',
  'inventario:gestionar',
  // Sedes
  'sedes:ver',
  'sedes:gestionar',
  // Usuarios
  'usuarios:ver',
  'usuarios:gestionar',
  // Fidelidad
  'fidelidad:ver',
  'fidelidad:canjear',
  'fidelidad:configurar',
  // Contabilidad
  'contabilidad:ver',
  'contabilidad:ver_todas_sedes',
  'contabilidad:configurar_comisiones',
  'contabilidad:exportar',
  // Configuración global
  'configuracion:ver',
  'configuracion:gestionar',
  // Auditoría y errores
  'auditoria:ver',
  'errores:ver',
] as const;

export type Permiso = (typeof PERMISOS)[number];

/**
 * Qué permisos trae cada rol.
 *
 * Criterio de diseño:
 *  - ADMIN: todo.
 *  - RECEPCIONISTA: opera el día a día (reservas, clientes, caja, agendas de
 *    todos los barberos) pero no toca usuarios, comisiones ni configuración.
 *  - BARBERO: solo lo suyo. Ve su agenda y sus reservas, registra ventas y
 *    canjea premios de fidelidad, pero no ve la caja de los demás.
 *  - CONTADOR: lectura amplia del dinero y del inventario, cero capacidad de
 *    operar la barbería. Es el rol más restringido en escritura.
 */
export const PERMISOS_POR_ROL: Record<Rol, readonly Permiso[]> = {
  ADMIN: PERMISOS,

  RECEPCIONISTA: [
    'clientes:ver',
    'clientes:crear',
    'clientes:editar',
    'reservas:ver',
    'reservas:ver_todas',
    'reservas:crear',
    'reservas:editar',
    'reservas:cancelar',
    'reservas:completar',
    'servicios:ver',
    'agenda:ver',
    'agenda:gestionar_todas',
    'disponibilidad:ver',
    'disponibilidad:ver_todas',
    'inventario:ver',
    'inventario:gestionar',
    'sedes:ver',
    'usuarios:ver',
    'fidelidad:ver',
    'fidelidad:canjear',
    'configuracion:ver',
  ],

  BARBERO: [
    'clientes:ver',
    'clientes:crear',
    'clientes:editar',
    'reservas:ver',
    'reservas:crear',
    'reservas:editar',
    'reservas:cancelar',
    'reservas:completar',
    'servicios:ver',
    'agenda:ver',
    'agenda:gestionar_propia',
    'disponibilidad:ver',
    'inventario:ver',
    'sedes:ver',
    'fidelidad:ver',
    'fidelidad:canjear',
  ],

  CONTADOR: [
    'clientes:ver',
    'reservas:ver_todas',
    'servicios:ver',
    'inventario:ver',
    'sedes:ver',
    'usuarios:ver',
    'fidelidad:ver',
    'contabilidad:ver',
    'contabilidad:ver_todas_sedes',
    'contabilidad:exportar',
    'auditoria:ver',
  ],
};

export function tienePermiso(rol: Rol, permiso: Permiso): boolean {
  return PERMISOS_POR_ROL[rol].includes(permiso);
}

export function tieneAlgunPermiso(rol: Rol, permisos: readonly Permiso[]): boolean {
  return permisos.some((p) => tienePermiso(rol, p));
}

export const ETIQUETAS_ROL: Record<Rol, string> = {
  ADMIN: 'Administrador',
  RECEPCIONISTA: 'Recepcionista',
  BARBERO: 'Barbero',
  CONTADOR: 'Contador',
};
