

# Plan: Activación Operativa del Módulo Pedidos

## Bloque 1 — Migración SQL

Una migración que incluye:
- Recrear enum `request_status` con valores limpios: `pending`, `accepted`, `rejected`, `picking`, `dispatched`, `in_transit`, `delivered`, `received`, `logistic_closed`, `closed`
- Limpiar enum `shipping_method`: eliminar `direct_client` y `cut_shipment`
- Actualizar RLS UPDATE de `branch_requests` para incluir `can_access_branch(source_branch_id)` y `can_access_branch(requesting_branch_id)`
- Crear función `fn_transition_request_status` (SECURITY DEFINER) con:
  - `SELECT ... FOR UPDATE` para concurrencia
  - Mapa explícito de transiciones válidas
  - Validación de actor por sucursal (origen vs destino)
  - Campos de auditoría automáticos
  - Inserción de `operational_event`
  - Creación de `fulfillment_order` al aceptar (solo no-padres, con check de duplicados)

## Bloque 2 — constants.ts + business-rules.ts

- Eliminar `partially_accepted` de `REQUEST_STATUS_CONFIG`
- Agregar `requiresShippingCost()` en business-rules

## Bloque 3 — SolicitudDetail.tsx

- Panel de acciones condicional (status + sucursal + rol)
- Botones de transición via `supabase.rpc('fn_transition_request_status')`
- Sección "Ejecución logística" con fulfillments visibles
- Labels corregidos (origen/solicitante)

## Bloque 4 — SolicitudCreateForm.tsx

- Mono-origen: selección desde ProductCard, paso 3 solo resumen

## Bloque 5 — Solicitudes.tsx

- Labels de tabla actualizados

## Archivos modificados
1. Nueva migración SQL
2. `src/lib/constants.ts`
3. `src/lib/business-rules.ts`
4. `src/components/solicitudes/SolicitudDetail.tsx`
5. `src/components/solicitudes/SolicitudCreateForm.tsx`
6. `src/pages/Solicitudes.tsx`

