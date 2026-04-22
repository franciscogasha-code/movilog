

## Corrección quirúrgica — Retiro request-only en /chofer

### Problema

PostgREST detecta dos overloads válidos de `fn_transition_request_status` y no puede elegir:
- `(p_request_id, p_new_status, p_reason, p_rejection_reason_type)` — 4 args
- `(p_request_id, p_new_status, p_reason, p_rejection_reason_type, p_trip_id)` — 5 args

La llamada actual envía solo `p_request_id` + `p_new_status`, lo que matchea ambas firmas → error: *"Could not choose the best candidate function"*.

### Cambio único

**Archivo:** `src/components/chofer/CargasDisponibles.tsx`
**Función:** `pickupOutOfCutoff` (líneas 256-259)
**Acción:** Pasar los 5 parámetros nombrados explícitos para apuntar de forma determinística a la firma de 5 args (la firma de 4 args delega internamente en la de 5, así que el comportamiento es idéntico).

```ts
const { error } = await supabase.rpc("fn_transition_request_status", {
  p_request_id: requestId,
  p_new_status: "in_transit",
  p_reason: "Retiro realizado por chofer",
  p_rejection_reason_type: null,
  p_trip_id: myActiveTrip?.id ?? null,
});
```

### Lo que NO se toca

- Queries de listado (`assigned-loads`, `available-loads`, `ready-requests-no-fo`, etc.)
- Llamada `runDriverAction({ action: "pickup", ... })` para filas con FO existente — intacta
- `rejectPickup`, `invalidateAll`, UI, tabs, viajes, custodia, historial, consolidación
- Ningún otro archivo

### Validación post-cambio

- **Caso A (request-only):** Retirar → sin error RPC, pasa a `in_transit`, sale de pendientes, FO se crea automáticamente vía trigger (sin duplicar).
- **Caso B (con FO previo):** flujo intacto vía `fn_driver_action`.
- **Caso C (panel general):** sin cambios visuales, sin cambios de conteos.

### Riesgo

Mínimo. Una sola línea funcional cambiada, dentro del bloque `if (rowId.startsWith("req:"))`. No afecta ningún otro flujo.

