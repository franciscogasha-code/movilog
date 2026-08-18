# Pedidos (Ventas): listado enriquecido + detalle al tocar una fila

Hoy la pestaña **Pedidos** dentro de Ventas es solo lectura: cada pre-venta se dibuja como una tarjeta sin acción y solo muestra número, estado, fecha y cliente. Se amplía en dos frentes: más datos útiles en la fila y apertura del detalle completo.

## Parte 1 — Detalle al tocar la fila

1. Cada fila pasa a ser clickeable (cursor, hover, accesible por teclado, chevron a la derecha).
2. Al tocarla se abre el mismo detalle que ya usa Solicitudes: diálogo fullscreen en celular, modal centrado en escritorio.
3. El detalle es el de pre-venta (ítems, cliente, totales, PDF, confirmar/enviar, convertir a pedido), con las reglas y permisos actuales.
4. Deep-link: al abrir se agrega `?detail=UUID` y se limpia al cerrar; entrando con ese parámetro el detalle se abre solo.
5. Al cerrar se refresca la lista para reflejar cambios de estado.

## Parte 2 — Listado enriquecido

Cada fila muestra, además de número / estado / fecha / cliente:

- **Cantidad de ítems** y **total estimado** en ₲ (formato `de-DE`).
- **Sucursal destino** del pedido.
- **Canal de venta** (chip corto: web, WhatsApp, local) cuando el dato existe.
- **Indicador de avance comercial**: Borrador / Enviado al cliente / Confirmado / Convertido, derivado del estado actual de la pre-venta.
- **Acciones rápidas en la fila** (sin abrir el detalle): "Ver PDF" y "Convertir", visibles solo cuando el estado y los permisos lo permiten. El resto de las acciones queda dentro del detalle para no duplicar lógica.

Se agrega además un **buscador simple** por número de pedido o cliente sobre la lista ya cargada, y se sube el límite de 30 a 50 registros con orden por fecha descendente.

## Detalle técnico

- Archivo principal: `src/pages/Ventas.tsx`, pestaña `pedidos`.
- Query `["sales_pre_sales", user.id]`: se amplía el `select` con `destination_branch_id`, `sales_channel` y el agregado de ítems (`branch_request_items(quantity, unit_price)`) para calcular ítems y total en cliente; se resuelve el nombre de sucursal con el catálogo ya disponible.
- Si alguna de esas columnas no está expuesta por RLS/máscara, se cae de forma silenciosa a los datos actuales sin romper la fila.
- Detalle: estado `selectedPreSaleId` + `Dialog` (shadcn) reutilizando el patrón de `src/pages/Solicitudes.tsx` (líneas 1233-1251), montando `RequestDetailRouter` (`src/components/solicitudes/RequestDetailRouter.tsx`), que ya enruta a `PreSaleDetail` cuando `is_pre_sale = true`.
- `onUpdate` y el cierre del diálogo invalidan `["sales_pre_sales", user.id]`.
- Sincronización de URL con `useSearchParams`, estándar del proyecto.
- Acciones rápidas reutilizan los handlers existentes de pre-venta (PDF y conversión); no se duplica lógica de negocio.
- Sin cambios de backend, RLS ni migraciones.

