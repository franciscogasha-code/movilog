# Corrección del botón flotante de carrito (Ventas)

## Qué está pasando hoy

Revisé `src/pages/Ventas.tsx`. El botón flotante (FAB) se muestra solo si se cumplen **todas** estas condiciones:

1. hay ítems en el carrito,
2. **ya hay un cliente con nombre cargado**,
3. la pestaña activa no es "Carrito",
4. el panel lateral del carrito está cerrado.

La condición 2 es la que rompe el comportamiento aprobado: si el vendedor entra al catálogo y empieza a cargar productos **antes** de elegir cliente, el FAB nunca aparece, aunque el carrito tenga ítems.

Además hay tres accesos al carrito conviviendo (botón "Carrito" fijo en el encabezado, pestaña "Carrito" y el FAB). El botón del encabezado y la pestaña siguen visibles con el panel abierto, lo que refuerza la sensación de que "el botón sigue estando".

## Qué voy a hacer

1. **FAB siempre presente durante la selección**: mostrarlo cuando haya al menos un ítem en el carrito, sin exigir cliente cargado. Si al abrir el carrito falta el cliente, el flujo existente ya avisa y lleva a la pestaña Cliente.
2. **Ocultarlo solo cuando corresponde**: mientras el panel del carrito está abierto, mientras la ficha de producto está abierta y cuando la pestaña activa es "Carrito". Al cerrar el panel y volver al catálogo, reaparece con su animación.
3. **Eliminar el botón "Carrito" duplicado del encabezado**: el FAB pasa a ser el acceso único desde catálogo/cliente, y la pestaña "Carrito" queda como vista completa. Esto elimina la duplicación visual que confunde.
4. **Pruebas reales antes de confirmar**: recorrido en navegador (desktop y viewport mobile) con sesión real: agregar producto sin cliente → verificar FAB visible; abrir carrito → verificar FAB oculto; cerrar → verificar que reaparece; abrir ficha de producto → verificar que no se superpone; pestaña Carrito → verificar oculto. Captura de pantalla en cada paso y chequeo de TypeScript.

## Detalle técnico

- Archivo: `src/pages/Ventas.tsx`.
- Condición nueva: `items.length > 0 && activeTab !== "carrito" && !cartOpen && !selectedProduct`.
- Se quita el bloque del `Button` "Carrito" del encabezado (líneas del header) y su import si queda sin uso.
- No se toca `CarritoPanel`, `CatalogoGrid`, `ProductoFicha` ni la lógica de precios/escalas.
