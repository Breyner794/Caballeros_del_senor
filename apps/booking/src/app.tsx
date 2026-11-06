import { Route, Routes } from 'react-router-dom';
import { Reservar } from '@/paginas/reservar';

/**
 * La raíz es el asistente de reserva. Cualquier otra dirección también lo
 * muestra, para que un enlace mal escrito lleve a reservar y no a una página
 * en blanco. `/cita` (gestión) se añade en su propia tarea, antes del comodín.
 */
export function App() {
  return (
    <Routes>
      <Route path="/" element={<Reservar />} />
      <Route path="*" element={<Reservar />} />
    </Routes>
  );
}
