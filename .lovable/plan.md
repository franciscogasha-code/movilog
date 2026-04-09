

## Plan: Crear usuarios reales con contraseña temporal

### Problema
El código actual inserta un perfil con un UUID aleatorio como `user_id`, pero `profiles.user_id` tiene una foreign key a `auth.users`. Como no se crea un usuario real en el sistema de autenticación, falla con error `23503` (FK violation).

### Solución
Crear una función backend que use la Admin API para crear el usuario real en `auth.users` con email + contraseña temporal. El trigger `fn_handle_new_user` ya existente creará automáticamente el perfil base, y luego el frontend actualiza ese perfil con el rol y sucursales.

### Cambios

**1. Nueva Edge Function: `supabase/functions/create-user/index.ts`**
- Recibe: `email`, `password`, `full_name`, `role`, `default_branch_id`, `all_branches_access`, `additional_branch_ids`, `modules`
- Valida que el caller sea admin (verificando `user_roles`)
- Usa `supabase.auth.admin.createUser()` con `email_confirm: true` para crear el usuario
- Espera a que el trigger cree el perfil, luego actualiza el perfil con `default_branch_id`, `all_branches_access`
- Inserta el rol en `user_roles`
- Inserta acceso a módulos en `user_module_access`
- Inserta acceso a sucursales en `profile_branch_access`
- Retorna el perfil creado

**2. Actualizar `src/pages/Usuarios.tsx`**
- Agregar campo de contraseña temporal al formulario de creación (con valor por defecto sugerido como `Sansei2026!`)
- Reemplazar la mutación `createUser` para llamar a la edge function en vez de insertar directamente
- Mostrar la contraseña asignada en el toast de éxito para que el admin la comunique al usuario
- El campo de email pasa a ser obligatorio

### Flujo resultante
1. Admin llena: nombre, email, contraseña temporal, rol, sucursal
2. Se llama a la edge function → crea usuario real en auth.users
3. Trigger `fn_handle_new_user` crea perfil base automáticamente
4. Edge function actualiza perfil con datos operativos (rol, sucursales, módulos)
5. Admin comunica email + contraseña al nuevo usuario
6. Usuario puede iniciar sesión y cambiar su contraseña después

### Archivos
- `supabase/functions/create-user/index.ts` (nuevo)
- `src/pages/Usuarios.tsx` (modificar formulario y mutación de creación)

