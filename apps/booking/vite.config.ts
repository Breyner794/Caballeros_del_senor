import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  // 5174 con `strictPort`: `BOOKING_ORIGIN` de la API y su CORS esperan ese
  // puerto. Si Vite saltara a otro en silencio, el navegador bloquearía todas
  // las peticiones y el síntoma (errores de CORS) no apuntaría a la causa.
  server: { port: 5174, strictPort: true },
});
