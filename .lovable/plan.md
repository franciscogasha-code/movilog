# Que el catálogo PDF se genere siempre (397 productos)

## Qué está pasando (verificado en el código)

En `src/lib/catalogo-pdf.ts` hay una compuerta de calidad que **aborta el PDF completo si falla una sola foto**:
`if (report.failed.length > 0 && !allowImageFailures) throw new CatalogImageQualityError(...)`.

En paralelo, los errores del preview muestran que el proxy de fotos devuelve 404/502 para productos sin imagen cargada en BIMS. Con 397 productos siempre falla alguna, así que la generación muere: en `CatalogoPdfPanel` el bloque `finally` limpia el progreso (`setProgress(null)`) y el aviso sale solo como toast pasajero. Por eso ves que la barra aparece y después desaparece sin archivo.

Tu selección no se perdió: quedó en el borrador "Autoguardado catálogo" que se graba antes de generar (el que ves como Sofia Bernal / SANSEI IMPORT).

## Qué se va a cambiar

1. **Nunca abortar por fotos**: los productos cuya foto falle salen con recuadro gris y el PDF se genera igual. La compuerta dura queda solo para el caso extremo de que no se pueda obtener ninguna foto.
2. **Saltear de entrada los productos sin foto** en origen: no se piden al proxy (hoy generan 404 y consumen tiempo).
3. **Progreso claro y que no se borra**: barra con etapa (Preparando fotos → Armando PDF → Listo), parte actual (Parte 1 de 2) y contador. No desaparece hasta que hay archivos o un error explicado en pantalla.
4. **Resultado persistente en el panel**: al terminar quedan botones fijos "Parte 1 · Descargar", "Parte 2 · Descargar" y "Compartir", más un resumen "X productos · Y fotos no disponibles". No depende de un toast.
5. **Reintento acotado**: botón "Reintentar fotos faltantes" que rehace solo las que fallaron, sin volver a generar todo.

## Detalle técnico

- `src/lib/catalogo-pdf.ts`: invertir el default de `allowImageFailures`; `CatalogImageQualityError` solo si `report.ready === 0`. Filtrar productos sin `image_url` antes de `prefetchCatalogImages`. `onProgress` pasa a informar fase + parte.
- `src/components/ventas/CatalogoPdfPanel.tsx`: estado de resultado persistente con las partes y sus acciones; barra de progreso por fase; los errores se muestran en el panel además del toast; acción de reintento de fotos faltantes.
- Sin cambios de base de datos y sin tocar la lógica de selección en esta tanda.

## Validación

- Generar con los 397 productos ya seleccionados: deben quedar disponibles las 2 partes aunque falten fotos.
- Caso con muchas fotos rotas: PDF completo, aviso del conteo, recuadro gris en esos ítems.
- Caso sin fotos activadas: sigue funcionando igual y más rápido.
