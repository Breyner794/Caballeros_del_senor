import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Loader2, Scissors } from 'lucide-react';
import { useSesion } from '@/hooks/sesion';
import { Armazon } from '@/componentes/armazon';
import { PaginaEntrar } from '@/paginas/entrar';
import { PaginaHoy } from '@/paginas/hoy';
import { PaginaDisponibilidad } from '@/paginas/disponibilidad';
import { PaginaClientes } from '@/paginas/clientes';
import { PaginaServicios } from '@/paginas/servicios';
import { PaginaReservas } from '@/paginas/reservas';
import { PaginaCronograma } from '@/paginas/cronograma';
import { PaginaUsuarios } from '@/paginas/usuarios';
import { PaginaSedes } from '@/paginas/sedes';
import { PaginaConfiguracion } from '@/paginas/configuracion';
import { PaginaPerfil } from '@/paginas/perfil';
import { PaginaEnConstruccion } from '@/paginas/en-construccion';

/** Mientras se comprueba si hay sesión viva en la cookie de refresco. */
function Arrancando() {
  return (
    <div className="bg-background flex min-h-screen flex-col items-center justify-center gap-3">
      <span className="bg-primary text-primary-foreground flex size-11 items-center justify-center rounded-xl">
        <Scissors className="size-5" />
      </span>
      <Loader2 className="text-muted-foreground size-4 animate-spin" />
    </div>
  );
}

function SoloConSesion({ children }: { children: React.ReactNode }) {
  const { usuario, cargando } = useSesion();
  const ubicacion = useLocation();

  if (cargando) return <Arrancando />;
  // Se recuerda a dónde quería ir para devolverlo ahí tras iniciar sesión.
  if (!usuario) return <Navigate to="/entrar" replace state={{ desde: ubicacion.pathname }} />;
  return <>{children}</>;
}

export function App() {
  const { usuario, cargando } = useSesion();

  return (
    <Routes>
      <Route
        path="/entrar"
        element={cargando ? <Arrancando /> : usuario ? <Navigate to="/" replace /> : <PaginaEntrar />}
      />

      <Route
        element={
          <SoloConSesion>
            <Armazon />
          </SoloConSesion>
        }
      >
        <Route index element={<PaginaHoy />} />
        <Route path="/disponibilidad" element={<PaginaDisponibilidad />} />
        <Route path="/clientes" element={<PaginaClientes />} />
        <Route path="/servicios" element={<PaginaServicios />} />

        <Route path="/reservas" element={<PaginaReservas />} />
        <Route path="/cronograma" element={<PaginaCronograma />} />
        <Route
          path="/inventario"
          element={
            <PaginaEnConstruccion
              titulo="Inventario"
              descripcion="Entradas de productos, stock por sede y ventas de mostrador."
              pendiente="El modelo de datos y el descuento de stock al vender ya están; falta la pantalla de productos y movimientos."
            />
          }
        />
        <Route
          path="/contabilidad"
          element={
            <PaginaEnConstruccion
              titulo="Contabilidad"
              descripcion="Resumen de ingresos por barbero, por sede y en total."
              pendiente="Las ventas ya se registran con la comisión congelada y los porcentajes historizados. Faltan los gráficos y la calculadora de reparto."
            />
          }
        />
        <Route path="/sedes" element={<PaginaSedes />} />
        <Route path="/usuarios" element={<PaginaUsuarios />} />
        <Route
          path="/auditoria"
          element={
            <PaginaEnConstruccion
              titulo="Auditoría"
              descripcion="Quién hizo qué, cuándo y desde dónde."
              pendiente="Ya se registra todo (incluido quién entregó cada premio de fidelidad y quién atendió sin registrar al cliente). Falta la pantalla para consultarlo."
            />
          }
        />
        <Route path="/configuracion" element={<PaginaConfiguracion />} />
        <Route path="/perfil" element={<PaginaPerfil />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
