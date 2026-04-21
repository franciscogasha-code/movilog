

# Fix quirúrgico — Retiro Pedido #174

## A. Causa exacta del error

`fn_driver_action`, rama `pickup` (líneas 143–147), asigna:

```sql
IF v_request.flow_type = 'urban' THEN
  v_new_status := 'in_transit';
ELSE
  v_new_status := 'in_consolidation';   -- ❌ NO existe en enum fulfillment_status
END IF;
```

Luego hace `status = v_new_status::fulfillment_status` y **revienta** porque `in_consolidation` **no es un valor del enum `fulfillment_status`**. Es valor del enum `request_status` (rama `branch_requests`), no del de fulfillments.

Valores válidos hoy del enum `fulfillment_status`:
`pending, picking, waiting_for_cut, waiting_for_courier, dispatched, in_transit, delivered, pending_physical_confirmation, received, partial, completed, cancelled, at_hub, delivery_failed`.

La misma raíz aparece en la rama `pickup_from_hub` (línea 183) — también va a fallar.

## B. Estado real del Pedido #174

| Campo | Valor |
|---|---|
| `request_number` | 174 |
| `request_type` | client |
| `delivery_target` | branch |
| `shipping_method` | own_fleet |
| `flow_type` | **interurban** |
| `branch_requests.status` | ready_for_pickup |
| `fulfillment_orders.status` | pending |
| `current_location_type` | branch |
| `trip_id` | NULL |

Como `flow_type='interurban'`, el código toma la rama del `ELSE` y trata de escribir `in_consolidation` en el fulfillment → error.

## C. Fix aplicado

**Migración SQL puntual** sobre `fn_driver_action` (sin tocar lógica de pedidos, ni cliente flota propia, ni urbanos, ni acopio, ni viajes):

1. **Rama `pickup` (interurbano y cualquier no-urbano):** cambiar `in_consolidation` por `in_transit`. Conceptualmente es igual: chofer tiene la mercadería en su vehículo. La distinción "consolidación vs en tránsito final" sigue viviendo en `branch_requests.status` (que ya soporta `in_consolidation` y se sincroniza desde `fn_transition_request_status`). Para fulfillments, "carga retirada en custodia del chofer" = `in_transit`. Esto ya es lo que hace el flujo urbano y funciona.

2. **Rama `pickup_from_hub`:** mismo cambio (`in_consolidation` → `in_transit`).

3. **Mantener intacto** todo lo demás (`drop_at_hub`, `deliver_branch`, `deliver_customer`, `transfer_to_driver`, `delivery_failed`).

4. **Compatibilidad con condicionales posteriores:** las ramas `drop_at_hub` y `deliver_branch` chequean `v_old_status NOT IN ('in_consolidation', 'in_transit')`. Como ahora siempre quedará `in_transit` post-pickup, esas comparaciones siguen funcionando (de hecho se vuelven más limpias y consistentes).

5. **Backfill #174:** no requiere update de datos. El fulfillment está en `pending`. Al apretar "Retirar" después del fix, transiciona a `in_transit` correctamente.

## D. Confirmación de que ahora el retiro funciona

Validación post-fix:

1. Pedido #174 (interurbano, cliente, flota propia) → "Retirar" desde Panel Chofer → `fulfillment_orders.status = in_transit`, custodia chofer, ubicación vehículo. ✅
2. Pedido urbano cualquiera → sigue pasando a `in_transit`. ✅ (sin cambio de comportamiento)
3. Pedido en acopio → "Tomar de acopio" → pasa a `in_transit` (antes intentaba `in_consolidation`, también roto). ✅
4. `drop_at_hub` y `deliver_branch` siguen aceptando `in_transit` como origen válido. ✅
5. `branch_requests.status` sigue manejando `in_consolidation` cuando corresponda (vía `fn_transition_request_status` y rama `drop_at_hub`). ✅

## Archivos afectados

- Una migración SQL: `CREATE OR REPLACE FUNCTION public.fn_driver_action(...)` con dos líneas modificadas (`v_new_status := 'in_transit'` en `pickup` y `pickup_from_hub`).
- Sin cambios de frontend.
- Sin cambios de tipos generados.
- Sin cambios de RLS.

