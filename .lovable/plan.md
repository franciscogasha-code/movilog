

# Auditoría: Pedido Cliente + Flota Propia (#172)

## Hallazgos reales (verificados en BD y RPC)

**Estado actual del Pedido #172:**
- `request_type='client'`, `delivery_target='client'`, `shipping_method='own_fleet'`
- `flow_type='client_delivery'`, `status='ready_for_delivery'`
- `source_branch=46710448` (origen físico, ej: Lambaré)
- `requesting_branch=82e5ff0c` (sucursal que tomó el pedido — distinta del origen)
- `client_name='JUAN AQUINO'`
- `fulfillment_orders.status='pending'`, `current_location_type='branch'`, `trip_id=NULL`

**Por qué no aparece en ningún lado (raíz del problema):**

La RPC `fn_transition_request_status` (líneas 49-51) clasifica como `client_delivery` **sin distinguir por método de envío**:

```sql
IF v_request.request_type IN ('client', 'online') AND v_request.delivery_target = 'client' THEN
   v_flow_type := 'client_delivery';
```

Esto trata "Pedido Cliente con flota propia" como si fuera **entrega directa a tercero desde el origen** (estilo encomienda / despacho directo al transportista en planta). El flujo es: `in_preparation → ready_for_delivery → delivered_to_third_party`. NO hay `ready_for_pickup`, NO hay `in_transit`, NO hay viaje.

Consecuencias en cascada:

1. **Panel Chofer > Retiro** filtra por `branch_request.status='ready_for_pickup'` (línea 116 de `CargasDisponibles.tsx`). El #172 está en `ready_for_delivery` → no aparece.

2. **Ruteo > Pedidos cliente pendientes** filtra por `status IN (in_preparation, ready_for_dispatch, in_consolidation)` (líneas 73-77 de `PedidosClienteFlotaPropia.tsx`). El #172 está en `ready_for_delivery` → no aparece. Además filtra por `shipping_method='own_fleet'` correctamente, pero el estado nunca calza.

3. **Barra de progreso** muestra el flow `client_delivery` (4 pasos: Pendiente → Preparación → Listo entrega → Entregado), que es el flujo de tercero/encomienda, no de flota propia.

**Conclusión:** la regla actual de `flow_type` confunde dos operativas distintas:
- **Pedido cliente con flota ajena** (encomienda/courier): correctamente `client_delivery`. Origen entrega a un tercero.
- **Pedido cliente con flota propia**: debería seguir circuito de chofer (`urban` o `interurban`), porque NUESTRO chofer retira y entrega.

## Decisiones funcionales

1. **Refinar la rama de `flow_type`:** cuando el envío es `own_fleet`, NO clasificar como `client_delivery`. Aplicar la lógica de grupo logístico (urban/interurban) igual que para reposiciones, porque el chofer interno gestiona la operación.
2. **`client_delivery` queda exclusivo para envíos donde el origen entrega a un tercero externo** (`shipping_method` ∈ `courier`, `delivery`).
3. **Backfill #172:** reclasificar a `urban` o `interurban` según logistic_group de las sucursales involucradas y volver al estado correcto (`ready_for_pickup`).
4. **El destino real es el cliente final**, pero operativamente el chofer retira en `source_branch` y entrega al cliente. Esto ya lo soporta la lógica actual de chofer (`destination_client_name`, `delivery_target='client'`).

## Cambios a implementar

### A. Migración SQL — corregir `fn_transition_request_status` rama de `flow_type`

Reemplazar las líneas 49-75 con:

```sql
IF v_old_status = 'pending' AND p_new_status = 'in_preparation' THEN
  -- client_delivery SOLO cuando el origen entrega a un tercero externo
  IF v_request.request_type IN ('client', 'online')
     AND v_request.delivery_target = 'client'
     AND v_request.shipping_method IN ('courier', 'delivery') THEN
    v_flow_type := 'client_delivery';
  ELSIF v_request.consolidation_override = false THEN
    v_flow_type := 'urban';
  ELSIF v_request.consolidation_override = true THEN
    v_flow_type := 'interurban';
  ELSE
    -- determinar por grupo logístico (mismo código que hoy)
    SELECT logistic_group INTO v_source_group FROM public.branches WHERE id = v_request.source_branch_id;
    SELECT logistic_group INTO v_dest_group FROM public.branches WHERE id = v_request.requesting_branch_id;
    IF v_source_group IS NULL OR v_dest_group IS NULL THEN
      v_flow_type := 'interurban';
      INSERT INTO public.ai_anomalies (...);  -- igual a hoy
    ELSIF v_source_group = v_dest_group THEN
      v_flow_type := 'urban';
    ELSE
      v_flow_type := 'interurban';
    END IF;
  END IF;
ELSE
  v_flow_type := v_request.flow_type;
END IF;
```

### B. Migración de datos — backfill del #172

```sql
-- 1) Calcular flow_type según logistic_group
WITH groups AS (
  SELECT
    (SELECT logistic_group FROM branches WHERE id='46710448-03a2-466d-939a-613e546c08a7') AS src,
    (SELECT logistic_group FROM branches WHERE id='82e5ff0c-60d1-4a93-8365-0d316b061c16') AS dst
)
UPDATE branch_requests
SET flow_type = CASE
    WHEN (SELECT src FROM groups) IS NOT NULL
     AND (SELECT dst FROM groups) IS NOT NULL
     AND (SELECT src FROM groups) = (SELECT dst FROM groups) THEN 'urban'
    ELSE 'interurban'
  END,
  status = 'ready_for_pickup',
  updated_at = now()
WHERE id = '1cf55b4e-7e62-4d05-abf7-6ae31d264cd3'
  AND status = 'ready_for_delivery';
```

(El fulfillment ya está creado y `pending`. Al pasar el request a `ready_for_pickup`, el chofer ya lo verá en su panel — la query de `CargasDisponibles` mira `branch_request.status`.)

### C. (Opcional, fuera de scope inmediato) `RequestProgressBar`

Hoy detecta `flow_type` correctamente. No requiere cambios — al cambiar `flow_type` a `urban`/`interurban`, automáticamente mostrará la barra correcta de chofer.

## Validación de cierre

1. Aplicar migración A + B.
2. Verificar en BD: `branch_requests` del #172 → `flow_type='urban'` (o `interurban`), `status='ready_for_pickup'`.
3. Pablo entra a Panel Chofer > Retiro, selecciona la sucursal `46710448` (origen) → el #172 aparece en "Listos para retirar" con badge "Cliente" y nombre "JUAN AQUINO".
4. Crear un nuevo pedido cliente + flota propia → confirmar que al aceptarlo, `flow_type` queda `urban`/`interurban` (NO `client_delivery`), y que aparece en el flujo de chofer al pasar a `ready_for_pickup`.
5. Crear un pedido cliente + courier (encomienda) → confirmar que SÍ queda `client_delivery` y muestra la barra de "entrega a tercero".

## Archivos afectados

- Nueva migración SQL (corrección `fn_transition_request_status` + backfill #172)
- No requiere cambios de frontend (los componentes ya reaccionan correctamente a `flow_type` y `status`)

