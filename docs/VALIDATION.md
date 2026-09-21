# Validación — SINTECH 2.1

`npm run check`: **28 pruebas aprobadas, 0 fallidas**, lint y build correctos.

La suite cubre cálculos en centavos, ciclo de facturas/pagos, duplicados, versiones, sobrepagos, reversos, auditoría, importación histórica, RLS y restricciones de escritura. Incluye PostgreSQL embebido PGlite y formularios React montados en JSDOM.

Para v2 verifica aislamiento entre empresas (incluyendo intentos de colisión de identificadores), roles, categorías, créditos aplicados, límites de saldo, idempotencia del pago agrupado, órdenes/recepción/conversión única, respaldos y recuperación con nuevos IDs. Verifica fechas de aprobación/reverso en reportes históricos y comparación por producto/marca/unidad. Los formularios nuevos prueban categorías, créditos, pagos agrupados y precios.

## Límites

Auth y Storage se simulan en las pruebas SQL. Estas pruebas no verifican envío de correo, configuración SMTP, JWT del servicio real, bytes de archivos, diseño visual o impresión en navegador real. No se introducen pagos ficticios en producción para probar los flujos.

La revisión visual de escritorio/móvil y la prueba de recuperación por correo siguen pendientes. Los reportes históricos reconstruyen saldos según fechas de negocio y aprobación/reverso; no son un libro mayor ni una certificación contable.

Los snapshots cargan todos los registros de una empresa. Su retención y la restauración dentro de la misma base no sustituyen respaldo externo de datos y Storage.

## Importación e inventario 2.1

Pruebas adicionales: creación de suplidor desde perfil, revisión obligatoria antes de publicar, cantidades de caja frente a unidad de inventario, extracción de campos y agrupación de texto PDF. PostgreSQL verifica transacción completa con rollback, archivo repetido, idempotencia, cantidades negativas rechazadas, separación entre empresas, revocación de helpers, anulación de existencias y restauración de líneas/productos/movimientos.

Los motores reales PDF.js/Tesseract se probaron localmente con una factura sintética en PDF de texto, imagen PNG y PDF escaneado: se detectaron dos productos y el total de 40.17 en los tres casos. OCR confundió lb con Ib en el ejemplo escaneado: la unidad quedó vacía para revisión, sin convertirla silenciosamente. No se ha comprobado la extracción del contenido del documento real NebraskaLand.pdf.

La instalación del navegador de pruebas no pudo descargar Chromium; no se afirma una prueba visual completa ni OCR de punta a punta en Edge. Los formularios se verificaron montados en JSDOM y los motores en Node.

La corrección 2.1.1 incorpora pruebas para tablas de peso con y sin marca, descripción partida en varias líneas, encabezados repetidos, fecha Completed y rechazo de usar marca/código como descripción cuando esta falta.
