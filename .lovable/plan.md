

# Ajuste visual del bloque de precios — ProductCard

## Archivo a modificar
`src/components/shared/ProductCard.tsx`

## Cambios

### 1. Import (línea 4)
Remover `DollarSign` del import de lucide-react.

### 2. Bloque de precios (líneas 186-213)
Reemplazar todo el bloque actual por la implementación de chips proporcionada por el usuario:
- Título simple "Precios" sin ícono
- Contenedor `flex flex-wrap gap-2`
- Chip principal "Unitario" con `bg-muted/40`, `font-bold text-base` para el valor
- Chips de escalas (6, 12) con `bg-background`, `text-xs text-muted-foreground`
- Cada chip con `rounded-md border px-2 py-1`
- Valores formateados con `.toLocaleString()`

El código exacto a insertar es el proporcionado en el mensaje del usuario.

## Sin cambios en
- Lógica, props, queries, stock, header, description, ni ningún otro bloque

