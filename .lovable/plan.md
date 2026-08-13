# Modo Cliente en el catálogo de Ventas

## Mi parecer

El desglose de stock por sucursal es dato interno: le da al cliente información de la red (dónde hay y dónde falta), habilita reclamos ("en Caballero hay, mandámelo") y expone la operación. Al cliente le sirve solo una respuesta: **¿lo puedo tener, y cuándo?**

La solución no es borrar el dato, sino separar dos lecturas del mismo catálogo:

- **Vista Vendedor (default):** todo como hoy — desglose por sucursal, totales exactos, costos/escala completa.
- **Vista Cliente (Modo Presentación):** disponibilidad resumida y sin números internos.

## Qué se construye

Un toggle "Modo Cliente" en el encabezado de Ventas (visible, con ícono ojo), que persiste en `localStorage` y se activa/desactiva en 1 toque. Afecta catálogo, ficha de producto y carrito.

### En Modo Cliente

| Elemento | Vendedor | Cliente |
|---|---|---|
| Cantidad por sucursal | Tabla completa | Oculta |
| Stock total numérico | "1.240 unidades" | Semáforo: **Disponible** / **Últimas unidades** / **Sin stock (consultar)** |
| Ficha del producto | Todo | Foto, descripción, precio, escalas de ahorro |
| Escalas de precio | Sí | Sí (es argumento de venta) |
| Barcode / código interno | Sí | Oculto |
| Validación por cantidad | "Supera el stock (1.240)" | "Cantidad no disponible por ahora, lo confirmamos al cerrar" |

Umbrales del semáforo: 0 = sin stock; 1–5 = últimas unidades; >5 = disponible. (Ajustable.)

### Detalles operativos

- El vendedor sigue viendo lo que necesita: en Modo Cliente, un toque prolongado sobre el chip de disponibilidad (o el botón ojo) muestra el detalle real por sucursal 5 segundos y vuelve a ocultarlo. Así no tiene que salir del modo delante del cliente.
- El carrito y el pedido no cambian: se guarda todo igual, la restricción es solo visual.
- El modo NO cambia permisos ni datos: es capa de presentación. Los datos siguen llegando por RLS como hoy.

## Detalle técnico

- Nuevo `SalesPresentationContext` (provider en `src/pages/Ventas.tsx`) con `clientMode: boolean` + `toggle()`, persistido en `localStorage` (`movilog.sales.clientMode`).
- `src/components/ventas/ProductoFicha.tsx`: condicionar el bloque "Cantidad por sucursal", el total numérico y el barcode; nuevo componente `AvailabilityChip` con los 3 estados.
- `src/components/ventas/CatalogoGrid.tsx`: reemplazar el texto de stock de cada card por `AvailabilityChip` cuando `clientMode`.
- `src/components/ventas/CarritoPanel.tsx`: mensajes de exceso de cantidad en tono cliente.
- Sin cambios de base de datos, RPC ni RLS.

## Verificación

- Playwright: catálogo y ficha en ambos modos, screenshot desktop y mobile.
- Confirmar que al recargar la página el modo se mantiene y que el "peek" temporal vuelve a ocultarse solo.
