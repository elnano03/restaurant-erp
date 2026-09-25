# SINTECH ERP 2.3 — Inventario, Compras y Cuentas por pagar

## Navegación

Siete áreas principales: Overview, Inventory, Purchasing, Accounts payable, Kitchen, Reports y Administration. Cada área muestra únicamente sus pestañas; las rutas anteriores siguen funcionando. Los botones y formularios permanecen en inglés.

## Inventario

- **Stock overview:** cantidades por unidad, alertas por mínimo, objetivo de reposición y exportación. Un administrador configura **Set levels**. Mínimo cero desactiva la alerta.
- **Products & receipts:** catálogo, ajustes autorizados y entrada de existencias desde facturas aprobadas con productos relacionados.
- **Physical counts:** el administrador inicia un conteo; los campos vacíos se omiten y cero indica ausencia de existencias. Antes de confirmar se muestra la diferencia. El servidor compara existencias actuales con las del inicio para rechazar conteos obsoletos. Toda la operación se confirma o revierte junta, con auditoría.
- **Movement ledger:** historial completo filtrable por producto, fecha y tipo, paginado y exportable. El catálogo anterior solo mostraba los últimos 150; esta pantalla permite consultar todos los movimientos cargados.
- La estimación de costo usa última compra aprobada; no representa valoración contable. Las sugerencias de reposición aún no descuentan órdenes abiertas ni se envían automáticamente.

## Compras

- **Purchasing desk:** muestra orden, estado de entrega, factura relacionada, diferencia entre subtotales y recepción de inventario.
- **Compare prices / Supplier prices:** comparación por producto, marca y unidad; excluye proveedores inactivos o bloqueados. Conserva selección por clave normalizada.
- Generar órdenes desde el comparador es una transacción por lote: si una orden falla, no queda otra parte registrada. El reintento en pantalla conserva los números y contenido del lote.
- **Purchase orders:** editar borradores, marcar Ordered, **Confirm delivery**, cancelar, imprimir/exportar, convertir a factura. La confirmación de entrega no agrega stock por sí sola.
- Cada renglón puede vincularse explícitamente a un producto de inventario, con cantidad total y unidad de stock: dos cajas de doce bolsas = 24 bolsas. Al crear la factura se conservan todos los renglones y asociaciones.
- Aprobar la factura y usar **Receive goods today** registra stock una sola vez. Líneas de servicio/no rastreadas no aumentan inventario; el servidor rechaza recepciones sin productos inventariables.
- Alternativamente, importe la factura real y use **Link existing invoice** desde Purchasing desk. Exige mismo proveedor, una factura sin otra orden relacionada y explicación del cotejo. Vincular no duplica deuda ni inventario. Una factura anulada puede reemplazarse por otra mediante ese flujo.
- Recepción y correspondencia son por orden/factura completa. No se implementan recepción parcial, múltiples facturas por orden, lotes o almacenes en esta versión.

## Cuentas por pagar

- **Payables desk:** pendientes, vencidas, borradores y facturas en retención, con acceso a la revisión y el pago.
- **Hold payment / Release hold:** requiere motivo y versión vigente; bloquea pagos individuales, agrupados y selección del plan en servidor. La deuda retenida sigue incluida en reportes.
- El plan valida facturas únicas, saldo disponible y presupuesto. Los pagos continúan registrando transacciones realizadas fuera del ERP; no transfieren dinero.
- Duplicados: el servidor compara números de factura ignorando espacios y mayúsculas para el mismo proveedor. Se impide reutilizar números de orden dentro del restaurante.
- Se valida que el subtotal coincida con los renglones almacenados antes de modificar/aprobar/recibir. Si la factura del proveedor difiere, anule el borrador incorrecto e importe la correcta; puede vincularla desde el panel de compras.

## Auditoría y correcciones de esta entrega

| Hallazgo | Corrección | Evidencia |
|---|---|---|
| Menú largo con funciones mezcladas | 7 módulos y pestañas internas | Flujo React navega proveedores, factura, pago, reporte y restauración |
| Conversión de orden perdía renglones y stock asociado | Conserva líneas, cantidades y producto/unidad de inventario | Orden → borrador → aprobación → recepción probada con 2 cajas / 24 bolsas |
| Entrega confundida con entrada de existencias | Acción Confirm delivery y estados separados en el panel | Entrega no cambia stock; recepción de factura sí |
| Generación de varias órdenes podía completarse a medias | Comando transaccional de lote | Fallo en segundo proveedor revierte la primera orden; reintento UI mantiene payload |
| Proveedores bloqueados/inactivos aparecían en comparación | Filtro y controles del servidor al ordenar | Prueba de comparación excluye ambos estados |
| Reversos cercanos a medianoche usaban UTC en algunos cálculos | Fecha de negocio de Nueva York para pagos/créditos; filtro de proveedor en créditos históricos | Caso 02:00 UTC revierte en el día anterior de Nueva York |
| Líneas y subtotal podían divergir en facturas convertidas | Validación al guardar/aprobar/recibir | Edición de subtotal inconsistente rechazada |
| Planes aceptaban asignaciones por encima del saldo/presupuesto | Validación en servidor y bloqueo de facturas retenidas | Pruebas de saldo, presupuesto y retención |
| Conteo obsoleto podía sobrescribir actividad reciente | Compara cantidad esperada bajo bloqueo del negocio | Conteo obsoleto rechazado sin movimientos parciales |
| Recepciones de servicios podían aparecer como stock pendiente | Solo facturas con productos inventariables son recibibles | Reglas en interfaz y servidor |

## Verificación

37 pruebas automáticas aprobadas, incluyendo base AP, importación PDF/OCR (fixtures), créditos, pagos agrupados, permisos, recuperación de respaldos, cocina y controles PRO. Las pruebas de base de datos usan PostgreSQL embebido PGlite; los formularios y navegación se prueban en JSDOM. Se verificaron además snapshot autenticado y permisos reales de los nuevos endpoints/tablas en Supabase.

La revisión de datos reales detectó cero existencias negativas, cero facturas sobrepagadas y cero diferencias entre renglones y subtotales. En ese momento había 2 facturas y 0 productos; esto no sustituye una validación con un volumen grande de operaciones reales. No se insertaron compras, pagos o conteos ficticios en producción.

No se realizó revisión visual en navegador real: la capacidad requerida de control de navegador no estaba disponible. Siguen pendientes pruebas reales de SMTP/recuperación de correo y formatos PDF de cada proveedor. Las pruebas reducen riesgos; no certifican ausencia de todo error posible.

Los snapshots incluyen conteos y niveles de stock. Restaurar conserva referencias dentro de una nueva empresa. Los archivos adjuntos permanecen en la empresa original. Los datos completos de cada empresa siguen cargándose en un snapshot; paginación de servidor para volúmenes grandes queda como mejora posterior.

Advisors mantiene avisos existentes para helpers AP autorizados con SECURITY DEFINER y tablas internas bloqueadas al cliente; la nueva función pública de comandos es invoker con implementación privada. La protección de contraseñas filtradas sigue desactivada: [guía de configuración](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). [Revisión de funciones privilegiadas](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
