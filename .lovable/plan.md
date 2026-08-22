# Saneamiento único de lanzamiento — cierre de registros abiertos previos al 2026-08-07 (V3 — aprobado con Opción A)

## (a) AUDITORÍA — conteos reales (created_at < 2026-08-07)

### 1. Pedidos activos (branch_requests, is_pre_sale = false) — 2.047 registros

| Estado | Cantidad | Camino de cierre |
|---|---|---|
| ready_for_pickup | 627 | caminar hasta closed |
| delivered | 607 | received → logistic_closed → closed |
| accepted | 323 | rejected (Opción A — enmienda de matriz) |
| in_consolidation | 173 | assigned_to_trip → in_transit → … → closed |
| in_preparation | 133 | rejected (Opción A — enmienda de matriz) |
| assigned_to_trip | 66 | in_transit → delivered → … → closed |
| pending | 60 | rejected (ya permitido hoy) |
| in_transit | 45 | delivered → received → … → closed |
| in_supply | 10 | sin transición saliente → HUECO |
| supplied | 1 | sin transición saliente → HUECO |
| delivered_to_third_party | 1 | sin transición saliente → HUECO |
| ready_for_delivery | 1 | su única salida no tiene salida → HUECO |

### 2. Recibidos sin cierre administrativo — 200
- `received`: 50 → logistic_closed → closed
- `logistic_closed`: 150 → closed

### 3. Fulfillment orders abiertas — 786
- `delivered`: 671 · `at_hub`: 110 · `in_transit`: 5
- Se sincronizan con el pedido asociado; las que no tengan pedido cerrable → HUECO.

### 4. Consultas colgadas — 0. Nada que hacer.

### 5. Incidencias abiertas — 1 (`under_review`) → `closed` con motivo de saneamiento (UPDATE estampado; no existe RPC de incidencias).

### 6. Verificaciones nuevas de esta auditoría (V3)

- **FOs de los 516 nunca despachados: 0** (verificado: accepted 323, in_preparation 133, pending 60 — ninguno tiene fulfillment_order asociada). El saneamiento no va a tocar FOs por esta vía, pero la enmienda de la RPC cubre el caso general igual (ver §Opción A).
- **Triggers sobre branch_requests verificados**: `fn_block_supply_transitions` solo bloquea transiciones de/hacia `in_supply`/`supplied` (no afecta accepted/in_preparation → rejected). `fn_check_request_closure` no bloquea rechazos. Ningún trigger impide la enmienda.
- **Enum `fulfillment_status` ya incluye `cancelled`** — se reutiliza, no se crea nada nuevo.
- **Matriz actual confirmada**: `pending → rejected` SÍ; `accepted → rejected` e `in_preparation → rejected` NO (única salida de accepted es picking/in_preparation; de in_preparation, ready_for_pickup/ready_for_delivery).

## (b) PLAN

### Opción A — Enmienda de la RPC `fn_transition_request_status` (APROBADA)

`CREATE OR REPLACE` de la función de 5 parámetros, copiando el cuerpo actual textual con exactamente dos cambios:

1. **Matriz**: agregar al bloque de validación de transiciones (válido para cualquier flow_type, mismo patrón que `pending → rejected`):
   ```sql
   ELSIF v_old_status = 'accepted' AND p_new_status = 'rejected' THEN
     v_transition_valid := TRUE;
   ELSIF v_old_status = 'in_preparation' AND p_new_status = 'rejected' THEN
     v_transition_valid := TRUE;
   ```
   Permisos: los ya existentes — `p_new_status = 'rejected'` ya está cubierto en la sección de permisos (`v_is_origin` o admin/supervisor/owner). No se toca la lógica de permisos.

2. **Cancelación de fulfillments al rechazar** (requisito 1 — transición operativa general, no solo saneamiento): bloque nuevo después del UPDATE principal:
   ```sql
   IF p_new_status = 'rejected' THEN
     UPDATE public.fulfillment_orders
     SET status = 'cancelled'::fulfillment_status,
         trip_id = NULL,
         updated_at = now()
     WHERE branch_request_id = p_request_id
       AND status NOT IN ('completed'::fulfillment_status,
                          'cancelled'::fulfillment_status,
                          'received'::fulfillment_status,
                          'logistic_closed'::fulfillment_status);
   END IF;
   ```
   Solo cancela FOs no terminales; las ya cerradas/recibidas no se tocan. Como hoy `pending → rejected` nunca tiene FOs, este bloque es no-op para el flujo existente y solo actúa en las 2 transiciones nuevas.

