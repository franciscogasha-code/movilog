# Catálogo PDF: que siempre termine y no se pierda la selección

Dos problemas distintos, con causas ya verificadas en el código.

## Problema 1 — El PDF no se genera (397 productos)

Verificado en `src/lib/catalogo-pdf.ts`: hay una "compuerta de calidad" que **aborta todo el PDF si falla una sola foto** (`if (report.failed.length > 0 && !allowImageFailures) throw`). En paralelo, los errores del preview muestran que el proxy de fotos devuelve 404/502 para productos que no tienen imagen cargada en BIMS. Con 397 productos es casi seguro que alguna falle, así que la generación muere siempre: la barra de progreso desaparece (se limpia al terminar con error) y no baja ningún archivo.

Cambios:
- **Tolerancia por defecto**: las fotos que fallan salen con recuadro gris y el PDF **se genera igual**. Nada de abortar por una foto.
- Umbral de aviso: si fallan más del 20% de las fotos, se avisa en pantalla con opción de "Reintentar fotos" o "Generar sin fotos", pero el archivo ya está listo para descargar.
- **Resultado siempre visible**: al terminar (con o sin fallas) queda un bloque fijo con "Parte 1 · descargar", "Parte 2 · descargar" y "Compartir", en lugar de depender de un toast que se va solo.
- **Barra de progreso persistente**: mostrar etapa (Preparando fotos / Armando PDF / Listo), parte actual y contador; no se oculta hasta que hay archivos o un error explicado en pantalla (no solo toast).
- Saltar de entrada los productos sin `image_url` (hoy generan pedidos al proxy que devuelven 404 y suman tiempo).

## Problema 2 — La selección se pierde al refrescar

Verificado: la selección vive en IndexedDB (`sales-selected-ids-<usuario>`) y se guarda por efecto después del render; al montar, **reemplaza** el estado por lo leído. Además la pantalla de Ventas se desmonta cada vez que la sesión pasa por "Cargando ventas...".

Cambios:
- Guardar en el mismo momento del clic (escritura directa) y espejo sincrónico en almacenamiento local del navegador.
- Nunca sobrescribir una selección guardada no vacía con una vacía, salvo "Limpiar" explícito.
- Al montar, **unir** lo que hay en memoria con lo guardado en vez de reemplazar.
- No desmontar Ventas cuando la sesión se revalida.
- Barra fija en modo selección: "N seleccionados" + "Recuperar última selección" (trae el autoguardado del servidor, ej. el borrador de Sofia Bernal, y lo suma).

## Detalle técnico

- `src/lib/catalogo-pdf.ts`: `allowImageFailures` pasa a ser el comportamiento por defecto; `CatalogImageQualityError` se reserva para el caso extremo (0 fotos obtenidas). Filtrar productos sin `image_url` antes del prefetch. Reportar por etapa en `onProgress` (fase + parte).
- `src/components/ventas/CatalogoPdfPanel.tsx`: panel de resultado persistente con las partes generadas y sus botones; barra de progreso con fase; errores mostrados en el panel, no solo por toast.
- `src/hooks/use-idb-state.ts`: escritura imperativa, espejo en `localStorage`, hidratación con merge opcional.
- `src/pages/Ventas.tsx`: selección con escritura imperativa; evitar desmontaje en revalidación de sesión.
- `src/components/ventas/CatalogoGrid.tsx`: barra fija de selección con contador y recuperación.
- `src/hooks/use-selection-autosave.ts`: exponer lectura del último autoguardado.
- Sin cambios de base de datos.

## Validación

- Generar el PDF con los 397 productos actuales de punta a punta: deben bajar las 2 partes aunque falten fotos.
- Forzar productos sin foto y confirmar recuadro gris + aviso, sin aborto.
- Refrescar 3 veces con selección activa y verificar que el contador no cambia.
