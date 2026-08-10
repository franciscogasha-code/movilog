# Carga de productos por Excel en Pre-Venta

## Qué se quiere
Hoy en "Nuevo Pedido → Pre-Venta Online" los productos se cargan uno por uno con el buscador. Cuando el cliente manda su pedido en un Excel, hay que tipear todo a mano.

La idea: poder adjuntar ese Excel y que los productos se carguen automáticamente en el pedido, igual que ya funciona en Reposición Administrativa.

## Cómo va a funcionar
1. En el bloque "2. Productos" del formulario de pedido aparece un panel plegable **"Importar desde Excel"**, arriba del buscador.
2. Se descarga la plantilla (mismas columnas ya existentes: `id`, `codigo`, `codigo_secundario`, `descripcion`, `cantidad`).
3. Al subir el archivo se muestra la vista previa con el estado de cada fila: correcto, duplicado agrupado, no encontrado, cantidad inválida.
4. Al confirmar, los productos válidos se agregan a la lista de ítems del pedido. Desde ahí se siguen editando normalmente (cantidad, origen, quitar).
   - Si un producto del Excel ya estaba cargado, se suma la cantidad en vez de duplicarlo.
   - Las filas no encontradas quedan marcadas y no se agregan; se cargan a mano si hace falta.
5. El resto del flujo (validación de stock, orígenes, confirmación) queda exactamente igual.

Se habilita para Pre-Venta Online y también para los demás tipos de pedido del mismo formulario (misma lista de productos), salvo que prefieras limitarlo solo a pre-venta.

## Detalle técnico
- Reutilizar `src/components/solicitudes/ExcelImport.tsx` sin cambios de parsing/matching (ya resuelve id BIMS, código y código de barras contra `products`).
- En `src/components/solicitudes/SolicitudCreateForm.tsx`:
  - Importar `ExcelImport` y renderizarlo dentro de la sección "2. Productos" (antes de `<ProductSearch />`, línea ~1034), dentro de un colapsable para no romper el layout actual.
  - Nuevo handler `handleExcelItems(items)` que hace merge sobre el estado `items`: producto nuevo → se agrega con `sourceBranchId` auto (misma lógica que `addProduct`); producto existente → se suma la cantidad.
  - Toast resumen: "N productos agregados, M ya existentes actualizados, K no encontrados".
  - No se persiste el archivo Excel (a diferencia de reposición administrativa, que lo guarda); solo se usa para poblar los ítems. Si querés guardar el adjunto en el pedido, se agrega en una segunda iteración.
- Sin cambios de base de datos ni de reglas de negocio.

## Fuera de alcance
- Guardar el archivo original adjunto al pedido.
- Importar datos de cliente (nombre, teléfono) desde el Excel.
