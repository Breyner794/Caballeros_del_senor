import { Hammer } from 'lucide-react';
import { Encabezado } from '@/componentes/armazon';
import { Tarjeta } from '@/componentes/ui/tarjeta';
import { EstadoVacio } from '@/componentes/ui/varios';

/**
 * Pantalla honesta para los módulos que aún no están.
 *
 * Es mejor que una ruta rota o un menú que no lleva a ninguna parte: quien
 * prueba el panel ve de inmediato qué hay hecho y qué falta, y el menú ya
 * refleja la forma final del producto.
 */
export function PaginaEnConstruccion({
  titulo,
  descripcion,
  pendiente,
}: {
  titulo: string;
  descripcion: string;
  pendiente: string;
}) {
  return (
    <>
      <Encabezado titulo={titulo} descripcion={descripcion} />
      <Tarjeta>
        <EstadoVacio icono={Hammer} titulo="Módulo en construcción" descripcion={pendiente} />
      </Tarjeta>
    </>
  );
}
