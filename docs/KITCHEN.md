# SINTECH ERP 2.2 — Recetas y cocina

## Uso

1. En **Import invoice**, revise y confirme una factura con productos y sus cantidades en la unidad de inventario. **Receive inventory** registra las existencias si no se recibieron durante la importación.
2. En **Recipes & costs → New recipe**, indique nombre, porciones que rinde la receta completa, precio por porción y porcentaje objetivo de costo de alimentos.
3. Agregue los ingredientes y las cantidades crudas retiradas del inventario, incluyendo pérdidas de limpieza/cocción. Use la unidad de cada producto: 8 oz son 0.5 lb si el producto está registrado en lb. No hay conversiones automáticas entre cajas, peso o volumen.
4. Guarde la receta. **View** permite consultar costos, cantidades, factura de referencia, notas e imprimir; **Edit** permite modificar o desactivar. **Export costs** descarga el comparativo.
5. En **Kitchen usage**, seleccione **Recipe preparation**, receta y porciones realmente preparadas. Revise los ingredientes calculados y confirme **Post & deduct inventory** una sola vez por preparación. El sistema asigna la fecha actual de Nueva York.
6. Para una pérdida, seleccione **Ingredient waste**, producto, cantidad y motivo. Esto retira materia prima del inventario; no sirve para volver a descontar ingredientes de un plato ya registrado como preparado.
7. Un administrador puede usar **Reverse** para corregir una entrada registrada por error. Devuelve exactamente las cantidades originales y conserva el historial. No se debe revertir una preparación que sí ocurrió.

## Cálculos y límites

- Costo de ingrediente = suma de importes de sus renglones / suma de cantidades de inventario en la última factura aprobada por fecha. Desempate estable por ID. Las facturas borrador/anuladas quedan fuera.
- Ejemplo: $25 por 2 cajas que contienen 24 bolsas = $25 / 24 por bolsa, no $12.50 por bolsa.
- La preparación escala cantidades por porciones / rendimiento. Se redondea hacia arriba a 0.001 de la unidad de inventario. Cada costo de renglón se redondea a centavos.
- Costo por porción = costo de receta / rendimiento. Food cost % = costo por porción / precio de venta. Precio al objetivo = costo por porción / porcentaje objetivo.
- Contribution es precio menos ingredientes, **antes** de mano de obra, comisiones, gastos y otros costos. No es utilidad neta.
- Los costos son estimaciones de última compra; excluyen impuesto, flete y descuentos generales de factura. No son FIFO, promedio ponderado ni valoración contable.
- Si falta el costo de cualquier ingrediente, el total queda sin costo completo. Los reportes separan los costos conocidos y el número de entradas sin costo completo.
- Las entradas guardan cantidades, nombres, unidades y costos del momento. Editar recetas o cargar nuevas facturas no altera esas entradas.
- La preparación consume ingredientes y registra porciones. No crea inventario de platos terminados, subrecetas ni lotes con vencimiento. No importa ventas ni se conecta aún al POS.
- La merma de esta etapa se registra por ingrediente. La merma de comida preparada requerirá el siguiente módulo de producción/terminados.

## Controles

- Separación por restaurante, lectura para viewer; edición y consumo para admin/accountant; reversión solo admin.
- Descuento atómico con el mismo bloqueo de negocio usado por facturas y ajustes; no permite existencias negativas ni descuentos parciales por falta de ingredientes.
- Solicitudes con ID único impiden duplicación por reintentos. La confirmación humana sigue siendo necesaria para no registrar una misma preparación en solicitudes distintas.
- Control de versión de recetas, prohibición de ingredientes repetidos y de cambiar unidades usadas en recetas.
- Auditoría y respaldos incluyen recetas, entradas y movimientos; recuperación crea otro negocio preservando enlaces internos.
- No se agregaron recetas, precios, productos ni movimientos ficticios a los restaurantes reales.

## Continuación del ERP

Completado: proveedores/AP/pagos, compras, documentos, importación de facturas e inventario; esta versión agrega recetas/costos y registro de consumo de cocina.

Próximas etapas: producción con inventario de preparados y subrecetas; ventas/POS con reglas para evitar doble consumo; después rentabilidad operativa y reportes consolidados. RR. HH. y nómina se mantienen como módulos posteriores independientes. La conexión a Square requiere seleccionar cuenta/local y conceder acceso cuando llegue esa etapa.
