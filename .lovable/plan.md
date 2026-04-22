

## Diagnóstico Pedido #131 — Causa raíz exacta

### Trazabilidad real del #131 (BD)

| Momento | branch_requests.status | fulfillment_orders | trip_id | Evento |
|---|---|---|---|---|
| 13:28:40 | pending → accepted | — | — | aceptación |
| 13:28:40 | accepted → in_preparation | — | — | preparación |
| 13:28:50 | in_preparation → **ready_for_pickup** | **NO existe** | — | listo para retiro |
| 15:10:58 | ready_for_pickup → **in_transit** | **NO existe** | — | retiro chofer (vía `fn_transition_request_status` con `p_trip_id` = viaje #27) |
| 15:22:18 | in_transit → delivered | **NO existe** | — | entrega |

**Estado final:** `branch_requests.status = delivered`, `flow_type = urban`, **0 fulfillment_orders creados**.

### Causa raíz (dos defectos combinados)

**Defecto 1 — No se crea FO para flujo urbano sin FO previo:**
- La memoria del proyecto (`arquitectura/pedidos/fulfillment-automatico`) dice que al pasar a `in_preparation` se crea un FO automáticamente. Verificado en BD: **no existe ningún trigger que lo haga**. No hay `trg_create_fulfillment` ni equivalente.
- El #131 nunca tuvo FO. La query `assigned-loads` filtra `fulfillment_orders.trip_id = viaje_27`, así que nada puede aparecer ahí: no hay registro que listar.

**Defecto 2 — `fn_transition_request_status` solo asigna `trip_id` en la rama `assigned_to_trip` (interurbano):**
- En el bloque `IF p_new_status = 'assigned_to_trip'` sí ejecuta `UPDATE fulfillment_orders SET trip_id = p_trip_id WHERE branch_request_id = ... AND trip_id IS NULL`.
- En la rama urbana `ready_for_pickup → in_transit`, **el `p_trip_id` recibido se ignora**. Aunque hubiera existido un FO, jamás se vincularía al viaje activo.

### Por qué el último fix funcionó pero quedó incompleto

El fix anterior pasó `p_trip_id: myActiveTrip?.id` al RPC. El RPC lo aceptó (sin error) pero internamente **lo descarta** para flujo urbano. Resultado: retiro confirmado (status avanzó), pero sin FO y sin vínculo a viaje → invisible en "Asignadas a mi viaje".

### Corrección quirúrgica propuesta

Una sola intervención: **en la rama urbana `ready_for_pickup → in_transit` del RPC `fn_transition_request_status`, garantizar que exista FO y que quede vinculado al viaje recibido**.

**Migración mínima** (modificar SOLO la función `fn_transition_request_status`, agregando un bloque condicional justo después de la validación de transición y antes del UPDATE final):

```sql
-- Si el flujo urbano pasa a in_transit y se recibió p_trip_id,
-- garantizar que exista un fulfillment_order vinculado al viaje.
IF v_flow_type = 'urban' 
   AND v_old_status = 'ready_for_pickup' 
   AND p_new_status = 'in_transit' 
   AND p_trip_id IS NOT NULL THEN

  -- Crear FO si no existe
  INSERT INTO public.fulfillment_orders (
    branch_request_id, source_branch_id, destination_branch_id,
    status, trip_id, current_custody_type, current_custody_holder_id,
    current_location_type, current_location_branch_id,
    dispatched_at, dispatched_by, created_at, updated_at
  )
  SELECT 
    p_request_id, v_request.source_branch_id, v_request.requesting_branch_id,
    'in_transit'::fulfillment_status, p_trip_id, 'driver',
    v_user_id, 'vehicle', NULL, now(), v_user_id, now(), now()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.fulfillment_orders WHERE branch_request_id = p_request_id
  );

  -- Vincular al viaje los FO existentes que aún no lo tengan
  UPDATE public.fulfillment_orders
  SET trip_id = p_trip_id,
      status = 'in_transit'::fulfillment_status,
      current_custody_type = 'driver',
      current_custody_holder_id = v_user_id,
      current_location_type = 'vehicle',
      current_location_branch_id = NULL,
      dispatched_at = COALESCE(dispatched_at, now()),
      dispatched_by = COALESCE(dispatched_by, v_user_id),
      updated_at = now()
  WHERE branch_request_id = p_request_id
    AND (trip_id IS NULL OR trip_id = p_trip_id);
END IF;
```

### Lo que NO se toca

- Rama interurbana (`assigned_to_trip`, hub auto-consolidación) — intacta.
- Rama `client_delivery` — intacta.
- `fn_driver_action` (flujo legacy con FO existente) — intacto.
- Queries del listado en `CargasDisponibles.tsx` — intactas.
- UI, tabs, viajes, custodia, historial, consolidación, módulo Pedidos — intactos.

### Validación post-cambio

1. **Caso A (request-only urbano, como #131):** Chofer con viaje activo retira pedido urbano sin FO previo → se crea FO con `trip_id = viaje_activo` → **aparece en "Asignadas a mi viaje"**.
2. **Caso B (con FO previo):** flujo `fn_driver_action` intacto, sin cambios.
3. **Caso C (interurbano):** sin cambios, sigue requiriendo `assigned_to_trip` explícito.
4. **Caso D (cliente final):** sin cambios.

### Backfill puntual del #131 (opcional, una sola fila)

El #131 ya está en `delivered` y nunca tuvo FO. Si se desea retroactivamente que aparezca en historial del viaje #27, se puede insertar manualmente un FO con `trip_id = 345374c9-7c0c-4efe-858b-54e7d786b0ee` y `status = delivered`. Decisión de negocio — espero confirmación antes de ejecutar este backfill, ya que **no es necesario para que el problema deje de ocurrir** en pedidos futuros.

### Riesgo

Bajo. Cambio aislado a una sola rama condicional del RPC. No afecta transiciones interurbanas, cliente, ni el flujo `fn_driver_action`. La rama solo se activa cuando se cumplen las 4 condiciones simultáneas (urbano + ready_for_pickup → in_transit + p_trip_id no nulo).

