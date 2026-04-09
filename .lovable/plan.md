

## Plan: Unificar stock y selección de sucursales en Consultas

### Problema actual
Al expandir un producto en el formulario de consulta, se muestra primero el `ProductCard` con "Stock disponible por sucursal" (solo lectura), y luego debajo una sección separada "Seleccionar sucursal(es) a consultar" con exactamente los mismos datos. Información duplicada.

### Solución
Agregar un nuevo `stockMode` al `ProductCard` llamado `"select_multi"` que permita seleccionar múltiples sucursales directamente desde la grilla de stock. Así el ProductCard cumple doble función: mostrar stock Y seleccionar orígenes.

### Cambios

**`src/components/shared/ProductCard.tsx`**
1. Ampliar el tipo `StockMode` a `"select_source" | "select_multi" | "info_only"`
2. Agregar props nuevas: `selectedBranchIds?: Set<string>` y `onToggleBranch?: (branchId: string) => void`
3. En la sección de stock por sucursal, cuando `stockMode === "select_multi"`:
   - Hacer los botones clickables (como ya lo son en `select_source`)
   - Mostrar checkmark en las sucursales seleccionadas usando `selectedBranchIds`
   - Llamar `onToggleBranch` al hacer click
   - Cambiar el título a "Stock disponible — click para seleccionar"

**`src/pages/Consultas.tsx`**
4. Cambiar el `ProductCard` de `stockMode="info_only"` a `stockMode="select_multi"`
5. Pasar `selectedBranchIds={productSources[p.id]}` y `onToggleBranch={(bid) => toggleProductBranch(p.id, bid)}`
6. Eliminar toda la sección duplicada "3. Seleccionar sucursal(es) a consultar" (líneas ~327-380)
7. Mantener el mensaje de error "Seleccioná al menos una sucursal" debajo del ProductCard

### Resultado
- Una sola grilla de sucursales con stock que también sirve para seleccionar
- Se eliminan ~50 líneas de código duplicado
- UX más intuitiva: ver stock y elegir en un solo paso

### Archivos modificados
- `src/components/shared/ProductCard.tsx`
- `src/pages/Consultas.tsx`

