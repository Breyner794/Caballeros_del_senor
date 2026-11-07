/**
 * Datos iniciales.
 *
 * Es idempotente: se puede ejecutar varias veces sin duplicar nada (todo va
 * por `upsert` con claves naturales). Eso permite usarlo también para dejar un
 * despliegue nuevo listo, no solo para desarrollo.
 *
 * Las contraseñas de los usuarios de ejemplo se marcan con
 * `debeCambiarPassword: true`: al entrar por primera vez el panel obliga a
 * cambiarlas.
 */
import { PrismaClient, type Rol } from '@prisma/client';
import * as argon2 from 'argon2';
import path from 'node:path';
import { config as cargarEnv } from 'dotenv';

cargarEnv({ path: path.resolve(__dirname, '../../../.env'), quiet: true });

const prisma = new PrismaClient();

const OPCIONES_ARGON: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/** Contraseña común para los usuarios de ejemplo. Se cambia al primer acceso. */
const PASSWORD_DEMO = 'Barberia2026!';

/**
 * Con SEED_DEMO=false se siembra solo lo que el sistema necesita para
 * funcionar (configuración global, plantillas de notificación, festivos,
 * comisión por defecto, cliente genérico y categorías) más una sede y el
 * administrador. Quedan fuera las tres sedes de Bogotá, los servicios con
 * precios inventados, los cinco usuarios de ejemplo y sus agendas.
 *
 * Importa porque las sedes no se pueden borrar desde el panel, solo
 * desactivar: sembrar la demo en una barbería real deja sedes fantasma para
 * siempre.
 */
const SEMBRAR_DEMO = (process.env.SEED_DEMO ?? 'true').trim().toLowerCase() !== 'false';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL?.trim() || 'admin@caballerosdelsenor.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD?.trim() || PASSWORD_DEMO;
const SEDE_NOMBRE = process.env.SEDE_NOMBRE?.trim() || 'Sede principal';

// En modo limpio no se tolera el correo ni la contraseña de ejemplo: esa
// contraseña está escrita en este archivo, que es público, y ese dominio no
// existe. Igual que la validación de entorno de la API, es preferible no
// arrancar a arrancar con una puerta abierta.
if (!SEMBRAR_DEMO) {
  const faltan: string[] = [];
  if (!process.env.ADMIN_EMAIL?.trim()) faltan.push('ADMIN_EMAIL');
  if (!process.env.ADMIN_PASSWORD?.trim()) faltan.push('ADMIN_PASSWORD');
  if (faltan.length > 0) {
    console.error(
      `\nCon SEED_DEMO=false hacen falta estas variables: ${faltan.join(', ')}\n`,
    );
    process.exit(1);
  }
}

const hora = (h: number, m = 0) => h * 60 + m;

