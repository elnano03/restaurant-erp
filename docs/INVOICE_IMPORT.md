# Facturas e inventario — 2.1

## Flujo

1. En **Supplier profile** ya aparecen **New supplier** y **Edit supplier**. El directorio **Suppliers** mantiene esas funciones.
2. En **Invoices** o **Documents**, pulsa **Upload & read invoice**. También puedes ir a **Import invoice**.
3. Sube un PDF/imagen o elige un archivo existente y pulsa **Read selected document**. En Documents, cada archivo tiene **Read as invoice**.
4. Revisa el original junto a los campos detectados: suplidor, número, fechas, productos, cantidades, precios, subtotal, impuestos, cargos, descuentos y total. Los campos no reconocidos quedan para completar.
5. Elige el suplidor existente o crea uno desde la factura. Revisa categoría, datos de contacto y términos de pago.
6. Para cada producto, selecciona el existente o crea uno. Indica la cantidad que entra y su unidad de inventario. Ejemplo: dos cajas de doce unidades pueden ser 24 unidades; no se asume una conversión automática. Desmarca Inventory para gastos/servicios.
7. Los importes de líneas deben sumar el subtotal; subtotal + impuestos + cargos − descuentos debe igualar el total impreso. Confirma la revisión.
8. Si llegó la mercancía, marca **Goods have been received** y confirma la fecha. **Post invoice & receive inventory** guarda la factura aprobada, productos, entradas y documento dentro de una misma transacción.
9. Si no llegó, desmarca recibido. Se registra la cuenta por pagar; después usa **Inventory → Invoices awaiting receipt → Receive goods today**.

## Archivos ya subidos

No necesitas subir otra vez NebraskaLand.pdf: selecciónalo en Import invoice o usa Read as invoice en Documents. Si estaba asociado a otro registro, al confirmar se vincula a la factura nueva. El registro anterior no se borra. Revisa especialmente los saldos iniciales OPENING para no contar la misma deuda dos veces.

## Lectura automática

PDF.js extrae el texto de PDFs digitales. Tesseract reconoce inglés/español en fotos y páginas escaneadas. Los motores y modelos se sirven desde el mismo sitio; el contenido no se envía a una API de IA. El archivo original se guarda en el almacenamiento privado al confirmar.

Límite: 10 MB, 12 páginas por PDF, 300 líneas por factura. La primera lectura de imagen descarga el motor/modelos y puede tardar. La calidad depende del escaneo y formato del suplidor. Una tabla irregular puede necesitar completar o corregir líneas; OCR puede confundir unidades (por ejemplo lb e Ib). Nunca se publica una factura sin revisión explícita. Una factura completa debe estar en un solo archivo.

## Controles

- Huella SHA-256 del archivo y número por suplidor evitan doble registro; repetir una solicitud tras un fallo de red no duplica entradas.
- Si una línea falla, se revierte toda la transacción: no queda deuda sin productos, ni productos recibidos sin factura.
- Admin/accountant importan y reciben. Admin crea/edita productos y ajusta existencias, con motivo. Viewer solo consulta.
- La unidad de un producto usado no se cambia retroactivamente; crea otro producto si necesitas otra unidad.
- Anular la factura revierte sus entradas. Si el stock ya se usó, la anulación se rechaza hasta revisar el historial de inventario. Los pagos/créditos activos deben revertirse antes de anular.
- Los respaldos y la recuperación en empresa separada incluyen productos, líneas y movimientos. Los archivos originales siguen en la empresa original.

Este módulo registra recepción completa y ajustes manuales. Desde 2.2, Kitchen usage consume ingredientes de recetas y registra merma; no se conecta al POS ni registra recepción parcial. No convierte automáticamente notas de crédito en salidas de inventario.

## Despliegue

Aplicar `supabase/migrations/20260921220532_invoice_inventory_import.sql` después de v2. El cambio añade tablas con RLS y extiende las funciones públicas; los helpers antiguos quedan sin permisos cliente. El sitio se mantiene privado. Ejecutar `npm run check` y construir con las variables públicas Supabase. `prebuild` genera los assets OCR desde dependencias fijadas en el lockfile.

## Corrección 2.1.1: descripciones en varias líneas

Las tablas con columnas Item / Brand / QTY / DLV / Tot Wgt / Price / Total se leen por bloque de producto. El código y la marca se separan de la descripción situada debajo; las líneas de pesos individuales no crean otros productos. Se conservan tamaños y presentaciones como 3-4 y 10LB. El peso se propone como cantidad facturada solo si peso × precio concuerda con el importe; la unidad no se inventa cuando falta. La pantalla muestra la descripción completa en varias líneas, marca/código, paquetes/peso y texto fuente. Completed se reconoce como etiqueta de fecha, incluso cuando el valor está debajo.

La regresión reproduce los siete renglones completos visibles en la captura del usuario; no representa una verificación del PDF completo. Los documentos se vuelven a leer para obtener las nuevas sugerencias. Los registros ya guardados no se modifican.
