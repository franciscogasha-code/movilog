

## Plan: Alinear módulo Consultas con la experiencia de Pedidos

### Problemas detectados

1. **Sin ContextBanner** – No muestra el indicador visual de multi-origen/mono-origen en la parte superior del formulario
2. **Productos sin ficha completa** – Usa renderizado inline básico en vez de `ProductCard`, por lo que no se ven imágenes (con proxy), precios, descripción ni stock formateado
3. **Imágenes sin proxy** – Usa `(p as any).image_url` directo en vez de `proxyImageUrl()`, así que las fotos nunca cargan
4. **Layout desencuadrado** – No tiene la estructura de pasos numerados (1. Contexto, 2. Productos) como en Pedidos
5. **Casteos `(p as any)`** – Accede a campos con `as any` en vez de usar los tipos de `ProductResult` que ya incluyen todos los campos

### Cambios en `src/pages/Consultas.tsx` — función `ConsultationForm`

**A. Agregar ContextBanner** (como en SolicitudCreateForm)
- Importar y renderizar `<ContextBanner>` en la parte superior del formulario, mapeando `deliveryContext` al formato esperado

**B. Estructura de pasos numerados**
- Reorganizar el formulario en secciones "1. Contexto", "2. Productos" con headers `h3` uppercase como en Pedidos

**C. Reemplazar renderizado inline de productos por ProductCard**
- En la vista expandida de cada producto, usar `<ProductCard>` con todos los props (imagen, precios, stock, descripción) en vez del bloque manual actual (líneas 282-353)
- Esto automáticamente resuelve: imágenes con proxy, precios filtrados (base + 6/12 unidades), stock formateado, warehouse "undefined" filtrado
- Mantener la lógica de selección multi-branch por producto que es específica de Consultas (diferente a Pedidos donde es single-select)

**D. Eliminar casteos `(p as any)`**
- Los campos `image_url`, `stock_by_warehouse`, `total_stock` ya están tipados en `ProductResult`
- Reemplazar todos los `(p as any).field` por `p.field` directamente

**E. Header compacto del producto** (fila colapsada)
- Agregar miniatura de imagen proxy (como en ProductSearch) en la fila colapsada
- Mostrar stock total badge en la fila colapsada

### Archivos modificados
- `src/pages/Consultas.tsx` (solo la función `ConsultationForm`, ~120 líneas)

### Sin cambios
- No se toca `ProductCard`, `ProductSearch`, ni `SolicitudCreateForm`
- La lógica de negocio de Consultas (multi-branch toggle por producto, derivación de targets) se mantiene intacta

