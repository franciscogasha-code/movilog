# De dónde salen los "Depósito 11, 13, 19, 20, 3, 4, 7"

## Qué está pasando hoy

El desglose de stock de la ficha de producto no es inventado: viene tal cual del ERP BIMS. La consulta de stock en vivo devuelve un mapa `código de depósito → cantidad`. La ficha traduce cada código al nombre de la sucursal usando la tabla de sucursales de MoviLog.

En la base hay solo 9 sucursales cargadas (códigos 1, 5, 6, 8, 9, 15, 17, 21, y una fila basura llamada "Warehouse undefined"). Cuando BIMS devuelve un código que no está en esa tabla (3, 4, 7, 11, 13, 19, 20), la ficha muestra el texto genérico `Depósito <código>`.

Conclusión: los códigos son reales del ERP, pero los nombres no, y en la captura todos esos depósitos vienen con 0 unidades — o sea, ruido visual sin valor operativo ni comercial.

## Qué propongo corregir

1. **Ocultar depósitos desconocidos con stock 0.** Si el código no corresponde a una sucursal registrada y no tiene unidades, no se muestra. Nunca se oculta stock real.
2. **Marcar visualmente los depósitos desconocidos que sí tengan stock**, con el código del ERP y una etiqueta discreta tipo "depósito ERP", para que el vendedor sepa que existe pero no es una sucursal comercial.
3. **Resincronizar el maestro de depósitos desde BIMS** para intentar completar los nombres faltantes (3, 4, 7, 11, 13, 19, 20). Si BIMS no los devuelve, quedan como depósitos internos no comerciales y aplica el punto 1 y 2.
4. **Limpiar la fila basura "Warehouse undefined"** del maestro de sucursales para que no aparezca nunca en listados ni selectores.
5. **Modo cliente**: en el desglose visible al cliente se sigue mostrando solo disponibilidad agregada, sin nombres internos de depósitos.

## Detalle técnico

- `src/components/ventas/ProductoFicha.tsx`: en el armado de `stockRows`, marcar filas sin match en `branchNameByCode` como `unknown: true`; filtrar `unknown && qty === 0` incluso con "ver todas"; renderizar las `unknown` con stock con badge `ERP <código>`.
- Verificar el mismo criterio en `src/components/shared/ProductCard.tsx` (usa el mismo fallback `Depósito ${warehouseId}`).
- Ejecutar la función `bims-sync?entity=warehouses` y comparar los códigos devueltos contra los que aparecen en `stock_by_warehouse` para cerrar la brecha.
- Borrar/desactivar la fila `branches` con `code = 'undefined'`.