function aSlug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function main() {
  console.log('Sembrando datos iniciales…\n');

  // ------------------------------------------------------------------ SEDES
  // En modo limpio, una sola sede a medio rellenar: el panel permite editarla
  // pero no borrarla, así que cuantas menos se creen, mejor.
  const sedesDefinicion = !SEMBRAR_DEMO
    ? [
        {
          nombre: SEDE_NOMBRE,
          direccion: 'Pendiente de completar',
          ciudad: undefined,
          telefono: undefined,
          orden: 1,
        },
      ]
    : [
    {
      nombre: 'Caballeros del Señor — Centro',
      direccion: 'Calle 45 # 12-30, Centro',
      ciudad: 'Bogotá',
      telefono: '6012345678',
      orden: 1,
    },
    {
      nombre: 'Caballeros del Señor — Norte',
      direccion: 'Carrera 15 # 102-45, Chicó',
      ciudad: 'Bogotá',
      telefono: '6012345679',
      orden: 2,
    },
    {
      nombre: 'Caballeros del Señor — Sur',
      direccion: 'Avenida 68 Sur # 24-10, Venecia',
      ciudad: 'Bogotá',
      telefono: '6012345680',
      orden: 3,
    },
  ];

  const sedes = [];
  for (const def of sedesDefinicion) {
    const slug = aSlug(def.nombre);
    const sede = await prisma.sede.upsert({
      where: { slug },
      update: { nombre: def.nombre, direccion: def.direccion, ciudad: def.ciudad },
      create: { ...def, slug },
    });

    // Horario de atención: lunes a sábado 8–20, domingo cerrado.
    for (let dia = 0; dia <= 6; dia++) {
      const cerrado = dia === 0;
      await prisma.sedeHorario.upsert({
        where: { sedeId_diaSemana: { sedeId: sede.id, diaSemana: dia } },
        update: {},
        create: {
          sedeId: sede.id,
          diaSemana: dia,
          horaInicio: cerrado ? 0 : hora(8),
          horaFin: cerrado ? 0 : hora(20),
          cerrado,
        },
      });
    }

    sedes.push(sede);
    console.log(`  Sede: ${sede.nombre}`);
  }

  const [centro, norte, sur] = sedes;
  if (!centro) throw new Error('No se pudo crear la sede inicial');
  if (SEMBRAR_DEMO && (!norte || !sur)) {
    throw new Error('No se pudieron crear las sedes de demostración');
  }

  // ------------------------------------------------------- CONFIGURACIÓN
  await prisma.configuracionGlobal.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      nombreNegocio: 'Caballeros del Señor',
      zonaHoraria: 'America/Bogota',
      moneda: 'COP',
      slotMinutosDefault: 30,
      // El tiempo de limpieza de máquinas y silla entre clientes. Arranca en 0
      // y el administrador lo sube cuando decida cuánto necesita.
      bufferMinutosDefault: 0,
      minAntelacionMinutos: 60,
      maxDiasAnticipacion: 45,
      horasLimiteCancelacion: 4,
      horasLimiteReprogramacion: 4,
      permiteElegirBarbero: true,
      requiereConfirmacion: false,
      maxReservasActivasCliente: 2,
      recordatorioWhatsappHoras: 24,
      telefonoContacto: '+573001234567',
    },
  });
  console.log('  Configuración global');

  await prisma.programaFidelidad.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      activo: true,
      nombre: 'Tarjeta de cortes',
      // 7 sellos acumulados → el 8º corte es gratis.
      sellosRequeridos: 7,
      diasValidezSello: 365,
      canjeGeneraSello: false,
      acumulaPorSede: false,
      mensajePremio: '¡Este corte va por la casa! Completaste tu tarjeta.',
    },
  });
  console.log('  Programa de fidelidad (7 sellos → 8º corte gratis)');

  // -------------------------------------------------------- DÍAS FESTIVOS
  // Festivos colombianos de lo que queda de 2026 y comienzos de 2027.
  const festivos = [
    { fecha: '2026-11-02', nombre: 'Día de Todos los Santos' },
    { fecha: '2026-11-16', nombre: 'Independencia de Cartagena' },
    { fecha: '2026-12-08', nombre: 'Inmaculada Concepción' },
    { fecha: '2026-12-25', nombre: 'Navidad' },
    { fecha: '2027-01-01', nombre: 'Año Nuevo' },
    { fecha: '2027-01-11', nombre: 'Reyes Magos' },
  ];

  for (const festivo of festivos) {
    const fecha = new Date(`${festivo.fecha}T00:00:00Z`);
    const existente = await prisma.diaEspecial.findFirst({
      where: { fecha, sedeId: null },
    });
    if (!existente) {
      await prisma.diaEspecial.create({
        data: {
          fecha,
          nombre: festivo.nombre,
          // Festivo pero abierto: en una barbería son los días más fuertes.
          // El administrador puede cambiarlo a cerrado cuando quiera.
          tipo: 'FESTIVO_ABIERTO',
          horaInicio: hora(9),
          horaFin: hora(18),
          visibleWeb: true,
        },
      });
    }
  }
  console.log(`  ${festivos.length} días festivos cargados`);

  // ------------------------------------------------------------- SERVICIOS
  // Los precios de abajo son inventados: en modo limpio no se siembra ninguno
  // y el catálogo se da de alta desde el panel.
  const serviciosDefinicion = !SEMBRAR_DEMO ? [] : [
    {
      nombre: 'Corte clásico',
      descripcion: 'Corte a tijera y máquina, acabado a navaja.',
      incluye: ['Lavado', 'Secado', 'Perfilado de contornos'],
      precio: 25000,
      duracionMinutos: 30,
      color: '#b45309',
      orden: 1,
    },
    {
      nombre: 'Corte + barba',
      descripcion: 'El corte completo con arreglo de barba y toalla caliente.',
      incluye: ['Lavado', 'Perfilado de barba', 'Toalla caliente', 'Bálsamo'],
      precio: 40000,
      duracionMinutos: 60,
      color: '#7c2d12',
      orden: 2,
    },
    {
      nombre: 'Arreglo de barba',
      descripcion: 'Perfilado, apurado y hidratación.',
      incluye: ['Toalla caliente', 'Aceite de barba'],
      precio: 20000,
      duracionMinutos: 30,
      color: '#1d4ed8',
      orden: 3,
    },
    {
      nombre: 'Corte infantil',
      descripcion: 'Para los más pequeños, con toda la paciencia del mundo.',
      incluye: ['Lavado'],
      precio: 20000,
      duracionMinutos: 30,
      color: '#0891b2',
      orden: 4,
    },
    {
      nombre: 'Diseño de cejas',
      precio: 10000,
      duracionMinutos: 20,
      incluye: [],
      color: '#9333ea',
      orden: 5,
      // Un servicio corto no debería contar para el premio del 8º corte.
      cuentaFidelidad: false,
      canjeableFidelidad: false,
    },
    {
      nombre: 'Ritual completo',
      descripcion: 'Corte, barba, mascarilla facial y masaje capilar.',
      incluye: ['Lavado', 'Mascarilla facial', 'Masaje capilar', 'Toalla caliente'],
      precio: 65000,
      duracionMinutos: 90,
      color: '#be123c',
      orden: 6,
    },
  ];

  const servicios = [];
  for (const def of serviciosDefinicion) {
    const slug = aSlug(def.nombre);
    const servicio = await prisma.servicio.upsert({
      where: { slug },
      update: { precio: def.precio, duracionMinutos: def.duracionMinutos },
      create: { ...def, slug },
    });
    servicios.push(servicio);
  }
  if (servicios.length > 0) console.log(`  ${servicios.length} servicios`);

  // -------------------------------------------------------------- USUARIOS
  const passwordHash = await argon2.hash(ADMIN_PASSWORD, OPCIONES_ARGON);

  type DefUsuario = {
    nombre: string;
    apellido: string;
    email: string;
    telefono: string;
    rol: Rol;
    sedeId?: string;
    sedesExtra?: string[];
    alias?: string;
    slotMinutos?: number;
  };

  // El administrador se crea siempre; su correo sale de ADMIN_EMAIL.
  const usuariosDefinicion: DefUsuario[] = [
    {
      nombre: 'Jhoan',
      apellido: 'Quilindo',
      email: ADMIN_EMAIL,
      telefono: '+573001112233',
      rol: 'ADMIN',
    },
  ];

  // Los cinco de ejemplo solo en modo demo: dos de ellos viven en las sedes
  // norte y sur, que en una base limpia no existen.
  if (SEMBRAR_DEMO && norte && sur) {
    usuariosDefinicion.push(
      {
        nombre: 'Laura',
        apellido: 'Restrepo',
        email: 'recepcion@caballerosdelsenor.com',
        telefono: '+573002223344',
        rol: 'RECEPCIONISTA',
        sedeId: centro.id,
        sedesExtra: [norte.id, sur.id],
      },
      {
        nombre: 'Andrés',
        apellido: 'Gómez',
        email: 'andres@caballerosdelsenor.com',
        telefono: '+573003334455',
        rol: 'BARBERO',
        sedeId: centro.id,
        alias: 'El Maestro',
        // Este barbero trabaja con slots de 30 min (hereda el global).
      },
      {
        nombre: 'Camilo',
        apellido: 'Ortiz',
        email: 'camilo@caballerosdelsenor.com',
        telefono: '+573004445566',
        rol: 'BARBERO',
        sedeId: norte.id,
        sedesExtra: [centro.id],
        alias: 'Cami',
        // Configuró el suyo: un cambio del slot global ya no le afecta.
        slotMinutos: 20,
      },
      {
        nombre: 'Jeison',
        apellido: 'Mosquera',
        email: 'jeison@caballerosdelsenor.com',
        telefono: '+573005556677',
        rol: 'BARBERO',
        sedeId: sur.id,
        alias: 'Jei',
      },
      {
        nombre: 'Marta',
        apellido: 'Lozano',
        email: 'contador@caballerosdelsenor.com',
        telefono: '+573006667788',
        rol: 'CONTADOR',
      },
    );
  }

  const usuarios = [];
  for (const def of usuariosDefinicion) {
    const { sedesExtra, ...datos } = def;
    const usuario = await prisma.usuario.upsert({
      where: { email: datos.email },
      update: { nombre: datos.nombre, rol: datos.rol, sedeId: datos.sedeId ?? null },
      create: { ...datos, passwordHash, debeCambiarPassword: true },
    });

    for (const sedeId of sedesExtra ?? []) {
      await prisma.usuarioSede.upsert({
        where: { usuarioId_sedeId: { usuarioId: usuario.id, sedeId } },
        update: {},
        create: { usuarioId: usuario.id, sedeId },
      });
    }

    usuarios.push(usuario);
    console.log(`  Usuario ${usuario.email} (${usuario.rol})`);
  }

  // --------------------------------------------------------------- AGENDAS
  // Plantilla semanal de cada barbero en su sede principal:
  // lunes a viernes 9–19 con almuerzo 13–14, sábado 8–17 sin almuerzo largo.
  const barberos = usuarios.filter((u) => u.rol === 'BARBERO' && u.sedeId);

  for (const barbero of barberos) {
    for (let dia = 0; dia <= 6; dia++) {
      const esDomingo = dia === 0;
      const esSabado = dia === 6;

      const agenda = await prisma.agendaDia.upsert({
        where: {
          usuarioId_sedeId_diaSemana: {
            usuarioId: barbero.id,
            sedeId: barbero.sedeId as string,
            diaSemana: dia,
          },
        },
        update: {},
        create: {
          usuarioId: barbero.id,
          sedeId: barbero.sedeId as string,
          diaSemana: dia,
          trabaja: !esDomingo,
          horaInicio: esDomingo ? 0 : esSabado ? hora(8) : hora(9),
          horaFin: esDomingo ? 0 : esSabado ? hora(17) : hora(19),
        },
      });

      if (!esDomingo) {
        const yaTiene = await prisma.agendaBloque.findFirst({
          where: { agendaDiaId: agenda.id, tipo: 'ALMUERZO' },
        });
        if (!yaTiene) {
          await prisma.agendaBloque.create({
            data: {
              agendaDiaId: agenda.id,
              tipo: 'ALMUERZO',
              horaInicio: esSabado ? hora(12, 30) : hora(13),
              horaFin: esSabado ? hora(13) : hora(14),
              etiqueta: 'Almuerzo',
            },
          });
        }
      }
    }
    console.log(`  Agenda semanal de ${barbero.nombre}`);
  }

  // ------------------------------------------------------------ COMISIONES
  // Porcentaje global por defecto: el contador lo ajusta por barbero desde su
  // módulo. Se historiza, así que los cierres pasados no cambian al cambiarlo.
  const comisionGlobal = await prisma.configComision.findFirst({
    where: { alcance: 'GLOBAL', vigenteHasta: null },
  });
  if (!comisionGlobal) {
    await prisma.configComision.create({
      data: {
        alcance: 'GLOBAL',
        porcentaje: 50,
        porcentajeProducto: 10,
        vigenteDesde: new Date('2026-01-01T00:00:00Z'),
        notas: 'Reparto por defecto: 50% para el barbero sobre el servicio, 10% sobre producto.',
      },
    });
    console.log('  Comisión global por defecto: 50% servicios / 10% productos');
  }

  // ------------------------------------------------- CLIENTE GENÉRICO
  // Para los walk-ins que no quieren dejar sus datos. Hay un único registro
  // genérico, garantizado por un índice parcial en la base de datos.
  const generico = await prisma.cliente.findFirst({ where: { esGenerico: true } });
  if (!generico) {
    await prisma.cliente.create({
      data: {
        nombreCompleto: 'Consumidor final',
        telefono: '+570000000000',
        esGenerico: true,
        aceptaWhatsapp: false,
        notas:
          'Cliente genérico para ventas sin registrar. No acumula fidelidad: si el barbero no crea la ficha, el cliente no suma cortes.',
      },
    });
    console.log('  Cliente genérico "Consumidor final"');
  }

  // --------------------------------------------- CATEGORÍAS DE PRODUCTO
  const categorias = ['Cuidado del cabello', 'Cuidado de la barba', 'Facial', 'Insumos de barbería'];
  for (const [i, nombre] of categorias.entries()) {
    await prisma.categoriaProducto.upsert({
      where: { slug: aSlug(nombre) },
      update: {},
      create: { nombre, slug: aSlug(nombre), orden: i + 1 },
    });
  }
  console.log(`  ${categorias.length} categorías de producto`);

  // ------------------------------------------------ PLANTILLAS DE NOTIFICACIÓN
  // La clave es el evento y es única por canal (`clave` + `canal`): la plantilla
  // de WhatsApp de un evento convive con la de correo. En `update` va todo el
  // contenido salvo `activa`: una nueva siembra pone al día el texto, pero no
  // reactiva una plantilla que el dueño desactivó a propósito.
  const plantillas = [
    {
      clave: 'reserva.confirmada',
      canal: 'EMAIL' as const,
      nombre: 'Confirmación de cita (correo)',
      asunto: 'Tu cita {{codigo}} quedó registrada',
      cuerpo: [
        'Hola {{cliente}}:',
        '',
        'Recibimos tu cita en {{sede}} con {{barbero}} para el {{fecha}}.',
        'Tu código es {{codigo}}.',
        '',
        'Puedes verla, cancelarla o cambiar la hora aquí:',
        '{{enlace}}',
        '',
        'Este enlace es personal: no lo compartas.',
      ].join('\n'),
    },
    {
      // Al reprogramar el enlace anterior deja de servir: este correo trae el nuevo.
      clave: 'reserva.reprogramada',
      canal: 'EMAIL' as const,
      nombre: 'Cita reprogramada (correo)',
      asunto: 'Tu cita {{codigo}} cambió de hora',
      cuerpo: [
        'Hola {{cliente}}:',
        '',
        'Tu cita {{codigo}} en {{sede}} con {{barbero}} quedó para el {{fecha}}.',
        '',
        'Este es tu enlace nuevo para verla, cancelarla o cambiar la hora:',
        '{{enlace}}',
        '',
        'El enlace del correo anterior ya no funciona. Este es personal: no lo compartas.',
      ].join('\n'),
    },
  ];
  for (const { clave, canal, nombre, asunto, cuerpo } of plantillas) {
    await prisma.plantillaNotificacion.upsert({
      where: { clave_canal: { clave, canal } },
      update: { nombre, asunto, cuerpo },
      create: { clave, canal, nombre, asunto, cuerpo },
    });
  }
  console.log(`  ${plantillas.length} plantillas de notificación`);

  console.log('\nListo.\n');
  console.log('Puedes entrar al panel con:');
  for (const u of usuarios) console.log(`  ${u.email.padEnd(40)} ${u.rol}`);
  if (SEMBRAR_DEMO) {
    console.log(`\nContraseña para todos: ${PASSWORD_DEMO}`);
  } else {
    console.log('\nContraseña: la que pasaste en ADMIN_PASSWORD.');
    console.log(`Sede «${SEDE_NOMBRE}» creada sin dirección: complétala en el panel.`);
    console.log('Sin servicios ni barberos: dalos de alta desde el panel.');
  }
  console.log('(El panel obliga a cambiarla en el primer acceso.)\n');
}

main()
  .catch((error) => {
    console.error('\nFalló el sembrado:\n', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
