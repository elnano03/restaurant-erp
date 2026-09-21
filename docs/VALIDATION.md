# Validación de SINTECH AP 1.0

## Verificado automáticamente

Resultado de la entrega: **17 pruebas aprobadas, 0 fallidas; lint y compilación correctos.**

- Cálculos exactos en centavos y rechazo de entradas monetarias inválidas.
- Ciclo borrador → aprobado → abono → pagado → reverso.
- Facturas duplicadas por suplidor, campos bloqueados después de aprobar, versiones obsoletas y sobrepagos rechazados.
- Anulación y reverso con motivos; conservación de registros y auditoría antes/después.
- Antigüedad en los límites 0/1/30/31/60/61/90/91 días; exclusión de borradores.
- Respaldo con referencias inválidas/sobrepagos rechazado; CSV neutraliza fórmulas.
- Migración SQL ejecutada en PostgreSQL embebido (PGlite), incluyendo restricciones, funciones PL/pgSQL, RLS y permisos.
- Usuarios no autorizados sin acceso; viewer sin escritura; accountant sin reversos; escrituras directas a tablas rechazadas.
- Repetición de una solicitud de pago con el mismo identificador no duplica el pago.
- Importación antigua repetible; saldos iniciales quedan como borradores y tabla original preservada hasta el script opcional de protección.
- Interfaz React montada en JSDOM: alta de suplidor, creación/aprobación de factura, abono, reverso, estado de cuenta, ajustes, separación local/demo y restauración con copia previa.
- Lint y compilación de producción.
- Iniciador portable: sirve la aplicación compilada, rechaza intentos de leer archivos fuera de `dist` y rechaza escrituras HTTP.
- Conversión de respaldo local a SQL: conserva importes, identificadores y auditoría; rechaza importar sobre una instalación con registros.

Comando reproducible: `npm run check`.

## Límites de la verificación

Las pruebas SQL simulan el esquema Auth y los roles de Supabase. No verifican el correo, el JWT emitido por el servicio real, la configuración del proyecto ni el alojamiento. JSDOM verifica comportamiento del formulario/DOM, no diseño visual ni comportamiento completo del motor de un navegador.

El navegador remoto disponible no pudo abrir el servidor local (`ERR_BLOCKED_BY_CLIENT`); no se realizó una revisión visual final de escritorio/móvil ni de impresión en un navegador real. La interfaz incluye estilos responsivos y de impresión, cuya revisión visual sigue pendiente.

No se modificaron registros reales de Supabase, no se publicaron cambios ni se hizo push a GitHub. La versión compilada entregada funciona en modo local/demo; cloud necesita configuración y validación final.

## Consideraciones operativas

- Respaldos locales manuales; no sincronización ni respaldos automáticos.
- Un negocio por instalación; la base utiliza un bloqueo por negocio para serializar escrituras.
- Los reportes de antigüedad y estados de cuenta muestran saldos actuales, no reconstrucciones contables históricas a una fecha de corte.
- Los reportes de compras filtran por fecha de factura; pagos por fecha de pago. Ambos excluyen operaciones anuladas/revertidas actualmente.
- La aplicación descarga una instantánea completa. Antes de volúmenes grandes debe incorporarse paginación en servidor y estrategia de archivo.
- No es un libro mayor de doble partida ni un sistema fiscal/declarativo.
