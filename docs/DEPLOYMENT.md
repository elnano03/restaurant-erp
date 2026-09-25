# Despliegue — SINTECH 2.0

## Actualización desde v1

1. Verificar respaldo externo del proyecto y conteos de registros.
2. Ejecutar `npm ci` y `npm run check`.
3. Preparar el build con `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`. Son valores públicos de cliente; nunca usar `service_role` en Vite.
4. Aplicar una sola vez `supabase/migrations/20260921201114_business_operations_v2.sql` mediante migración Supabase. La transacción conserva un respaldo privado previo, migra los datos originales a una empresa y conserva los miembros.
5. Publicar inmediatamente el build v2. La migración revoca los endpoints v1 sin empresa y el acceso cliente a `Suppliers`; un cliente v1 debe recargar la página.
6. Verificar conteos, roles, RLS y estado del despliegue.

La instalación existente ya tiene `001_accounts_payable.sql` y la importación `002`. No repetirlos después del upgrade. Para una instalación nueva, preparar primero el esquema v1 y la tabla antigua esperada por el upgrade, autorizar al administrador y luego aplicar v2. No ejecutar indiscriminadamente todas las migraciones históricas sobre una base ya instalada.

## Autenticación y personas

La migración conserva al administrador existente. Cuentas nuevas se crean/confirman en Supabase Authentication. Desde el ERP, **Businesses & users → Grant access** asigna permisos por empresa. No guardar contraseñas en SQL, auditoría, repositorio o chat.

Configurar Site URL y Redirect URLs de Supabase Auth con la URL real del sitio. Configurar proveedor de correo/SMTP y probar la recuperación y confirmación de correo antes de depender de esos flujos. El cambio de contraseña con sesión iniciada está disponible en **Backups & account**.

El sitio conserva su audiencia privada. Una membresía ERP no concede por sí sola permiso para abrir un sitio privado; compartir el sitio requiere gestionar esa audiencia por separado.

## Almacenamiento

Bucket privado `sintech-documents`, 10 MB por archivo; PDF/JPEG/PNG/WebP. RLS verifica membresía por empresa a través del primer segmento del objeto. Admin/accountant suben; miembros leen; no hay actualización ni borrado directo cliente. Archivar oculta evidencia sin destruir el objeto.

Las instantáneas internas no son respaldo ante pérdida total del proyecto. Mantener exportaciones independientes y un procedimiento de respaldo de PostgreSQL y Storage. Restaurar en la app crea otra empresa, conserva los registros actuales y no copia credenciales ni archivos adjuntos.

## Alojamiento

El proyecto usa Sites según `.openai/hosting.json`; conservar su proyecto y audiencia. Construir y publicar exactamente el commit guardado. Las rutas HashRouter no necesitan reescritura del servidor. El iniciador Node local solo sirve `dist` en loopback y no es un servidor de producción.

## Referencias

- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/storage/security/access-control
- https://supabase.com/docs/guides/auth/redirect-urls
