# Botón "Enviar a otra sucursal" — diagnóstico y restauración

## Qué encontré (verificado, sin tocar código)

No hubo regresión ni reversión. El código de la Fase 1 está completo:

| Verificación | Resultado |
|---|---|
| `EnvioDirectoForm.tsx` existe | Sí (15.8 KB) |
| Botón en `Solicitudes.tsx` | Sí, líneas 708-712 |
| Dialog que monta el form | Sí, líneas 1280-1293 |
| Import del ícono `Send` e import del form | Sí, líneas 14 y 25 |
| Condición de visibilidad | `!isViewer && (branch_operator, branch_manager, admin, supervisor u owner)` — como owner la cumplís |
| ¿El fix de rechazo tocó esto? | No. Esos commits sumaron líneas a `Solicitudes.tsx` y `SolicitudDetail.tsx`; no borraron nada de Fase 1 |
| Render real en el preview (viewport 1120px, tu sesión) | Los tres botones se renderizan: `Reposición admin.` · **`Enviar a otra sucursal`** · `Nuevo Pedido` |
| Bundle de la app publicada (`movilog.lovable.app`) | Contiene el texto "Enviar a otra sucursal" |

O sea: tanto el preview como la versión publicada tienen el botón. Lo que estás viendo es **una copia vieja del bundle cacheada en tu navegador**, no un cambio en el código.

Nota: `register-app-sw.ts` ya desactiva y desregistra el service worker en hosts de preview, así que el caché sospechoso es el del navegador (o el service worker viejo que quedó registrado en `movilog.lovable.app` antes de este cambio).

## Paso 1 — Confirmar sin tocar código (hacelo vos, 1 minuto)

1. En el preview: recarga forzada con `Ctrl + Shift + R`.
2. En `movilog.lovable.app`: abrir con `?sw=off` al final de la URL (`https://movilog.lovable.app/solicitudes?sw=off`) y recargar forzado. Ese parámetro ya está soportado en el código y desregistra el service worker.

Si con eso aparece el botón, el caso está cerrado: no hace falta ningún cambio de código.

## Paso 2 — Solo si después de la recarga forzada sigue sin verse

Entonces sí sería un problema real de entorno y haría, en este orden:

1. Captura de tu pantalla exacta (rol activo y ancho de ventana) para descartar una condición de rol distinta a la esperada (por ejemplo, que tu perfil tenga también `viewer`/`auditor`, que apaga los tres botones por `isViewer`).
2. Consulta a `user_roles` de tu usuario para confirmar los roles reales que llegan al cliente.
3. Si el diagnóstico apunta a caché persistente en la app publicada, agregar una purga de caché única al arranque (bump de versión del service worker), sin tocar `Solicitudes.tsx` ni nada del fix de rechazo.

## Sobre el fix de rechazo

No se toca. Ninguna de las acciones anteriores modifica `SolicitudDetail.tsx`, `fn_transition_request_status`, ni los datos migrados.

## Checklist de cierre

1. Preview con recarga forzada: se ven los tres botones del header.
2. Publicado con `?sw=off`: se ven los tres botones.
3. "Enviar a otra sucursal" abre el modal con origen fijo, destino seleccionable y el campo "Solicitado por / medio".
4. Detalle de un pedido rechazado sigue mostrando Motivo / Observación / Rechazado por / Fecha correctos.
