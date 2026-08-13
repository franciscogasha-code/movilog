# Carrito de Ventas: escalas de precio activas + notas compactas

Dos mejoras en el panel del carrito (`CarritoPanel`), alineadas con la ficha de producto.

## 1. Incentivo de escala dentro del carrito

Hoy el carrito solo muestra precio unitario y subtotal: si el vendedor agrega productos sin definir cantidad y ajusta después en el carrito, pierde el mensaje de "agregá X más y ahorrás Y" que sí existe en la ficha.

Propuesta:
- Guardar las escalas de precio del producto en el ítem del carrito al agregarlo.
- Al cambiar la cantidad en el carrito, recalcular el precio unitario automáticamente (hoy queda congelado el precio del momento en que se agregó — esto también corrige un error real de importe).
- Debajo del selector de cantidad, mostrar una franja compacta ámbar (mismo lenguaje visual que la ficha, versión reducida a una línea) con: "Agregá N más → ₲ X c/u (ahorrás ₲ Y)" y un botón corto "Aplicar" que salta a la cantidad de la siguiente escala.
- Si el ítem ya está en la mejor escala, mostrar un chip verde discreto "Mejor precio aplicado".
- Si el producto no tiene escalas o el cliente tiene lista de precios fija, no se muestra nada.

## 2. Notas como icono, no textarea siempre visible

- Reemplazar el textarea permanente por un botón icono (lápiz/nota) junto al de eliminar.
- Al tocarlo se despliega el campo de nota inline; se colapsa al terminar.
- Si el ítem ya tiene nota: el icono queda resaltado y se muestra la nota en una línea con `line-clamp-1`, tocable para editar.
- Esto reduce cada tarjeta del carrito aproximadamente a la mitad de alto, haciendo listas largas mucho más manejables en mobile.

## Detalle técnico

- `src/hooks/use-sales-cart.ts`: agregar `priceScales: PriceScale[]` y `basePrice` a `CartItem`; en `updateQuantity` recalcular `unitPrice` con `resolvePrice`/`resolveScaleInfo` cuando el ítem no tenga precio de lista fija (nuevo flag `hasFixedListPrice`).
- `src/pages/Ventas.tsx`: al construir el ítem en `handleAddProduct`, pasar escalas, precio base y el flag de lista fija.
- `src/components/ventas/CarritoPanel.tsx`: franja de escala + notas colapsables; misma lógica de ahorro que `ProductoFicha`.
- La pestaña "Carrito" embebida en `Ventas.tsx` (lista simplificada duplicada) se alinea o se reemplaza por el mismo componente para no dejar dos comportamientos distintos.
- Sin cambios de backend ni de esquema.
