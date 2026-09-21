# Puesta en producción — SINTECH AP 1.0

## Accesos necesarios

| Acceso                           | Para qué                                                                              | Alcance necesario                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Proyecto Supabase del ERP        | Ejecutar migraciones, configurar Auth, revisar/importar suplidores y validar permisos | Acceso al Dashboard y SQL Editor del proyecto; sin compartir contraseñas por chat |
| GitHub `elnano03/restaurant-erp` | Guardar esta versión en una rama revisable y mantener historial                       | Acceso de lectura/escritura únicamente a ese repositorio                          |
| Alojamiento elegido              | Publicar `dist`, configurar variables y HTTPS                                         | Permiso para ese proyecto/sitio; dominio opcional                                 |
| Cuenta del usuario administrador | Autorizar el primer usuario dentro del ERP                                            | Usuario existente en Supabase Auth y su correo/UUID                               |

No es necesario conectar Square, DoorDash, Uber Eats, Nextiva ni cuentas bancarias para este módulo. No se requieren claves `service_role` en el frontend.

## 1. Preparar la base de datos

Trabajar primero en un proyecto de prueba o respaldar la base existente. El script principal crea tablas nuevas con prefijo `ap_` y no modifica `Suppliers`.

Ejecutar **una sola vez** `supabase/001_accounts_payable.sql` en el SQL Editor como administrador del proyecto. Todo el script está en una transacción. Si falla, no continuar hasta resolver el error. No reejecutarlo sobre un esquema AP ya instalado; las futuras actualizaciones deben usar migraciones incrementales.

Se crean suplidores, facturas, pagos, miembros autorizados, ajustes, auditoría y registro de solicitudes. Todas las tablas tienen RLS. Los clientes no pueden escribir directamente: deben pasar por `ap_command`, que verifica el rol, valida importes y serializa las operaciones financieras para evitar carreras entre pagos.

## 2. Crear/autorizar usuarios

En Supabase Authentication, crear el usuario administrador con un método seguro gestionado por el propietario. Registrar una cuenta no otorga acceso al negocio por sí solo.

En SQL Editor, reemplazar `YOUR_ADMIN_EMAIL` por el correo exacto de ese usuario:

```sql
insert into public.ap_members(user_id, role, active)
select id, 'admin', true from auth.users
where lower(email) = lower('YOUR_ADMIN_EMAIL')
on conflict(user_id) do update set role = 'admin', active = true;

select u.email, m.role, m.active
from public.ap_members m join auth.users u on u.id = m.user_id;
```

Verificar que aparezca una fila para el correo correcto. Si no aparece, ese usuario todavía no existe en Auth o el correo no coincide.

Repetir con `accountant` para quien registra/aprueba facturas y pagos, o `viewer` para consulta y exportación. Solo `admin` puede anular facturas, revertir pagos o cambiar el perfil del negocio. No hay pantalla de gestión de usuarios: estos cambios se realizan por el administrador del proyecto en Supabase.

Para revocar acceso, establecer `active=false`. No eliminar el historial del usuario. Al revocar, las nuevas consultas/operaciones serán rechazadas; una pantalla previamente cargada puede conservar datos hasta cerrar/refrescar.

Configurar Site URL y Redirect URLs de Auth para la dirección final de la aplicación y, si se usa, `http://127.0.0.1:4173`. Configurar el correo de Auth/SMTP antes de depender de la recuperación de contraseña. Desactivar el registro público si el negocio funcionará solo con cuentas creadas por el administrador. El acceso sigue requiriendo `ap_members`.

## 3. Importar los suplidores antiguos

Ejecutar opcionalmente `supabase/002_import_legacy_suppliers.sql`.

- Copia los suplidores de `public."Suppliers"` a `ap_suppliers` sin borrar el original.
- Normaliza `Activo/Inactivo/Bloqueado` a inglés.
- Cada saldo positivo se convierte en una factura **Draft** `OPENING-ID`.
- Revisar/aprobar ese saldo con el estado de cuenta del suplidor. Si se van a ingresar las facturas originales detalladas, anular el saldo de apertura para no duplicar la deuda.
- Los saldos negativos requieren revisión; el script cancela toda la importación en ese caso porque esta versión no gestiona notas de crédito.
- Nombres duplicados generan un error y revierten la transacción; resolverlos conscientemente en vez de fusionar negocios automáticamente.
- Puede repetirse sin duplicar los registros ya importados por `legacy_id`.

Después de verificar la importación y retirar la versión antigua de la aplicación, ejecutar `003_protect_legacy_table.sql`. Conserva los datos originales, pero retira el acceso de clientes a esa tabla. Esto hace que la aplicación antigua deje de poder leer/escribir ahí; es deliberado y requiere coordinar el cambio de versión.

## 4. Configurar y compilar

Crear `.env.local` a partir de `.env.example` con el Project URL y la Publishable Key. Son valores de cliente públicos; nunca colocar secretos de administrador en variables `VITE_`.

```sh
npm ci
npm run check
```

La compilación reemplaza `dist` por una versión con acceso cloud habilitado. No afecta los datos del navegador ni la base. Las variables Vite se incorporan al compilar: cambiarlas en el alojamiento sin recompilar no modifica un build ya existente.

## 5. Alojamiento

Publicar la carpeta `dist` en un alojamiento estático con HTTPS. Las rutas usan `HashRouter` (`/#/invoices`), por lo que no se necesitan redirecciones del servidor para rutas internas. La ruta base de recursos es relativa.

Configurar encabezados: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'` en CSP. Permitir conexiones al dominio de tu proyecto Supabase; los estilos usan algunos estilos inline para gráficos. No habilitar listados de archivos ni publicar `.git`, `.env*`, respaldos o scripts SQL con datos reales.

El iniciador Node incluido solo escucha en loopback y está pensado para uso local. No usarlo como servicio público.

## 6. Validación final en el proyecto real

1. Entrar con usuario autorizado y comprobar rechazo de una cuenta no autorizada.
2. Probar el ciclo completo con un suplidor/factura de prueba identificados: crear, aprobar, abonar, revertir y anular.
3. Probar dos sesiones haciendo abonos sobre la misma factura y verificar que el segundo pago no exceda el saldo.
4. Verificar que un `viewer` no pueda modificar registros y que un `accountant` no pueda revertir pagos.
5. Probar recuperación de contraseña y enlaces de Auth en la dirección publicada.
6. Revisar reportes, impresión y disposición visual en Chrome/Edge y un móvil.
7. Comprobar respaldo del proyecto en Supabase y exportación de registros.

Estas comprobaciones reales están pendientes porque no se accedió al proyecto Supabase ni se publicó el sitio durante la entrega.

## Migrar registros locales a cloud

Exportar el respaldo completo desde Settings. Sobre una base AP nueva/vacía, un administrador puede generar un SQL para revisión:

```sh
node scripts/backup-to-sql.mjs MI_RESPALDO.json IMPORTAR.sql
```

El script no se conecta a Supabase ni ejecuta cambios. Valida relaciones/importes, genera una transacción y se niega a sobrescribir un archivo existente. Revisar el SQL y ejecutarlo solo después del esquema principal. La importación exige tablas AP vacías y conserva auditoría, versiones e identificadores; no importa cuentas Auth ni permisos. Contiene datos empresariales: conservarlo privado.

## Referencias técnicas

- [Funciones PostgreSQL en Supabase](https://supabase.com/docs/guides/database/functions)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)

La configuración utiliza funciones con `security definer`, `search_path` vacío, nombres totalmente cualificados, permisos de ejecución restringidos y validación explícita del usuario.
