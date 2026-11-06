import { mensajeDeError } from '@/lib/errores';
import { Aviso } from '@/componentes/ui/aviso';
import { Boton } from '@/componentes/ui/boton';

/**
 * Lo que ve el cliente cuando una consulta falla: el motivo en sus palabras y
 * una salida. Nunca una pantalla en blanco.
 */
export function ErrorConsulta({ error, alReintentar }: { error: unknown; alReintentar: () => void }) {
  return (
    <div className="space-y-3">
      <Aviso>{mensajeDeError(error)}</Aviso>
      <Boton variante="contorno" className="w-full" onClick={alReintentar}>
        Reintentar
      </Boton>
    </div>
  );
}
