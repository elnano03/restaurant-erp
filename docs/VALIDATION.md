# Validación — SINTECH 2.0

`npm run check`: **21 pruebas aprobadas, 0 fallidas**, lint y build correctos.

La suite cubre cálculos en centavos, ciclo de facturas/pagos, duplicados, versiones, sobrepagos, reversos, auditoría, importación histórica, RLS y restricciones de escritura. Incluye PostgreSQL embebido PGlite y formularios React montados en JSDOM.

Para v2 verifica aislamiento entre empresas (incluyendo intentos de colisión de identificadores), roles, categorías, créditos aplicados, límites de saldo, idempotencia del pago agrupado, órdenes/recepción/conversión única, respaldos y recuperación con nuevos IDs. Verifica fechas de aprobación/reverso en reportes históricos y comparación por producto/marca/unidad. Los formularios nuevos prueban categorías, créditos, pagos agrupados y precios.

## Límites

Auth y Storage se simulan en las pruebas SQL. Estas pruebas no verifican envío de correo, configuración SMTP, JWT del servicio real, bytes de archivos, diseño visual o impresión en navegador real. No se introducen pagos ficticios en producción para probar los flujos.

La revisión visual de escritorio/móvil y la prueba de recuperación por correo siguen pendientes. Los reportes históricos reconstruyen saldos según fechas de negocio y aprobación/reverso; no son un libro mayor ni una certificación contable.

Los snapshots cargan todos los registros de una empresa. Su retención y la restauración dentro de la misma base no sustituyen respaldo externo de datos y Storage.
