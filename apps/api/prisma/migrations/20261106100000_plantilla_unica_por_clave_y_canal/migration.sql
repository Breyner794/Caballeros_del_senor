-- El mismo evento (`clave`) tiene una plantilla por canal: la de WhatsApp de
-- `reserva.confirmada` convive con la de correo. La tabla no tenía filas
-- reales antes de esta migración, así que el cambio no puede chocar con datos.

-- DropIndex
DROP INDEX "plantillas_notificacion_clave_key";

-- CreateIndex
CREATE UNIQUE INDEX "plantillas_notificacion_clave_canal_key" ON "plantillas_notificacion"("clave", "canal");