Nada más del cuerpo cambia: validaciones, auto-consolidación, creación de fulfillment en assigned_to_trip/in_transit, eventos — byte a byte iguales.

### Política de cierre final (mapa estado → terminal)

| Categoría | Política |
|---|---|
| pending (60) | `rejected` con `rejection_reason_type = 'other'` y `rejection_reason = 'saneamiento_lanzamiento'` |
| accepted (323) + in_preparation (133) | `rejected` con mismo motivo (vía enmienda Opción A) |
| Despachados / en curso (ready_for_pickup, in_consolidation, assigned_to_trip, in_transit, delivered — 1.518) | Caminar la cadena real hasta `received → logistic_closed → closed`, con `p_reason = 'saneamiento_lanzamiento'` en cada paso |
| received / logistic_closed (200) | Caminar hasta `closed` |
| in_supply, supplied, delivered_to_third_party, ready_for_delivery (13) | **NO forzar** → reporte de huecos |
| fulfillment_orders sin pedido cerrable | Reporte de huecos |
| Incidencia under_review (1) | UPDATE estampado: status `closed`, motivo `saneamiento_lanzamiento` |

### Ajuste del Dashboard Ejecutivo — exclusión del motivo de saneamiento

La única métrica que toca `rejected` es el embudo operativo (`useOperationalFunnel` en `src/hooks/use-executive-dashboard.ts`): "Solicitudes" cuenta todos los pedidos y "Aceptados" excluye pending+rejected. Ajuste: agregar `rejection_reason` al select y **excluir los pedidos con `rejection_reason = 'saneamiento_lanzamiento'` del conteo de ambas etapas**. Verificado con búsqueda exhaustiva: no hay tasa de aceptación ni conteo de rechazos en ningún otro hook ni en la edge function `executive-insights`. Los rechazos de saneamiento quedan invisibles para las métricas pero visibles en el detalle de cada pedido como "Rechazada (saneamiento_lanzamiento)".

### Actor: usuario de sistema dedicado (APROBADO)

1. Crear `saneamiento@movilog.local` vía la edge function `create-user` existente: `full_name = 'SANEAMIENTO'`, contraseña aleatoria descartable, **rol `admin`**, `all_branches_access = true`.
2. Ese UUID se pasa como `p_actor` a la función de saneamiento, que fija `request.jwt.claims` con su `sub` para que `auth.uid()` y `has_role` funcionen dentro de la RPC real.
3. **Visibilidad**: los cierres quedan estampados con ese UUID en `rejected_by` / campos `*_by`, y la UI los muestra como "SANEAMIENTO" (resuelve nombre desde `profiles`, igual que cualquier usuario).
4. **Deshabilitado al terminar** (ban de auth): no rompe referencias históricas — los FK apuntan a `auth.users`/`profiles`, que no se borran; el ban solo impide login.

### Mecanismo exacto

UNA migración nueva que:
1. Enmienda `fn_transition_request_status` (Opción A, arriba).
2. Crea `public.fn_saneamiento_lanzamiento(p_cutoff timestamptz, p_actor uuid, p_dry_run boolean)`:
   - **SECURITY DEFINER, sin GRANT a anon/authenticated** (solo service_role).
   - Fija `request.jwt.claims` con `sub = p_actor` y **cada pedido pasa por `fn_transition_request_status` real** — mismas validaciones, triggers y eventos. Nada de UPDATE masivo crudo sobre branch_requests.
   - Recorre candidatos `created_at < p_cutoff` con bloque `BEGIN…EXCEPTION` por registro: un fallo no frena el lote, cae al reporte de huecos con el mensaje de error exacto.
   - Para `in_consolidation → assigned_to_trip` reutiliza el `trip_id` ya existente en su fulfillment_order; si no hay viaje → hueco (no crea viajes falsos).
   - Tras cerrar cada pedido, sincroniza sus `fulfillment_orders` abiertas al terminal coherente (`received`/`completed`) con UPDATE por registro estampado (no existe RPC de fulfillment).
   - **Idempotencia**: salta registros ya terminales y los que ya tienen evento con motivo `saneamiento_lanzamiento`; re-correr no duplica eventos ni re-cierra.
   - **Auditoría**: cada transición con `p_reason = 'saneamiento_lanzamiento'`, actor del sistema en los campos `*_by`, eventos habituales. Resumen del run (conteos + huecos) en `diagnostic_logs` y devuelto como jsonb.

