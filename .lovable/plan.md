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

El problema está en el UPDATE principal de `fn_transition_request_status`: escribe el **tipo de motivo** dentro de `rejection_reason`, nunca escribe `rejection_reason_type`, `rejected_by` ni `rejected_at`, y descarta el texto libre `p_reason`.

Medición real: de 517 pedidos rechazados, 511 tienen `rejected_by` NULL, 506 `rejected_at` NULL y 511 `rejection_reason_type` NULL. Afecta pedidos reales (#3108, #3107, #3102, #3210…).

Fuera de alcance (registrado para después): el mismo UPDATE tampoco escribe `accepted_by` / `accepted_at`.

## 1. Cambio EXACTO de la función (pendiente de tu aprobación)

Se reemplaza la función de 5 parámetros con `CREATE OR REPLACE`, copiando el cuerpo actual **textual** y cambiando **únicamente** el UPDATE principal. Ese es el único bloque tocado.

Hoy:

```sql
  UPDATE public.branch_requests
  SET status = v_new_status,
      rejection_reason = COALESCE(p_rejection_reason_type, rejection_reason),
      updated_at = now()
  WHERE id = p_request_id;
```

Propuesto:

```sql
  UPDATE public.branch_requests
  SET status = v_new_status,
      rejection_reason = CASE
        WHEN p_new_status = 'rejected' THEN COALESCE(p_reason, rejection_reason)
        ELSE rejection_reason
      END,
      rejection_reason_type = CASE
        WHEN p_new_status = 'rejected' AND p_rejection_reason_type IS NOT NULL
          THEN p_rejection_reason_type::public.rejection_reason_type
        ELSE rejection_reason_type
      END,
      rejected_by = CASE
        WHEN p_new_status = 'rejected' THEN COALESCE(v_user_id, rejected_by)
        ELSE rejected_by
      END,
      rejected_at = CASE
        WHEN p_new_status = 'rejected' THEN now()
        ELSE rejected_at
      END,
      updated_at = now()
  WHERE id = p_request_id;
```

Notas de seguridad del cambio:

- Para cualquier `p_new_status` distinto de `'rejected'`, las cuatro columnas conservan su valor actual: el comportamiento es idéntico al de hoy salvo que ya no se pisa `rejection_reason` con el tipo de motivo.
- `v_user_id` ya existe en la función (`v_user_id := auth.uid()`), no se agregan variables.
- Nada más del cuerpo cambia: validaciones de permisos, auto-consolidación, creación/actualización de `fulfillment_orders`, asignación de viaje y eventos quedan byte a byte iguales.

Antes de aplicar te paso el archivo de migración completo para que veas el `CREATE OR REPLACE` entero, no solo este fragmento.

## 2. Backfill — dry-run (conteo real, todavía sin ejecutar)

Distribución actual de `rejection_reason` en los 517 pedidos rechazados:

| Valor actual en `rejection_reason` | Filas | Acción del backfill |
|---|---|---|
| `stock_difference` | 194 | → `rejection_reason_type = stock_difference`, observación vacía |
| `other` | 123 | → `rejection_reason_type = other`, observación vacía |
| `not_convenient_rotation` | 90 | → `rejection_reason_type = not_convenient_rotation`, observación vacía |
| `stock_reserved` | 51 | → `rejection_reason_type = stock_reserved`, observación vacía |
| `product_not_found` | 32 | → `rejection_reason_type = product_not_found`, observación vacía |
| `no_stock_real` | 14 | → `rejection_reason_type = no_stock_real`, observación vacía |
| **Total a modificar** | **504** | |
| "Saneamiento histórico: pedido en consolidación…" (4), NULL (3), "PRUEBA ANCLA…" (2), "tengo solo 6, averiado 3" (1), "Rollback por error…" (1), "PENDIENTE TODO EL STOCK…" (1), "Se va con la reposición Paraná" (1) | 13 | **No se tocan** (son observaciones reales o vacías) |

Sobre `rejected_by` / `rejected_at` históricos: solo **13** de los 517 pedidos rechazados tienen un evento de rechazo en `operational_events`. Para esos 13 se recuperan autor y fecha desde el evento; los 504 restantes quedan nulos y la UI sigue mostrando "Usuario desconocido / Sin fecha" (dato que nunca existió, no se inventa).

No se ejecuta nada hasta tu OK explícito sobre estos números.

## 3. UI — solo el bloque de rechazo

Ajuste mínimo en el bloque "Motivo del rechazo" de `SolicitudDetail.tsx`: si `rejection_reason` trae un código conocido (registro viejo que no haya entrado al backfill), se muestra traducido en "Motivo" y no crudo en "Observación". Ningún otro cambio en el componente.

## Riesgos y mitigación

- **Riesgo**: reemplazar una función central. **Mitigación**: se cambia un solo UPDATE; el resto del cuerpo se copia textual y el diff se aprueba antes de aplicar.
- **Riesgo**: el backfill toca 504 filas. **Mitigación**: filtro exacto por los 6 códigos conocidos; las 13 filas con texto real quedan intactas. Conteo aprobado antes de correr.
- **Riesgo**: `rejection_reason_type` es enum. **Mitigación**: cast explícito y solo con valores del enum.

## Checklist de regresión (todas las transiciones de la función)

Cada transición debe seguir comportándose igual que hoy, sin errores y con los efectos laterales esperados (fulfillment, custodia, viaje, eventos):

1. Pendiente → **Aceptado**
2. Aceptado → **En preparación**
3. En preparación → **Listo para retiro** (incluida la auto-consolidación cuando el origen es hub interurbano)
4. En preparación → **Listo para entrega** (flujo cliente)
5. Listo → **En consolidación**
6. En consolidación → **Asignado a viaje** (con `p_trip_id`, verificando `fulfillment_orders.trip_id`)
7. Asignado → **En tránsito** (creación/actualización de fulfillment y despacho)
8. En tránsito → **Entregado** / **Entregado a tercero**
9. Entregado → **Recibido**
10. Recibido → **Cierre logístico**
11. Cierre logístico → **Cierre administrativo (Cerrado)**
12. Pendiente → **Rechazado**: Motivo traducido, Observación con texto libre, Rechazado por con nombre real, Fecha con hora
13. Pedido histórico #3108: Motivo "Diferencia de stock", sin códigos crudos en pantalla
14. Validaciones de permisos por rol y el bloqueo "el pedido debe tener al menos un ítem" siguen activos
15. Línea de tiempo del detalle sigue mostrando todos los hitos
