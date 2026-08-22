# Saneamiento único de lanzamiento — cierre de registros abiertos previos al 2026-08-07

## (a) AUDITORÍA — conteos reales (created_at < 2026-08-07)

### 1. Pedidos activos (branch_requests, is_pre_sale = false) — 2.047 registros

| Estado | Cantidad | Camino de cierre |
|---|---|---|
| ready_for_pickup | 627 | caminar hasta closed |
| delivered | 607 | received → logistic_closed → closed |
| accepted | 323 | nunca despachado → cierre sin despacho |
| in_consolidation | 173 | assigned_to_trip → in_transit → … → closed |
| in_preparation | 133 | nunca despachado → cierre sin despacho |
| assigned_to_trip | 66 | in_transit → delivered → … → closed |
| pending | 60 | nunca despachado → cierre sin despacho |
| in_transit | 45 | delivered → received → … → closed |
| in_supply | 10 | sin transición saliente en la RPC → HUECO |
| supplied | 1 | sin transición saliente en la RPC → HUECO |
| delivered_to_third_party | 1 | sin transición saliente en la RPC → HUECO |
| ready_for_delivery | 1 | delivered_to_third_party → HUECO (ese estado no tiene salida) |

### 2. Recibidos sin cierre administrativo — 200
- `received`: 50 → logistic_closed → closed
- `logistic_closed`: 150 → closed

### 3. Fulfillment orders abiertas — 786
- `delivered`: 671 · `at_hub`: 110 · `in_transit`: 5
- Se sincronizan con el pedido padre; las que no tengan pedido asociado cerrable → HUECO.

### 4. Consultas colgadas — 0 (no hay open/responded antes del corte). Nada que hacer.

### 5. Incidencias abiertas — 1 (`under_review`) → resolved/closed con motivo de saneamiento.

## Hallazgo clave de la auditoría (afecta la política propuesta)

`fn_transition_request_status` tiene matriz estricta y **no permite saltos**: no existe `pending → closed` ni ninguna transición directa a `closed` desde estados tempranos. Las únicas salidas de `pending` son `accepted` y `rejected`. Además `in_supply`, `supplied`, `delivered_to_third_party` y `ready_for_delivery → delivered_to_third_party` no tienen camino hasta `closed` en la matriz actual.

## (b) PLAN

### Política de cierre final (mapa estado → terminal)

| Categoría | Política |
|---|---|
| Nunca despachados (pending 60, accepted 323, in_preparation 133) | **rejected** con `rejection_reason_type = 'other'` y `rejection_reason = 'saneamiento_lanzamiento'`. Es el único terminal alcanzable desde esos estados sin falsificar despachos/entregas. (Alternativa: caminar toda la cadena simulando entregas — lo descarto porque inventaría datos logísticos falsos.) |
| Despachados / en curso (ready_for_pickup, in_consolidation, assigned_to_trip, in_transit, delivered) | Caminar la cadena real hasta `received → logistic_closed → closed`, con `p_reason = 'saneamiento_lanzamiento'` en cada paso. |
| received / logistic_closed (200) | Caminar hasta `closed`. |
| in_supply, supplied, delivered_to_third_party, ready_for_delivery (13) | **NO forzar** → reporte de huecos. |
| fulfillment_orders huérfanas de pedido cerrable | Reporte de huecos. |
| Incidencia under_review (1) | UPDATE estampado: status `closed`, motivo `saneamiento_lanzamiento` (no existe RPC de incidencias). |

### Mecanismo exacto

UNA migración nueva que crea `public.fn_saneamiento_lanzamiento(p_cutoff timestamptz, p_actor uuid, p_dry_run boolean)`:

1. **SECURITY DEFINER, sin GRANT a anon/authenticated** (solo service_role). Se ejecuta una sola vez vía SQL; queda disponible para re corrida idempotente.
2. Dentro, fija `request.jwt.claims` con `sub = p_actor` (usuario admin del saneamiento) para que `auth.uid()` funcione y **cada pedido pase por `fn_transition_request_status` real** — mismas validaciones, mismos triggers, mismos eventos. Nada de UPDATE masivo crudo sobre branch_requests.
3. Recorre candidatos `created_at < p_cutoff` en orden, con bloque `BEGIN…EXCEPTION` por registro: un fallo no frena el lote, cae al reporte de huecos con el mensaje de error exacto.
4. Para `in_consolidation → assigned_to_trip` reutiliza el `trip_id` ya existente en su fulfillment_order; si no hay viaje → hueco (no crea viajes falsos).
5. Tras cerrar cada pedido, sincroniza sus `fulfillment_orders` abiertas al estado terminal coherente (`received`/`completed`) con UPDATE por registro estampado (no existe RPC de fulfillment; es el único camino).
6. **Idempotencia**: salta registros ya terminales y los que ya tienen evento con motivo `saneamiento_lanzamiento`; re-correr no duplica eventos ni re-cierra.
7. **Auditoría**: cada transición queda con `p_reason = 'saneamiento_lanzamiento'`, el actor en los campos `*_by` que puebla la RPC, y los eventos/triggers habituales. Resumen del run (conteos por categoría + huecos) se persiste en `diagnostic_logs` y se devuelve como jsonb.
8. **Ejecución en 2 pasos**: primero `p_dry_run = true` (solo simula y devuelve conteos + huecos previstos, sin escribir). Te muestro ese reporte y recién después corro `p_dry_run = false`.

### Archivos
- `supabase/migrations/<fecha>_fn_saneamiento_lanzamiento.sql` (único archivo nuevo).
- No se toca `request-status.ts`, ni la RPC existente, ni UI.

## (c) RIESGOS DE REGRESIÓN y mitigación

- **Volumen alto** (~2.250 pedidos × varias transiciones): bloque por registro con savepoint lógico (EXCEPTION), sin transacción única gigante; locks cortos por fila (`FOR UPDATE` ya lo hace la RPC).
- **Triggers con efectos laterales** (auto-consolidación de hub, creación de fulfillment en assigned_to_trip, sync de padres multi-origen): es el comportamiento real deseado; los padres multi-origen no aceptan transiciones manuales — se cierran los hijos y el trigger `fn_sync_parent_status` cierra el padre; padres que no cierren → hueco.
- **Suplantación de auth.uid()**: contenida dentro de la función, sin GRANT a roles de app, actor explícito por parámetro.
- **Pedidos con datos faltantes** (sin ítems, sin viaje, sucursal sin logistic_group): la RPC los rechaza → caen al reporte, no se fuerzan.
- **Registros posteriores al corte**: filtro estricto `created_at < '2026-08-07'` en cada consulta del lote.
- **Re-corrida**: idempotente por doble guarda (estado terminal + evento de saneamiento existente).

## Pendiente de tu OK

1. ¿Confirmás que los 456 pedidos nunca despachados van a **rejected** (único terminal real alcanzable) en vez de `closed`?
2. ¿Confirmás el usuario actor del saneamiento (tu usuario admin) para estampar `*_by`?
3. Con tu OK: aplico la migración, corro el **dry-run**, te muestro el reporte, y recién entonces ejecuto el saneamiento real y te devuelvo el reporte final.
