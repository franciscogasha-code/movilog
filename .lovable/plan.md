

# Plan: Implementación del Módulo Chofer v2

## Resumen
Implementación completa del plan v2 aprobado: completar flujo operativo del chofer con entrega, acopio, transferencia de custodia, ubicación física real, y rendición operativa.

## Bloque 1 — Migración SQL

Una migración que incluye:
- Agregar `at_hub` y `delivery_failed` al enum `fulfillment_status`
- Agregar columnas `current_custody_type` (none/driver/branch/customer) y `current_location_type` (branch/hub/vehicle/customer) a `fulfillment_orders`
- Agregar `delivery_failed_at` y `delivery_failed_reason` a `fulfillment_orders`
- Crear función `fn_driver_action(p_fulfillment_id, p_action, p_metadata)` SECURITY DEFINER con soporte para: pickup, drop_at_hub, pickup_from_hub, deliver_branch, deliver_customer, delivery_failed, transfer_to_driver

## Bloque 2 — Constants y nuevos componentes

- Agregar `at_hub` y `delivery_failed` a `FULFILLMENT_STATUS_CONFIG` en constants.ts
- Crear `MisCargasEnCurso.tsx` — cargas bajo custodia del chofer actual
- Crear `EntregaModal.tsx` — modal de entrega (sucursal/cliente/fallida)
- Crear `CargasEnAcopio.tsx` — cargas en hub de la sucursal del chofer
- Crear `TransferirCustodiaModal.tsx` — transferencia directa entre choferes

## Bloque 3 — Modificación de componentes existentes

- `Chofer.tsx`: 4 tabs (Mis cargas, Retiro, Cortes/Viajes, Historial), cards reales
- `CargasDisponibles.tsx`: pickup via RPC `fn_driver_action('pickup')`
- `CorteUrbano.tsx`: warning al finalizar si hay cargas bajo custodia
- `ViajeInterurbano.tsx`: warning al finalizar si hay cargas bajo custodia

## Bloque 4 — Rendición

- Agregar `FuelForm` y `PerDiemForm` con formularios funcionales
- Filtrar todas las queries por `driver_id` del usuario actual

## Archivos modificados
1. Nueva migración SQL
2. `src/lib/constants.ts`
3. `src/pages/Chofer.tsx`
4. `src/components/chofer/MisCargasEnCurso.tsx` (nuevo)
5. `src/components/chofer/EntregaModal.tsx` (nuevo)
6. `src/components/chofer/CargasEnAcopio.tsx` (nuevo)
7. `src/components/chofer/TransferirCustodiaModal.tsx` (nuevo)
8. `src/components/chofer/CargasDisponibles.tsx`
9. `src/components/chofer/CorteUrbano.tsx`
10. `src/components/chofer/ViajeInterurbano.tsx`
11. `src/pages/Rendicion.tsx`

