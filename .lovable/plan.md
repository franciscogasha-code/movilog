# Diagnóstico y fix — Bloque "Motivo del rechazo" en el detalle del pedido

## Qué alimenta hoy cada etiqueta

| Etiqueta en pantalla | Campo que la alimenta | Qué pasa hoy |
|---|---|---|
| Motivo | `rejection_reason_type` traducido con `REJECTION_REASONS` | La columna está **siempre NULL** → muestra "No especificado" |
| Rechazado por | `rejected_by` → nombre desde `profiles` | Columna **siempre NULL** → "Usuario desconocido" |
| Fecha | `rejected_at` | Columna **siempre NULL** → "Sin fecha" |
| Observación | `rejection_reason` | Guarda el **código crudo** del motivo (`stock_difference`) en vez de la observación libre |

## Causa raíz (confirmada en base de datos)

No es la consulta ni el componente:

- La consulta del detalle usa `select("*")`, así que trae las cuatro columnas. Correcto.
- El componente mapea bien: traduce `rejection_reason_type` con `REJECTION_REASONS`, resuelve `rejected_by` contra `profiles` y formatea `rejected_at`. Correcto.

El problema está en la función de transición de estado (`fn_transition_request_status`). Su UPDATE hace solamente:

```text
status = <nuevo estado>
rejection_reason = COALESCE(p_rejection_reason_type, rejection_reason)
updated_at = now()
```

Es decir:

1. Escribe el **tipo de motivo** dentro de `rejection_reason` (por eso "Observación: stock_difference").
2. **Nunca** escribe `rejection_reason_type`.
3. **Nunca** escribe `rejected_by` ni `rejected_at`.
4. El texto libre `p_reason` que manda la UI se descarta por completo.

Medición sobre datos reales: de 517 pedidos rechazados, 511 tienen `rejected_by` NULL, 506 `rejected_at` NULL y 511 `rejection_reason_type` NULL. Aplica a pedidos reales (#3108, #3107, #3102, #3210…), no solo a pruebas.

Nota fuera de alcance (no la toco ahora, solo la dejo registrada): el mismo UPDATE tampoco escribe `accepted_by` / `accepted_at`.

## Plan de fix

### 1. Migración — corregir la escritura al rechazar

Nueva migración que reemplaza la función de 5 parámetros (`fn_transition_request_status`), cambiando **solo** el UPDATE principal para que, cuando el nuevo estado sea `rejected`, complete correctamente:

- `rejection_reason_type` = tipo de motivo recibido (casteado al enum).
- `rejection_reason` = texto libre de observación recibido.
- `rejected_by` = usuario autenticado.
- `rejected_at` = ahora.

Para cualquier otro estado, el UPDATE queda exactamente como está hoy (sin efectos sobre preparación, tránsito, consolidación ni cierre).

### 2. Backfill de datos históricos

Actualizar los pedidos ya rechazados donde `rejection_reason` contiene un código de motivo conocido (`stock_difference`, `no_stock_real`, `product_not_found`, `stock_reserved`, `not_convenient_rotation`, `other`):

- Mover ese código a `rejection_reason_type`.
- Vaciar `rejection_reason` (era el código, no una observación).

Los rechazos con texto libre real (por ejemplo "PRUEBA ANCLA — pedido de prueba anulado") quedan intactos como observación.

`rejected_by` y `rejected_at` históricos no se pueden reconstruir de forma confiable desde la tabla; se intenta recuperarlos desde `operational_events` cuando exista el evento de rechazo, y si no, quedan nulos (la UI ya maneja ese caso).

### 3. UI — solo el bloque de rechazo

Ajuste mínimo en el bloque "Motivo del rechazo" de `SolicitudDetail.tsx`:

- Si `rejection_reason` trae un código conocido (datos viejos que no entren en el backfill), mostrarlo traducido en "Motivo" en vez de crudo en "Observación".
- Sin otros cambios en el componente.

## Riesgos y mitigación

- **Riesgo**: reemplazar la función podría afectar otras transiciones. **Mitigación**: se cambia únicamente el UPDATE principal, con la rama de rechazo aislada; el resto del cuerpo se preserva textualmente.
- **Riesgo**: el backfill toca 500+ filas. **Mitigación**: solo filas con `status = 'rejected'` y `rejection_reason` exactamente igual a un código conocido; no toca observaciones reales.
- **Riesgo**: `rejection_reason_type` es un enum. **Mitigación**: cast validado, y solo se asigna cuando el valor pertenece al enum.

## Checklist de regresión

1. Rechazar un pedido nuevo con motivo + observación → Motivo traducido, Observación con el texto libre, Rechazado por con nombre real, Fecha con hora.
2. Abrir #3108 (histórico) → Motivo "Diferencia de stock", Observación vacía, sin valores crudos en pantalla.
3. Aceptar y avanzar un pedido normal (pendiente → preparación → listo → tránsito) sin errores.
4. Asignación a viaje y consolidación siguen funcionando.
5. Línea de tiempo del detalle sigue mostrando el hito de rechazo.
