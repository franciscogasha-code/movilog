# Chequeo propio de versión publicada

## Por qué no viste el aviso

El aviso actual depende del service worker (`registerType: "autoUpdate"`), que solo se registra en el sitio publicado y solo avisa cuando el navegador descarga un build **nuevo ya publicado**. Con cambios sin publicar no hay nada que detectar, y en la primera instalación del SW tampoco hay aviso porque no existe versión previa a reemplazar.

## Qué se agrega

Un chequeo independiente del service worker: la app pregunta cada tanto cuál es la versión publicada y, si no coincide con la que está corriendo, muestra el mismo banner fijo + toast que ya existe.

### Comportamiento

- Al abrir la app y luego cada 5 minutos, se consulta un archivo `version.json` en el servidor (sin cache).
- Si la versión del servidor difiere de la versión compilada en el navegador, se activa `needsUpdate` en el contexto ya existente.
- "Actualizar" limpia las cachés del service worker y recarga con la versión nueva; "Más tarde" sigue funcionando igual (se silencia hasta la próxima diferencia de versión, no para siempre).
- También se chequea al volver a la pestaña (`visibilitychange`) y al recuperar conexión.
- No corre en preview, iframe ni desarrollo (mismas guardas que el service worker), para no molestar mientras trabajamos.

## Detalle técnico

1. `vite.config.ts`: plugin mínimo que emite `dist/version.json` con `{ version: __APP_VERSION__ }` en cada build (usa el mismo sello de versión ya calculado en Asunción).
2. Nuevo `src/lib/version-check.ts`: función `fetchPublishedVersion()` con `cache: "no-store"`, timeout de 5s, y las guardas de entorno; devuelve `null` ante error (nunca rompe la app).
3. `src/contexts/UpdateContext.tsx`: se suma el polling (intervalo 5 min + `visibilitychange` + `online`) y una segunda fuente de `needsUpdate` — la vía service worker se mantiene intacta. Cuando el aviso viene del chequeo de versión y no hay `updateFn` del SW, "Actualizar" hace limpieza de cachés + `location.reload()`.
4. La clave de descarte pasa a guardar la versión descartada (`movilog:update-dismissed = <versión>`), así un build posterior vuelve a avisar.

Sin cambios en el service worker, en el banner visual ni en el resto de módulos.

## Riesgos y checklist de regresión

- Riesgo: doble aviso (SW + chequeo). Mitigado: un solo flag `needsUpdate`, banner único, toast con `id` fijo.
- Riesgo: bucle de recarga si `version.json` no coincide nunca. Mitigado: la recarga es manual (el usuario toca "Actualizar"), nunca automática.
- Riesgo: ruido en preview/dev. Mitigado por las guardas de entorno.
- Checklist: (1) `/solicitudes`, `/ventas`, `/chofer` sin recargas espontáneas; (2) banner aparece tras publicar un build nuevo; (3) "Más tarde" oculta y reaparece con el build siguiente; (4) "Actualizar" carga la versión nueva y el sello del sidebar cambia; (5) sin conexión no aparece ni rompe nada.
