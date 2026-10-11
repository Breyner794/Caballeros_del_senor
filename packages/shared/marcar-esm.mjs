/**
 * El paquete se publica en dos formatos: la API de Nest lo consume como
 * CommonJS y los frontends de Vite como ESM. Node decide el formato de un
 * archivo .js por el "type" del package.json mas cercano, asi que hay que
 * dejar uno dentro de cada carpeta de salida.
 */
import { writeFileSync } from 'node:fs';

writeFileSync('dist/cjs/package.json', JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');
writeFileSync('dist/esm/package.json', JSON.stringify({ type: 'module' }, null, 2) + '\n');
console.log('Formatos marcados: dist/cjs (commonjs) y dist/esm (module)');