### Ejecución en 2 pasos (APROBADO)

1. Aplico migración + ajuste del dashboard + creo el usuario de sistema.
2. Corro `p_dry_run = true` (simula, devuelve conteos + huecos previstos, sin escribir) y **te muestro el reporte**.
3. Recién con tu OK corro `p_dry_run = false` y te devuelvo el reporte final.

### Archivos
- `supabase/migrations/<fecha>_fn_saneamiento_lanzamiento.sql` (enmienda RPC + función nueva).
- `src/hooks/use-executive-dashboard.ts` (exclusión del motivo en el embudo — único cambio frontend).
- Creación del usuario de sistema vía `create-user` (no es un archivo).
- No se toca `request-status.ts` ni ninguna otra UI.

## (c) RIESGOS DE REGRESIÓN y mitigación

- **La enmienda toca la RPC operativa**: es aditiva (2 transiciones nuevas + 1 bloque de cancelación de FOs que es no-op en el flujo actual); el checklist cubre las 15 transiciones existentes para confirmar que ninguna cambia.
- **Cancelación de FOs al rechazar**: solo afecta FOs no terminales de pedidos rechazados; verificado que hoy ningún pedido rechazable tiene FOs, así que el comportamiento actual no cambia.
- **Volumen alto** (~2.250 pedidos × varias transiciones): bloque EXCEPTION por registro, locks cortos por fila.
- **Triggers con efectos laterales** (auto-consolidación hub, creación de fulfillment, sync de padres multi-origen): comportamiento real deseado; padres que no cierren solos → hueco.
- **Usuario de sistema con rol admin**: se crea solo para el run y se deshabilita al finalizar; la función de saneamiento no recibe GRANT para roles de app.
- **Métricas ejecutivas**: la exclusión por motivo garantiza que el embudo no se contamina.
- **Registros posteriores al corte**: filtro estricto `created_at < '2026-08-07'` en cada consulta del lote.
- **Re-corrida**: idempotente por doble guarda (estado terminal + evento de saneamiento existente).

## Checklist de regresión (16 ítems — las 15 transiciones existentes + el caso nuevo)

1. Pendiente → Aceptado
2. Aceptado → En preparación
3. En preparación → Listo para retiro (incluida auto-consolidación hub interurbano)
4. En preparación → Listo para entrega (flujo cliente)
5. Listo → En consolidación
6. En consolidación → Asignado a viaje (con `p_trip_id`, verificando `fulfillment_orders.trip_id`)
7. Asignado → En tránsito (creación/actualización de fulfillment y despacho)
8. En tránsito → Entregado / Entregado a tercero
9. Entregado → Recibido
10. Recibido → Cierre logístico
11. Cierre logístico → Cerrado
12. Pendiente → Rechazado: motivo traducido, observación, autor y fecha correctos (comportamiento actual intacto)
13. **NUEVO — Aceptado → Rechazado**: permitido con permiso de origen o admin; estampa `rejected_by/at`, motivo y tipo
14. **NUEVO — En preparación → Rechazado**: idem anterior
15. **NUEVO — Cancelación de fulfillment al rechazar**: pedido en `in_preparation` con fulfillment_order abierta → al rechazarlo, la FO queda `cancelled`, sin `trip_id`; FOs ya terminales (received/completed) NO se tocan
16. Validaciones de permisos por rol y bloqueo "pedido sin ítems" siguen activos; línea de tiempo del detalle intacta

## Secuencia de ejecución (con tu OK a este plan)

1. Aplico la migración (enmienda RPC + `fn_saneamiento_lanzamiento`).
2. Ajusto `use-executive-dashboard.ts` (exclusión del motivo en el embudo).
3. Creo el usuario `saneamiento@movilog.local` (rol admin, acceso total).
4. Corro el **DRY-RUN** y te muestro el reporte (conteos por categoría + huecos).
5. **Freno acá.** El run real solo con tu aprobación del reporte.
