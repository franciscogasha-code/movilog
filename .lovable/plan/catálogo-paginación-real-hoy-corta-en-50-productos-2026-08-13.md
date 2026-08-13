# Catálogo: paginación real (hoy corta en 50 productos)

No, no es correcto. El catálogo hoy trae **solo los primeros 50 productos** (ordenados por nombre) sin ningún aviso, así que el vendedor cree que ese es todo el surtido. Con ~15.000 productos sincronizados, se ve una fracción mínima.

## Qué se va a cambiar

1. **Scroll infinito**: el catálogo carga de a 48 productos y sigue cargando automáticamente al llegar al final de la grilla (con un skeleton de carga).
2. **Contador de resultados**: arriba de la grilla se muestra "Mostrando X de Y productos" para que el vendedor sepa si conviene filtrar o buscar.
3. **Fin de lista**: mensaje claro "No hay más productos" al terminar, y estado vacío cuando el filtro no devuelve nada.
4. **Filtros y búsqueda** reinician la paginación desde cero (comportamiento esperado, sin mezclar resultados).

## Detalle técnico

- `src/components/ventas/CatalogoGrid.tsx`: reemplazar `useQuery` + `.limit(50)` por `useInfiniteQuery` con `.range(from, to)` (página = 48) y `{ count: "exact" }` en el select para el contador total.
- Observador de intersección (`IntersectionObserver`) sobre un sentinel al pie de la grilla que dispara `fetchNextPage` cuando hay `hasNextPage` y no está cargando.
- `queryKey` sigue incluyendo búsqueda, categoría, marca y "con stock" para que cualquier cambio reinicie el paginado.
- Sin cambios de backend: `products` ya está indexado por `is_active`/`name` y la consulta es la misma, solo con rango.
- Sin cambios en Modo cliente, chips de disponibilidad, carrito ni FAB.

## Verificación

- Prueba en navegador: cargar /ventas, scrollear la grilla y confirmar que aparecen más de 50 productos y que el contador coincide.
- Aplicar filtro de marca/categoría y confirmar que la lista se reinicia correctamente.
- Verificar en mobile (viewport angosto) que el scroll infinito no rompe el FAB del carrito.
