

## Plan: Miniaturas de producto en resultados de búsqueda

Reemplazar el ícono de caja (Package) en el dropdown de búsqueda por una miniatura real de la imagen del producto, con fallback al ícono si no hay imagen o falla la carga.

### Cambios en `src/components/shared/ProductSearch.tsx`

1. Importar `useState` (ya existe) y reutilizar la función `proxyImageUrl` desde `ProductCard.tsx` (o duplicar la lógica inline para evitar dependencia circular).

2. Reemplazar línea 127 (`<Package className="h-4 w-4 ..."/>`) por un componente inline de miniatura:
   - Si `p.image_url` existe: renderizar un `<img>` de 32×32px (`h-8 w-8`) con `rounded object-cover`, pasando la URL por `proxyImageUrl`, con `onError` que oculta la imagen y muestra el fallback Package.
   - Si no hay `image_url` o falla la carga: mostrar el ícono Package actual como fallback dentro de un contenedor de 32×32px con fondo muted.

3. Extraer `proxyImageUrl` a un archivo compartido (`src/lib/image-utils.ts`) o importarlo para evitar duplicar la lógica del proxy.

### Resultado visual
Cada fila del dropdown mostrará una miniatura cuadrada de 32×32px a la izquierda, seguida del nombre y metadata del producto.

