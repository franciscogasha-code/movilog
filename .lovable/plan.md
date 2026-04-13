

# Plan: Reposición Administrativa Dirigida

## Resumen
Crear 3 archivos nuevos y modificar Solicitudes.tsx para agregar modalidad de reposición administrativa exclusiva para admin/owner, con carga manual y desde Excel, completamente aislada del flujo estándar.

## Archivos

### 1. `src/components/solicitudes/ExcelTemplate.ts` (nuevo)
Función `downloadExcelTemplate()` que genera y descarga un `.xlsx` con SheetJS conteniendo encabezados (`codigo`, `codigo_secundario`, `descripcion`, `cantidad`) y 2 filas de ejemplo.

### 2. `src/components/solicitudes/ExcelImport.tsx` (nuevo)
Componente completo de importación Excel:
- Upload de archivo (.xlsx, .csv), validación tipo/tamaño (5MB, 500 filas max)
- Parsing con `xlsx` (SheetJS), encabezados case-insensitive con trim
- Consulta a Supabase `products` para matching: `codigo` → `bims_code` → `sku`; `codigo_secundario` → `barcode`
- Agrupación automática de duplicados (suma cantidades)
- **Tabla de validación** con columnas: Código leído, Descripción leída, Cantidad, **Producto encontrado** (nombre en sistema), Estado (badge: ✅ Correcto, ⚠️ Duplicado agrupado, ❌ No encontrado, ❌ Cantidad inválida)
- Resumen superior: total filas, correctas, con error, duplicadas
- Botón descargar plantilla + texto de ayuda visible
- Props: `onConfirm(items)` habilitado solo si 0 errores

### 3. `src/components/solicitudes/AdminReposicionForm.tsx` (nuevo)
Formulario dedicado con 3 bloques:
- **Datos generales**: BranchSelector origen/destino (en fila en desktop), validación origen ≠ destino, campo notas opcional
- **Método de carga** (Tabs): "Carga manual" reutiliza `ProductSearch` + tabla de ítems editable; "Desde Excel" renderiza `ExcelImport`
- **Confirmación**: AlertDialog antes de crear, loading state
- **Submit**: Inserta `branch_requests` con `request_type: "reposition"`, `delivery_target: "branch"`, `shipping_method: "own_fleet"`, `notes` prefijado `[Reposición administrativa]`, `created_by: user.id`. Luego inserta ítems en `branch_request_items`. Toast éxito, llama `onSuccess`.

### 4. `src/pages/Solicitudes.tsx` (modificar)
Cambios mínimos:
- Importar `useAuth`, `AdminReposicionForm`, `FileSpreadsheet` de lucide
- Estado `adminRepoOpen`
- Botón condicional `outline` visible solo si `hasRole("admin") || isOwner`: "Reposición admin." con ícono FileSpreadsheet
- Layout responsive: `flex-col sm:flex-row` para los botones
- Dialog separado con `AdminReposicionForm`

## Lo que NO se toca
- `SolicitudCreateForm.tsx`, `SolicitudDetail.tsx`
- Lógica multiorigen, consultas
- Base de datos, Edge Functions
- Cola operativa, KPIs

