import { Route, Routes } from 'react-router-dom';
import { Cita } from '@/paginas/cita';
import { Reservar } from '@/paginas/reservar';

/**
 * La raíz es el asistente de reserva. Cualquier otra dirección también lo
 * muestra, para que un enlace mal escrito lleve a reservar y no a una página
 * en blanco. `/cita` es la gestión de la cita (el enlace lleva el token en el
 * fragmento) y va antes del comodín.
 */
export function App() {
  return (
    <Routes>
      <Route path="/" element={<Reservar />} />
      <Route path="/cita" element={<Cita />} />
      <Route path="*" element={<Reservar />} />
    </Routes>
  );
}
