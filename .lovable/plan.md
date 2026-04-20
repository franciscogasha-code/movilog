

# Auditoría y corrección: Dejar en acopio (Pedido #79)

## Hallazgos reales (verificados en BD y RPC)

**Estado actual del Pedido #79:**
- `branch_requests.status = 'in_transit'`, `flow_type = 'urban'`
- `fulfillment_orders.status = 'at_hub'`, `current_location_branch_id = ae0f4729...` (la sucursal de acopio elegida), `current_custody_holder_id = NULL`, `trip_id` aún apunta al viaje anterior

**Qué hace hoy `drop_at_hub`** (`fn_driver_action`, líneas 203-233):
- Actualiza SOLO `fulfillment_orders`: `status='at_hub'`, custodia a `branch`, ubicación a la sucursal acopio elegida.
- **NO toca `branch_requests`** → queda con `status='in_transit'` aunque la mercadería ya no esté en tránsito.
- **NO limpia `trip_id`** → el fulfillment sigue colgado del viaje viejo.

**Por qué no aparece en ningún lado:**
- **Ruteo → Consolidación** filtra `branch_requests.status='in_consolidation' AND flow_type='interurban'`. El #79 tiene `status='in_transit'` y `flow_type='urban'` → no aparece.
- **Panel chofer → "En acopio"** (`CargasEnAcopio.tsx`) filtra `fulfillment_orders.status='at_hub' AND current_location_branch_id = mi_sucursal_asignada`. El pedido SÍ está visible, pero solo para choferes asignados a la sucursal de acopio elegida. Si Pablo no está asignado a esa sucursal, no lo ve.
- **Mis cargas en curso** filtra `current_custody_holder_id = mi user_id` → ya no le pertenece (correcto).

**Conclusión:** el pedido NO se perdió. Está en `at_hub` en la sucursal elegida, esperando que un chofer asignado a esa sucursal lo tome con "Tomar carga" (que ejecuta `pickup_from_hub`). El problema es que el `branch_request` quedó incoherente (`in_transit`) y que el filtro de visibilidad por `assigned_branch_id` puede ocultarlo a operadores legítimos.

## Decisiones funcionales

1. **`branch_requests.status` debe reflejar "en acopio".** Hoy queda mintiendo en `in_transit`. La opción correcta es transicionarlo a `in_consolidation` cuando se deja en acopio (independiente del `flow_type`), porque operativamente la carga está esperando consolidación/redespacho desde un hub.
2. **Permitir que urbanos también pasen por consolidación cuando van a acopio.** Hoy el filtro de Ruteo excluye `urban`. Hay que ampliarlo para que muestre cualquier pedido en `in_consolidation` cuyo fulfillment esté `at_hub`.
3. **Mostrar los pedidos en acopio a más usuarios:** `CargasEnAcopio` solo los muestra a choferes con `assigned_branch_id` = sucursal del hub. Hay que ampliarlo para que cualquier operador (chofer/operador logístico/jefe logística) que tenga acceso a esa sucursal por RLS pueda verlos.
4. **`trip_id` se mantiene** como referencia histórica del viaje en que llegó (útil para trazabilidad). No se limpia.

## Cambios a implementar

### A. Migración SQL — corregir `fn_driver_action` rama `drop_at_hub`

Agregar al final del bloque (después del UPDATE de fulfillment_orders, línea 233):

```sql
-- Sincronizar branch_request: pasa a in_consolidation
IF v_fulfillment.branch_request_id IS NOT NULL THEN
  UPDATE public.branch_requests
  SET status = 'in_consolidation'::request_status,
      current_location_branch_id = v_new_location_branch,
      current_custody_holder_id = NULL,
      updated_at = now()
  WHERE id = v_fulfillment.branch_request_id
    AND status::text IN ('in_transit', 'in_consolidation');
END IF;
```

(Update directo, no via `fn_transition_request_status`, porque esa RPC no tiene una rama `in_transit → in_consolidation` definida y meterla ahí es scope mayor.)

### B. Migración SQL — backfill del Pedido #79

```sql
UPDATE branch_requests
SET status = 'in_consolidation',
    current_location_branch_id = 'ae0f4729-2fe6-4432-a3f4-f0c728c1dc8a',
    current_custody_holder_id = NULL,
    updated_at = now()
WHERE id = 'd6e8b556-6235-44ad-b90a-e1232c7f843e'
  AND status = 'in_transit';
```

### C. `src/components/logistica/LogisticaConsolidacion.tsx`

Ampliar filtro: incluir pedidos `in_consolidation` cuyo fulfillment está `at_hub`, sin restringir por `flow_type`. Mostrar badge visual "En acopio en SUC. X" para diferenciarlos de los recién retirados.

### D. `src/components/chofer/CargasEnAcopio.tsx`

Reemplazar el filtro por `assigned_branch_id` (línea 34: `branchId = myDriver?.assigned_branch_id || profile?.default_branch_id`) con visibilidad basada en RLS: traer todos los `at_hub` accesibles al usuario (RLS ya filtra por sucursal). Mostrar la sucursal del hub en cada tarjeta para dar contexto.

## Validación de cierre

1. Aplicar migración A + B.
2. Verificar en BD: `branch_requests.status` del #79 = `in_consolidation`.
3. Pablo entra a Ruteo → Consolidación: el #79 debe aparecer con badge "En acopio en SUC. X".
4. Un chofer con acceso a la sucursal de acopio entra a Panel Chofer → Mis cargas: ve "En acopio" con el #79 y puede "Tomar carga".
5. Repetir flujo con un nuevo "Dejar en acopio" sobre otro pedido y confirmar que ahora `branch_requests.status` queda `in_consolidation` automáticamente.

## Archivos afectados

- Nueva migración SQL (corrección RPC + backfill #79)
- `src/components/logistica/LogisticaConsolidacion.tsx` (ampliar filtro y badge)
- `src/components/chofer/CargasEnAcopio.tsx` (eliminar restricción por `assigned_branch_id`)

