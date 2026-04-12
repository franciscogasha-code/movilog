

# Plan: Restringir Dashboard Ejecutivo solo a Owners

## Problema
El Dashboard Ejecutivo es visible y accesible para cualquier usuario autenticado (incluidos operadores de sucursal). Debe estar restringido exclusivamente al rol `owner`.

## Cambios

### 1. `src/components/AppSidebar.tsx`
- Agregar lógica para que el item "Dashboard Ejecutivo" solo aparezca si `isOwner` es `true`.
- Filtrar el item con `moduleKey: "ejecutivo"` del array antes de renderizar, usando `useAuth().isOwner`.

### 2. `src/pages/DashboardEjecutivo.tsx`
- Agregar guard al inicio del componente: si `!isOwner`, redirigir a `/` con `<Navigate to="/" replace />`.
- Mostrar loading spinner mientras `loading` es `true` para evitar flash de redirección.

### 3. `src/App.tsx`
No requiere cambios. La protección se hace dentro del componente, que es el patrón más simple y consistente con la arquitectura actual.

## Archivos tocados
- `src/components/AppSidebar.tsx` — ocultar menu item
- `src/pages/DashboardEjecutivo.tsx` — guard de acceso por rol

## Compatibilidad
- No afecta ningún otro módulo ni flujo existente.
- El rol `owner` ya está correctamente cargado en `AuthContext` desde `user_roles`.

