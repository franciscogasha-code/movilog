# Ajustar colores visuales del estado "En carrito" y pulir FAB

## Contexto

En el catálogo de ventas (`CatalogoGrid` / `ProductCard`) el badge "En carrito" usa el mismo color `primary` que el botón "Agregar". Esto genera competencia visual: el usuario no distingue rápidamente entre "ya está en el carrito" y "acción para agregar". El usuario sugiere cambiar el color del badge y también revisar el botón flotante inferior derecho.

## Recomendación

Sí, cambiar el color del badge "En carrito" es una mejora clara. Sin embargo, el botón flotante del carrito debería **seguir en `primary`**, porque es el CTA principal de navegación. La clave es la jerarquía visual, no cambiar todo.

### Badge "En carrito"

- Dejar de usar `variant="default"` (primary).
- Usar un color de estado "seleccionado/confirmado" con menos peso visual que el botón "Agregar": por ejemplo `variant="secondary"` con ícono `Check`, o un tinte verde suave (`bg-emerald-500/15 text-emerald-700`).
- Esto comunica "ya agregado" sin competir con la acción principal.

### Botón flotante inferior derecho (FAB)

- Mantener `primary` sólido.
- Pulir el badge de cantidad para que sea más legible.
- Opcional: añadir un efecto sutil de pulso cuando el total o la cantidad cambie, para llamar la atención sin ser invasivo.

## Cambios propuestos

### 1. `src/components/ventas/CatalogoGrid.tsx`

Reemplazar el badge actual:

```tsx
{inCart && (
  <Badge className="absolute top-2 right-2" variant="default">
    <ShoppingCart className="h-3 w-3 mr-1" />
    En carrito
  </Badge>
)}
```

Por una versión secundaria/confirmada:

```tsx
{inCart && (
  <Badge className="absolute top-2 right-2 gap-1" variant="secondary">
    <Check className="h-3 w-3" />
    En carrito
  </Badge>
)}
```

También se puede agregar un `aria-label` para accesibilidad.

### 2. `src/pages/Ventas.tsx`

Mantener el FAB en `primary`. Mejorar el badge de cantidad con un anillo o shadow sutil para separarlo del fondo del botón. Opcionalmente agregar un `key` o efecto de cambio de escala breve cuando `count` cambie.

No se propone cambiar el color del FAB a otro distinto de `primary` para no romper la coherencia de acciones principales de la app.

### 3. Tokens semánticos

Asegurar que cualquier color nuevo use tokens de Tailwind (`secondary`, `emerald`, etc.) y no valores hardcodeados. No agregar dependencias.

## Verificación

- Revisar visualmente en desktop y mobile.
- Confirmar que "En carrito" sigue siendo legible sobre fotos claras/oscuras.
- Confirmar que el FAB no tapa contenido esencial (ya hay `pb-20`).
- Confirmar que la accesibilidad (contraste) se mantiene.

## Archivos afectados

- `src/components/ventas/CatalogoGrid.tsx`
- `src/pages/Ventas.tsx` (pulido menor del badge del FAB)

## No incluye

- No se modifica la lógica del carrito (`use-sales-cart`).
- No se cambia el color principal de la app.
- No se agregan dependencias.
