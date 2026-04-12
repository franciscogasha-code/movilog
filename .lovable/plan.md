

# Implementación: Bloquear selección de sucursal propia como origen

## Archivos a modificar

### 1. `src/components/shared/ProductCard.tsx`
- Agregar prop `disabledBranchIds?: string[]`
- En grilla de stock: calcular `isDisabled`, forzar `isClickable=false` e `isSelected=false`, agregar `disabled`, estilos `opacity-50 cursor-not-allowed`, y tooltip
- En fallback sin stock: misma lógica de bloqueo

### 2. `src/components/solicitudes/SolicitudCreateForm.tsx`
- Pasar `disabledBranchIds={requestingBranchId ? [requestingBranchId] : undefined}` al `ProductCard`

No se toca `Consultas.tsx`, backend, ni otros módulos.

