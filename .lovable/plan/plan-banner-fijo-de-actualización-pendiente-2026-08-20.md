# Plan — Banner fijo de actualización pendiente

## Alcance
Agregar un banner fijo en la parte superior de la aplicación que avise cuando haya una nueva versión disponible, manteniendo el toast de Sonner existente. El botón del banner debe forzar la actualización del service worker y recargar la app.

## Diagnóstico actual
Hoy el aviso de nueva versión solo se muestra como un toast persistente de Sonner desde `src/lib/register-app-sw.ts`. Si el usuario no está mirando la esquina inferior o cierra el toast sin leer, el aviso puede pasar desapercibido. Se agrega un banner superior complementario para mayor visibilidad.

## Solución técnica

### 1. Estado global de actualización
Crear un store/contexto ligero o hook para compartir el estado de "nueva versión disponible" entre el registrador del service worker y la UI del banner. La opción más simple y alineada con el stack actual es exponer el estado y la función de actualización desde un nuevo hook/contexto:

- Opción A (recomendada): crear `src/contexts/UpdateContext.tsx` con `React.createContext` y un provider que guarde `{ needsUpdate, updateSW, dismiss }`.
- Opción B: usar un evento custom (`window.dispatchEvent(new CustomEvent('movilog:update-available'))`) y escucharlo en el componente de banner.

Se elige **Opción A** porque mantiene el control de estado en React y permite que el banner decida si mostrarse o no, respetando una posible acción de descarte por parte del usuario.

### 2. Integración con `register-app-sw.ts`
Modificar `registerAppServiceWorker` para que, en lugar de llamar directamente a `toast.info(...)`, llame a una función de callback registrada en el contexto. El toast de Sonner se mantiene como notificación secundaria, pero también se dispara desde el mismo punto.

Pseudo-código del registrador:

```ts
let onUpdateCallback: ((update: () => Promise<void>) => void) | null = null;

export function setUpdateAvailableCallback(cb: typeof onUpdateCallback) {
  onUpdateCallback = cb;
}

export async function registerAppServiceWorker(): Promise<void> {
  // ... guardas de preview/dev igual que hoy ...

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      if (onUpdateCallback) onUpdateCallback(() => updateSW(true));
      toast.info("Hay una versión nueva de MoviLog", {
        description: "Actualizá para trabajar con la última versión.",
        duration: Infinity,
        id: "movilog-sw-update",
        action: { label: "Actualizar", onClick: () => void updateSW(true) },
      });
    },
  });
}
```

### 3. Nuevo componente `src/components/UpdateBanner.tsx`
Consumir el contexto y mostrar un banner fijo en la parte superior del viewport cuando `needsUpdate` sea true. El banner debe:

- Usar tokens semánticos (`bg-primary`, `text-primary-foreground`, o `bg-amber-500/10` + `text-amber-600` si se prefiere advertencia).
- Ser fijo (`fixed top-0 left-0 right-0 z-50`) o integrado en el layout principal (`sticky`) para no tapar contenido si se desplaza.
- Tener botones claros: **Actualizar** (llama a `updateSW()`) y **Más tarde** (llama a `dismiss()` y oculta el banner).
- Ser responsive: texto legible en mobile, padding reducido, posiblemente un ícono de refrescar.

Ejemplo de estructura:

```tsx
<div className="sticky top-0 z-50 w-full bg-primary text-primary-foreground px-4 py-2">
  <div className="flex items-center justify-between gap-3 max-w-full">
    <span className="text-sm font-medium truncate">
      Hay una versión nueva de MoviLog
    </span>
    <div className="flex items-center gap-2 shrink-0">
      <Button variant="secondary" size="sm" onClick={dismiss}>Más tarde</Button>
      <Button size="sm" onClick={updateSW}>Actualizar</Button>
    </div>
  </div>
</div>
```

### 4. Integración en layout principal
Montar `<UpdateBanner />` en `src/components/AppLayout.tsx` (o `src/App.tsx`) de modo que aparezca en todas las rutas protegidas. Se coloca **antes** del `<Outlet />` o del contenedor principal para que ocupe el flujo normal del documento (`sticky`) o se fije al viewport (`fixed`).

Se recomienda `sticky` para no desplazar bruscamente el contenido al aparecer/desaparecer, y para que no tape elementos en la parte superior si hay scroll.

### 5. Manejo de descarte y persistencia
- Guardar en `sessionStorage` la clave `movilog:update-dismissed` para que, si el usuario cierra el banner, no vuelva a aparecer en la misma sesión.
- El toast de Sonner sigue apareciendo aunque el banner se cierre, a menos que también se descarte.
- Cuando el usuario presiona **Actualizar**, ambos indicadores desaparecen y la página se recarga.

## Checklist de prueba
1. Publicar un nuevo build o simular `onNeedRefresh` en el service worker.
2. Verificar que aparece el banner fijo en la parte superior en:
   - Escritorio (Chrome, Firefox, Safari).
   - Android Chrome.
   - iOS Safari.
3. Verificar que el botón "Actualizar" recarga la app y aplica la nueva versión.
4. Verificar que el botón "Más tarde" oculta el banner y no reaparece en la misma sesión.
5. Verificar que el toast de Sonner sigue apareciendo incluso si el banner se cerró.
6. Verificar que el layout no se rompe: sidebar, header, contenido principal y scroll permanecen funcionales.
7. Verificar que en preview/dev el banner NO aparece (las guardas de `registerAppServiceWorker` deshabilitan el service worker en esos entornos).

## Riesgos de regresión
| Riesgo | Mitigación |
|---|---|
| El banner tapa el header o contenido en mobile | Usar `sticky` en lugar de `fixed`, o agregar un `top-0` seguro con padding compensado. |
| El banner aparece en dev/preview | Las guardas de `registerAppServiceWorker` ya evitan registrar el SW en esos entornos; el banner depende del estado que solo se activa vía `onNeedRefresh`. |
| Doble aviso molesta al usuario | El toast es secundario; el banner es el principal. Se permite cerrar ambos. |
| Estado no se comparte correctamente | Usar contexto de React en lugar de eventos dispersos. |
| Layout shift brusco al aparecer el banner | `sticky` evita cambios de layout porque ocupa espacio en el flujo del documento. |

## Notas de implementación
- No se agregan dependencias.
- No se modifica la base de datos ni el backend.
- Se mantiene el toast de Sonner como mecanismo secundario de notificación.
- El banner se renderiza solo en rutas autenticadas/protegidas (dentro de `AppLayout`).
