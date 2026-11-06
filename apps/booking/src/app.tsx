import { Route, Routes } from 'react-router-dom';

/** Las pantallas del flujo de reserva se montan aquí a medida que existen. */
export function App() {
  return (
    <Routes>
      <Route path="*" element={<p className="p-6">Caballeros del Señor</p>} />
    </Routes>
  );
}
