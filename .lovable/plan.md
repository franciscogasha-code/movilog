# Pedidos (Ventas): abrir el detalle al tocar una fila

Hoy la pestaña **Pedidos** dentro de Ventas es solo una vista de lectura: cada pre-venta se dibuja como una tarjeta sin acción, por eso al hacer click no pasa nada. El detalle completo ya existe y se usa en el módulo Solicitudes.

## Qué se hace

1. Cada fila de la lista de pre-ventas pasa a ser clickeable (cursor, hover, accesible por teclado, chevron a la derecha).
2. Al tocarla se abre el mismo detalle que ya usa Solicitudes, en un diálogo fullscreen en celular y modal centrado en escritorio.
3. El detalle mostrado es el de pre-venta (ítems, cliente, totales, PDF, confirmar/enviar, convertir a pedido), con las mismas reglas y permisos actuales.
4. Deep-link: al abrir se agrega `?detail=UUID` a la URL y se limpia al cerrar; si se entra con ese parámetro, el detalle se abre solo.
5. Al cerrar el detalle se refresca la lista para reflejar cambios de estado.

## Detalle técnico

- Archivo: `src/pages/Ventas.tsx`, pestaña `pedidos`.
- Se agrega estado `selectedPreSaleId` + `Dialog` (shadcn) reutilizando el patrón de `src/pages/Solicitudes.tsx` (líneas 1233-1251).
- Se monta `RequestDetailRouter` (`src/components/solicitudes/RequestDetailRouter.tsx`), que ya enruta a `PreSaleDetail` cuando `is_pre_sale = true`.
- `onUpdate` invalida la query `["sales_pre_sales", user.id]`.
- Sincronización de URL con `useSearchParams`, igual al estándar del proyecto.
- Sin cambios de backend, RLS ni lógica de negocio.
