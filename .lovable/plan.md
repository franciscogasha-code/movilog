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

### 3. Auto-recarga cuando el chunk viejo ya no existe (reforzada)
Cuando el navegador tiene HTML viejo y pide un archivo JS que ya no está en el servidor, hoy eso puede terminar en pantalla en blanco o en módulos que no cargan. Agregar en `main.tsx` un manejador de `vite:preloadError` / error de carga de módulo que fuerce **una sola** recarga.

Refuerzo anti-bucle (condiciones acumulativas, todas obligatorias):
- Guarda en `sessionStorage` con clave versionada (`movilog:chunk-reload:<APP_VERSION>`): si ya hubo una recarga automática en esa sesión para esa versión, no se recarga de nuevo — se deja caer al ErrorBoundary con el mensaje habitual.
- Solo se recarga si el navegador está online (`navigator.onLine`); offline nunca dispara recarga.
- Solo se recarga si el error es de carga de módulo/chunk (patrón de `vite:preloadError` o `Failed to fetch dynamically imported module`); cualquier otro error de red no dispara nada.
- Ventana mínima de 10 s desde el arranque de la sesión antes de permitir otra recarga, para evitar ciclos rápidos.

Prueba obligatoria antes de darla por lista (no se declara estable sin esto):
- Recorrido automatizado (Playwright) por las pantallas principales — `/`, `/solicitudes`, `/consultas`, `/cumplimiento`, `/recepcion`, `/ventas`, `/chofer`, `/flota`, `/rendicion`, `/usuarios`, `/ejecutivo` — contando `page.on("load")` por ruta: debe ser exactamente 1 navegación por pantalla, 0 recargas espontáneas.
- Caso forzado: interceptar un chunk dinámico y devolver 404 al entrar a una ruta lazy. Se espera **exactamente una** recarga y luego pantalla funcional (o el ErrorBoundary), nunca dos.
- Caso forzado repetido: con el 404 persistente, verificar que la segunda entrada NO vuelve a recargar (la guarda de `sessionStorage` corta) y muestra el ErrorBoundary.
- Caso offline: con red cortada y chunk fallando, verificar 0 recargas.
- Resultado a reportar: tabla de recargas por pantalla, y el conteo del caso forzado.


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
| Bucle de recargas | 4 guardas acumulativas (sessionStorage versionado, online, tipo de error, ventana de 10 s) + prueba automatizada de 0 recargas espontáneas en 11 pantallas |
| Toast molesto durante la jornada | No recarga solo: el usuario decide cuándo tocar "Actualizar" |
| El SW no existe en preview | El aviso solo aplica en la app publicada; en preview la guarda actual sigue desregistrando el SW |

## Checklist de verificación (se confirma punto por punto al terminar)

1. La barra lateral muestra una versión que cambia entre builds.
2. En la app publicada, tras publicar una versión nueva, aparece el aviso "Hay una versión nueva" con botón Actualizar.
3. Tocar "Actualizar" carga la versión nueva sin `Ctrl+Shift+R`.
4. No hay bucles de recarga en ninguna pantalla — evidencia: tabla de recargas por pantalla (11 rutas, 1 navegación cada una) + caso forzado con exactamente 1 recarga y segunda entrada sin recarga.
5. `/solicitudes` sigue mostrando los tres botones del header y el detalle de rechazo intacto.

Al cerrar la implementación te devuelvo estos 5 puntos con estado explícito (OK / observación), no un resumen genérico.

