# Que no se repita: detectar y forzar actualización de versión

## Qué pasó realmente

El código nunca se perdió: el botón "Enviar a otra sucursal" estaba en `Solicitudes.tsx` y también en el bundle publicado. Lo que estabas viendo era una **copia vieja de la app guardada en el navegador**. Con recarga forzada apareció.

Causa estructural: hoy la app muestra un número de versión fijo escrito a mano (`v5.2.0` en la barra lateral) que **no cambia con cada build**. Entonces no hay forma de saber, mirando la pantalla, si estás viendo la versión nueva o una vieja cacheada.

## Qué propongo (3 medidas, chicas y aisladas)

### 1. Versión real de build visible en la barra lateral
Reemplazar el `v5.2.0` fijo por la versión real del build (fecha/hora + hash corto), inyectada por Vite en tiempo de compilación (`define` en `vite.config.ts`).

Beneficio: en cualquier momento mirás el pie del menú y sabés exactamente qué versión estás corriendo. Si te digo "esto está desde la build de las 14:35" y vos ves una anterior, el diagnóstico es inmediato — ya no perdemos una ronda entera averiguando si el código se borró.

### 2. Aviso automático "Hay una versión nueva"
En la app publicada, cuando el service worker detecta una versión más nueva, mostrar un toast persistente con botón **"Actualizar"** que recarga limpio. Se usa el callback `onNeedRefresh` que ya provee `registerSW` en `register-app-sw.ts` (hoy se llama sin callbacks).

Beneficio: los usuarios de sucursal dejan de quedarse con versiones viejas sin enterarse. No requiere que nadie sepa hacer `Ctrl+Shift+R`.

### 3. Auto-recarga cuando el chunk viejo ya no existe
Cuando el navegador tiene HTML viejo y pide un archivo JS que ya no está en el servidor, hoy eso puede terminar en pantalla en blanco o en módulos que no cargan. Agregar en `main.tsx` un manejador único de `vite:preloadError` / error de carga de módulo que fuerce **una sola** recarga (con guarda en `sessionStorage` para no entrar en bucle).

## Alcance técnico

| Archivo | Cambio |
|---|---|
| `vite.config.ts` | `define` con `__APP_VERSION__` (fecha de build + hash corto de git) |
| `src/vite-env.d.ts` | Declaración de tipo de `__APP_VERSION__` |
| `src/components/AppSidebar.tsx` | Mostrar `__APP_VERSION__` en lugar del literal `v5.2.0` |
| `src/lib/register-app-sw.ts` | `registerSW({ immediate: true, onNeedRefresh })` + toast con botón Actualizar |
| `src/main.tsx` | Guarda anti-chunk-viejo con recarga única |

Nada de esto toca `Solicitudes.tsx`, `EnvioDirectoForm.tsx`, `SolicitudDetail.tsx`, RPCs, RLS ni datos. Se respeta la regla de no registrar service worker en preview ni en dev (la guarda actual queda intacta).

## Riesgos y mitigación

| Riesgo | Mitigación |
|---|---|
| Bucle de recargas | Guarda en `sessionStorage`: una sola recarga automática por sesión |
| Toast molesto durante la jornada | No recarga solo: el usuario decide cuándo tocar "Actualizar" |
| El SW no existe en preview | El aviso solo aplica en la app publicada; en preview la guarda actual sigue desregistrando el SW |

## Checklist de verificación

1. La barra lateral muestra una versión que cambia entre builds.
2. En la app publicada, tras publicar una versión nueva, aparece el aviso "Hay una versión nueva" con botón Actualizar.
3. Tocar "Actualizar" carga la versión nueva sin `Ctrl+Shift+R`.
4. No hay bucles de recarga en ninguna pantalla.
5. `/solicitudes` sigue mostrando los tres botones del header y el detalle de rechazo intacto.
