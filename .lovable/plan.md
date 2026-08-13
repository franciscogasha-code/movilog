# Ocultar FAB del carrito cuando el panel está abierto

## Contexto

El botón flotante (FAB) del carrito sigue visible cuando el usuario abre el panel lateral del carrito (`CarritoPanel`). Esto genera confusión: el badge con la cantidad se superpone visualmente al mismo contenido que ya se está mostrando en el Sheet. El usuario reporta que esto es molesto y confuso.

## Objetivo

Ocultar el FAB cuando el carrito ya está abierto en el panel lateral, manteniéndolo visible en el resto de los casos (catálogo, cliente, pedidos).

## Diagnóstico

En `src/pages/Ventas.tsx` el FAB se renderiza con esta condición:

```tsx
{items.length > 0 && customer.name.trim() && activeTab !== "carrito" && (
  <Button ... />
)}
```

La condición `activeTab !== "carrito"` oculta el FAB cuando el usuario está en la pestaña "Carrito" del tabbar, pero NO cuando el panel lateral se abre mediante `setCartOpen(true)`. El estado `cartOpen` no está considerado.

## Cambios propuestos

### 1. `src/pages/Ventas.tsx` — Condición de visibilidad del FAB

Agregar `!cartOpen` a la condición existente:

```tsx
{items.length > 0 && customer.name.trim() && activeTab !== "carrito" && !cartOpen && (
  <Button ... />
)}
```

Esto garantiza que el FAB desaparezca tanto en la pestaña de carrito como cuando el panel lateral está abierto.

### 2. Header "Carrito" (alternativa redundante)

No se modifica. El botón "Carrito" del header sigue disponible como acceso alternativo, incluso cuando el panel está abierto o cerrado.

## Verificación

- Abrir el carrito desde el FAB: el FAB debe desaparecer mientras el Sheet esté abierto.
- Cerrar el Sheet: el FAB debe reaparecer si hay ítems en el carrito.
- Ir a la pestaña "Carrito": el FAB debe seguir oculto (comportamiento actual).
- Volver a "Catálogo" o "Pedidos": el FAB debe reaparecer.
- Revisar visualmente en mobile y desktop.

## Archivos afectados

- `src/pages/Ventas.tsx`

## No incluye

- No se modifica el color o tamaño del FAB.
- No se modifica `CarritoPanel` ni `CatalogoGrid`.
- No se modifica la lógica del carrito (`use-sales-cart`).
