# SINTECH ERP — Versión 2.1

Abre el sitio publicado e inicia sesión en **Shared workspace** con tu cuenta. El selector de la barra lateral cambia la empresa. La empresa original conserva sus datos; crear otra empresa no mueve ni copia sus registros.

## Categorías de suplidores

1. Entra a **Supplier categories → New category**.
2. Escribe el nombre y guarda.
3. En **Suppliers**, crea o edita el suplidor y selecciona esa categoría.

El administrador puede renombrar o archivar categorías. Renombrar actualiza las asignaciones actuales de suplidores; archivar impide nuevas asignaciones y conserva el historial.

## Nuevas operaciones

| Pantalla | Uso |
| --- | --- |
| Supplier profile | Contactos, facturas, pagos, créditos disponibles y acceso a documentos |
| Credits & returns | Registrar notas de crédito por devoluciones/ajustes y aplicarlas a facturas del mismo suplidor |
| Payment planner | Preparar presupuesto semanal y registrar un pago distribuido entre varias facturas del mismo suplidor |
| Purchasing | Registrar precios comparables, seleccionar ofertas, crear/editar órdenes, recibirlas y convertirlas en facturas borrador |
| Documents | Subir PDF o imágenes privadas de hasta 10 MB; asociarlas a suplidores, facturas, pagos, créditos u órdenes |
| Historical reports | Consultar saldos al cierre de una fecha, considerando aprobaciones y reversos |
| Businesses & users | Crear empresas y administrar permisos de cuentas existentes |
| Backups & account | Crear/descargar respaldos, recuperar una empresa separada y cambiar contraseña/correo |

Los pagos no transfieren dinero. Registra aquí lo que pagaste fuera del programa. Los créditos deben corresponder a acuerdos/notas del suplidor. Antes de anular una factura, revierte sus pagos y aplicaciones de crédito.

Las ofertas se comparan por producto, marca y unidad iguales. No se convierten cajas a libras automáticamente. Las órdenes se reciben completas; revisa cantidades/precios antes de marcarlas recibidas. Una factura generada desde una orden queda en borrador para aprobación.

## Respaldo y recuperación

Se guarda una instantánea antes de la primera escritura de cada día UTC. También puedes crear una manual. Al crear la automática se retienen las últimas 30 instantáneas. Descarga copias periódicamente fuera del sistema.

**Restore as new business** crea una empresa recuperada sin sobrescribir la original. Solo tú recibes acceso inicial a esa empresa. Los archivos adjuntos permanecen en la original: los respaldos incluyen referencias, no el contenido de esos archivos ni contraseñas. Descarga los documentos importantes por separado.

## Usuarios

Crea y confirma la cuenta de cada persona en Supabase Authentication; luego usa **Businesses & users → Grant access** para asignarle un rol en cada empresa. Admin administra permisos; accountant registra operaciones; viewer consulta. El acceso privado al sitio también necesita compartirlo con esa persona. La recuperación por correo depende de la configuración de Auth/SMTP.

## Modo local

El modo local y la demostración conservan las funciones originales de cuentas por pagar. Las mejoras v2 necesitan sesión en el espacio compartido. Los registros locales no se suben automáticamente. En una compilación local, ejecuta `node scripts/start.mjs` después de `npm run build`; no abras `dist/index.html` directamente.

Guías técnicas: `docs/DEPLOYMENT.md`, `docs/VALIDATION.md` y `docs/RELEASE_V2.md`.

## Cargar una factura y alimentar inventario

Usa **Import invoice** o **Invoices → Upload & read invoice**. Puedes leer un archivo existente desde Documents. Revisa datos y líneas, relaciona cada producto con su unidad, confirma los totales y marca si ya recibiste la mercancía. Al confirmar se actualizan juntos inventario y cuentas por pagar. La lectura sugiere datos; no adivina unidades ni publica sin revisión. Guía completa: `docs/INVOICE_IMPORT.md`.
