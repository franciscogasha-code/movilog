

## Plan: Rol "Propietario" protegido para Francisco y Juan

### Problema
Actualmente cualquier admin puede modificar o desactivar a otro admin, incluyendo a los propietarios del sistema.

### Solución
Agregar el valor `owner` al enum `app_role` y proteger a los usuarios con ese rol a nivel de base de datos y UI.

### Cambios

**1. Migración de base de datos**
- Agregar `'owner'` al enum `app_role`
- Crear función `is_owner(uuid)` (SECURITY DEFINER) que verifica si un user_id tiene rol `owner`
- Crear trigger `fn_protect_owner` en las tablas `user_roles`, `profiles` y `profile_branch_access` que impide a no-owners modificar o eliminar registros de un owner
- Asignar rol `owner` a Francisco Gasha y Juan Aquino (por email, buscando en `auth.users` + `profiles`)

**2. Edge Function `create-user/index.ts`**
- Permitir que `owner` también pueda crear usuarios (actualmente solo chequea `admin`)
- Impedir que alguien asigne rol `owner` vía esta función (solo se asigna manualmente en DB)

**3. Frontend `src/pages/Usuarios.tsx`**
- Agregar rol `owner` a la lista de roles con label "Propietario" y badge especial (dorado/destacado)
- Cuando el usuario logueado NO es owner:
  - No puede seleccionar usuarios con rol `owner` para editar
  - No puede cambiar rol/sucursal/estado de un owner
  - No puede asignar rol `owner` a nadie
- Cuando el usuario logueado ES owner: puede hacer todo, incluyendo gestionar otros admins
- Mostrar badge visual "Propietario" con icono de corona/escudo diferenciado

**4. `src/contexts/AuthContext.tsx`**
- Agregar helper `isOwner` al contexto para uso en toda la app
- `hasModule` ya funciona bien porque owner tendría todos los módulos

**5. `src/hooks/use-user-access.ts`**
- Sin cambios necesarios (owner hereda `all_branches_access`)

### Protecciones a nivel DB (seguridad real)

```text
Acción                          | Owner puede | Admin puede | Resultado
-------------------------------|-------------|-------------|----------
Editar perfil de un owner      | Sí          | NO (trigger)| RAISE EXCEPTION
Cambiar rol de un owner        | Sí          | NO (trigger)| RAISE EXCEPTION  
Desactivar un owner            | Sí          | NO (trigger)| RAISE EXCEPTION
Eliminar rol de un owner       | Sí          | NO (trigger)| RAISE EXCEPTION
Crear nuevo owner              | NO          | NO          | Solo vía migración
```

### Archivos
| Archivo | Acción |
|---------|--------|
| Migración SQL | Nuevo — enum + función + triggers + asignación |
| `supabase/functions/create-user/index.ts` | Modificar — aceptar owner como caller, bloquear asignación de owner |
| `src/pages/Usuarios.tsx` | Modificar — rol owner en UI + protecciones visuales |
| `src/contexts/AuthContext.tsx` | Modificar — agregar `isOwner` |

### Notas
- El rol `owner` solo se asigna via migración directa, nunca desde la UI
- Los triggers protegen a nivel DB, la UI solo refleja esas restricciones
- Francisco y Juan se identificarán por su email en la migración inicial

