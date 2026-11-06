import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from '@/app';
import '@/estilos.css';

/**
 * Configuración de las consultas.
 *
 * `retry: 1` y no 3: si la API responde un error de negocio (horario ocupado,
 * enlace no válido) reintentar no cambia nada y solo retrasa el mensaje al
 * cliente. El único caso que merece reintento es un fallo de red puntual.
 */
const clienteConsultas = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
  },
});

createRoot(document.getElementById('raiz') as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={clienteConsultas}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
