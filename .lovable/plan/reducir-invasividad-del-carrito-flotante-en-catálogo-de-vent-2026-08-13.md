# Reducir invasividad del carrito flotante en catálogo de ventas

## Contexto

En `src/pages/Ventas.tsx` hay un botón de acción fijo (FAB) que ocupa todo el ancho inferior de la pantalla (`fixed bottom-4 left-4 right-4`) cuando el usuario tiene productos en el carrito y no está en la pestaña "carrito". El usuario reporta que es molestoso mientras selecciona productos, porque tapa contenido y distrae.

## Objetivo

Reemplazar la barra inferior ancha por un botón flotante compacto, amigable y menos invasivo, que mantenga el acceso rápido al carrito y el total visible, sin ocupar el ancho completo de la pantalla.

## Cambios propuestos

### 1. Reemplazar el FAB ancho por un botón circular flotante

- Eliminar el `div` ancho de `fixed bottom-4 left-4 right-4`.
- Crear un botón circular/ovalado en la esquina inferior derecha (`right-4 bottom-4` o `right-6 bottom-6`).
- Mostrar dentro:
  - Ícono `ShoppingCart`.
  - Badge con la cantidad de ítems.
  - Total en formato compacto (ej: `₲3.600` o `3.600`) para mantener la información relevante.
- El botón abre el `CarritoPanel` (Sheet) ya existente al hacer clic/tap.

### 2. Comportamiento y visibilidad

- Mostrar solo cuando `items.length > 0` y `activeTab !== "carrito"` (igual que hoy).
- Ocultar automáticamente cuando el usuario está en la pestaña de carrito.
- Mantener el botón "Carrito" en el header como acceso alternativo redundante.

### 3. Apariencia amigable

- Usar `primary` para el fondo y `primary-foreground` para el texto/ícono, consistente con el resto de la app.
- Aplicar `shadow-lg` para que flote sobre el contenido.
- Incluir un `Badge` pequeño superpuesto con la cantidad de unidades.
- En mobile, usar tamaño táctil adecuado (mínimo 48px de alto/ancho).
- Añadir una animación sutil de entrada (`animate-in fade-in slide-in-from-bottom-2`).

### 4. Espaciado inferior del contenido

- Ajustar el `pb-24` del contenedor principal si es necesario para que el FAB no tape el último contenido ni los botones de "Agregar" de las tarjetas inferiores.
- Considerar reducir a `pb-20` o `pb-16` si el FAB es más compacto.

### 5. Verificación

- Revisar visualmente en desktop, tablet y mobile.
- Confirmar que al tocar el FAB se abre el `CarritoPanel`.
- Confirmar que el total y cantidad se actualizan al agregar/eliminar productos.
- Confirmar que no aparece en la pestaña "carrito".
- Revisar que no interfiera con el modal de `ProductoFicha` ni con el `ClientePicker`.

## Archivos afectados

- `src/pages/Ventas.tsx` — reemplazo del FAB ancho por el botón flotante compacto.
- Posiblemente `src/components/ventas/CarritoPanel.tsx` si se decide ajustar el título o el botón de confirmar desde el panel (no se anticipa cambio).

## No incluye

- No se modifica la lógica del carrito (`use-sales-cart`).
- No se toca el flujo de confirmación (`ConfirmarVenta`).
- No se agregan dependencias nuevas.
