# SINTECH ERP — Cuentas por Pagar 1.0

## Abrir en Windows

1. Extrae TODO el ZIP en una carpeta nueva, por ejemplo `Documentos\SINTECH-ERP-1.0`.
2. Haz doble clic en `START_SINTECH.cmd`. Ya necesitas tener Node.js instalado (lo instalaste durante el proyecto anterior).
3. Se abrirá `http://127.0.0.1:4173`. Mantén abierta la ventana de comandos mientras uses SINTECH.
4. Elige **Explore with sample data** para probar, o **Open local workspace** para empezar con registros vacíos.

El ZIP incluye el programa compilado (`dist`). Para este uso NO necesitas ejecutar `npm install` ni conectar Supabase. No abras `dist/index.html` directamente. Si el navegador no se abre solo, escribe la dirección de arriba.

En Mac: abre Terminal en la carpeta y ejecuta `node scripts/start.mjs`. Para desarrollar o recompilar se necesita Node.js 22.12 o posterior, o 24 LTS.

## Dónde quedan los datos

- **Local:** dentro del navegador de esta computadora. No es una base de datos compartida ni una cuenta protegida por contraseña. Úsalo en una computadora y perfil de navegador de confianza.
- **Demo:** espacio independiente con datos ficticios, claramente identificado.
- **Cloud:** dentro de tu proyecto Supabase, con usuarios y permisos. Requiere la instalación descrita en `docs/DEPLOYMENT.md`.

Los tres espacios NO se sincronizan automáticamente. No cambies entre `localhost`, `127.0.0.1`, otros puertos o perfiles esperando ver los mismos datos: cada dirección/perfil tiene almacenamiento diferente.

En **Settings → Download full backup**, descarga un respaldo JSON al terminar cada jornada y antes de borrar datos del navegador o cambiar de computadora. El ZIP del programa NO contiene los registros que ingreses después. Conserva los respaldos en un lugar propio y seguro. Una exportación CSV sirve para revisar información; el respaldo completo JSON sirve para restaurarla.

## Primeros pasos

1. **Settings:** coloca el nombre, dirección y datos de tu negocio.
2. **Suppliers → New supplier:** agrega suplidores, categoría, contacto y términos de pago.
3. **Invoices → New invoice:** selecciona el suplidor, número, fechas, subtotal, impuesto que figure en la factura, cargos y descuentos. Guarda como **Draft**.
4. Abre la factura, revisa los importes y pulsa **Approve invoice**. Desde ese momento afecta las cuentas por pagar y no se puede editar su importe.
5. Cuando pagues por fuera del programa, abre la factura y selecciona **Record payment**. Puedes registrar un abono o el saldo completo. No mueve dinero ni contacta al banco.
6. **Payments:** consulta referencias; si registraste algo por error, usa **Reverse** e indica el motivo.
7. **Reports:** selecciona antigüedad de deuda, estado de cuenta, compras por categoría o registro de pagos. Exporta CSV o usa **Print / PDF**.

## Corregir errores

- Factura en borrador: usa **Edit draft**.
- Factura aprobada incorrecta: revierte sus pagos activos y luego usa **Void**, dejando el motivo. Crea la factura corregida con un número diferenciado, por ejemplo `INV-123-CORR`, mencionando el original en la descripción.
- Pago incorrecto: usa **Reverse**; después registra el pago correcto. El historial conserva ambos movimientos.
- Suplidor que ya no usas: **Edit → Inactive**. Su historial permanece disponible.
- **Blocked** impide registrar nuevos pagos a ese suplidor. **Inactive** impide nuevas facturas, pero permite saldar facturas aprobadas existentes.

## Qué está incluido

Dashboard calculado con registros reales; suplidores; borradores y aprobación de facturas; pagos parciales; protección contra duplicados/sobrepagos; reversos y anulaciones con motivos; búsquedas y filtros; estados de cuenta; reportes; CSV; impresión; respaldos/restauración local; auditoría; acceso Supabase con roles; migración de la tabla antigua `Suppliers`.

Esta entrega completa el primer módulo funcional de Cuentas por Pagar. No es todavía el ERP integral de inventario, recetas, ventas, nómina o pedidos IA. No incluye OCR/lectura automática de facturas, almacenamiento de adjuntos, notas de crédito, conciliación bancaria ni transferencias de dinero. No calcula impuestos automáticamente: se registran los importes de cada factura.

## Puesta en producción compartida

Está preparado el código, pero NO se ejecutaron cambios contra tu Supabase real ni se publicó una página. Para terminar esa activación se necesita acceso autorizado al proyecto Supabase, acceso al repositorio GitHub si quieres sincronizarlo y una cuenta/destino de alojamiento. No envíes contraseñas ni claves `service_role` por chat.

Guía técnica: `docs/DEPLOYMENT.md`. Resultados y límites de pruebas: `docs/VALIDATION.md`.
