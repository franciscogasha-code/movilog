

## Diagnóstico

Hay **dos problemas** con causa raíz compartida, más un bug visual adicional:

### 1. Imágenes y stock total no se muestran
**Causa**: `ProductSearch` solo consulta 7 campos (`id, name, sku, bims_code, barcode, category, unit`). No incluye `image_url`, `sell_price`, `description`, `stock_by_warehouse`, `total_stock`, `price_scales`, `price_lists`. Cuando `SolicitudCreateForm` pasa estos valores a `ProductCard`, todos son `undefined`.

### 2. "Warehouse undefined" visible en la captura
**Causa**: Existe un warehouse code en `stock_by_warehouse` que no coincide con ningún `code` en la tabla `branches`. La función `getWarehouseBranchName` cae al fallback `Depósito ${warehouseId}` que muestra "undefined" cuando el ID es vacío o nulo.

---

## Plan de corrección

### Archivo 1: `src/components/shared/ProductSearch.tsx`
- Ampliar el `select()` de la consulta para incluir todos los campos comerciales y de stock:
  ```
  id, name, sku, bims_code, barcode, category, unit,
  description, image_url, sell_price, price_scales,
  price_lists, stock_by_warehouse, total_stock
  ```
- Actualizar el tipo `ProductResult` para incluir estos campos opcionales.

### Archivo 2: `src/components/shared/ProductCard.tsx`
- **Stock total**: Agregar un badge de stock total visible en el **header** del producto (junto a nombre/badges), no solo dentro de la sección de stock por sucursal.
- **Warehouse undefined**: Filtrar entradas de `stock_by_warehouse` donde el key sea vacío, nulo, o `"undefined"`, evitando renderizar filas basura.
- **Imagen fallback**: Mejorar la lógica del placeholder para que no quede oculto cuando `image_url` existe pero falla al cargar (actualmente usa `nextElementSibling` que es frágil).

### Archivo 3: `src/components/solicitudes/SolicitudCreateForm.tsx`
- Eliminar los casteos `(item.product as any)` ya que los campos ahora estarán tipados en `ProductResult`.

---

Esto es una corrección de datos/query, sin cambios en lógica de negocio ni persistencia.

