# Saneamiento único de lanzamiento — cierre de registros abiertos previos al 2026-08-07 (V2 corregido)

## (a) AUDITORÍA — conteos reales (created_at < 2026-08-07)

### 1. Pedidos activos (branch_requests, is_pre_sale = false) — 2.047 registros

| Estado | Cantidad | Camino de cierre |
|---|---|---|
| ready_for_pickup | 627 | caminar hasta closed |
| delivered | 607 | received → logistic_closed → closed |
| accepted | 323 | **sin camino a terminal** (ver §5) |
| in_consolidation | 173 | assigned_to_trip → in_transit → … → closed |
| in_preparation | 133 | **sin camino a terminal** (ver §5) |
| assigned_to_trip | 66 | in_transit → delivered → … → closed |
| pending | 60 | rejected (único terminal alcanzable) |
| in_transit | 45 | delivered → received → … → closed |
| in_supply | 10 | sin transición saliente → HUECO |
| supplied | 1 | sin transición saliente → HUECO |
| delivered_to_third_party | 1 | sin transición saliente → HUECO |
| ready_for_delivery | 1 | su única salida (delivered_to_third_party) no tiene salida → HUECO |

### 2. Recibidos sin cierre administrativo — 200
- `received`: 50 → logistic_closed → closed
- `logistic_closed`: 150 → closed

### 3. Fulfillment orders abiertas — 786
- `delivered`: 671 · `at_hub`: 110 · `in_transit`: 5
- Se sincronizan con el pedido asociado; las que no tengan pedido cerrable → HUECO.

### 4. Consultas colgadas — 0. Nada que hacer.

### 5. Incidencias abiertas — 1 (`under_review`) → `closed` con motivo de saneamiento (UPDATE estampado; no existe RPC de incidencias).

## (4) Aclaración del número — cuál es el correcto

Los nunca despachados son **516** (pending 60 + accepted 323 + in_preparation 133). Mi "456" anterior era accepted + in_preparation solamente — el número correcto de la categoría es **516**.

## (5) Confirmación EXPLÍCITA de la matriz (verificada en el código de la RPC)

- `pending → rejected`: **SÍ permitido** (los 60 pending sí se cierran por esta vía).
- `accepted → rejected`: **NO permitido**. La única salida de `accepted` es `picking` / `in_preparation`.
- `in_preparation → rejected`: **NO permitido**. Sus únicas salidas son `ready_for_pickup` / `ready_for_delivery`.

Consecuencia: con la RPC tal como está, **456 pedidos (323 accepted + 133 in_preparation) no tienen ningún camino a un estado terminal** y caerían todos al reporte de huecos. Opciones:

- **Opción A (recomendada)**: enmienda mínima y controlada de la matriz de `fn_transition_request_status` para permitir `accepted → rejected` e `in_preparation → rejected` (con permiso del origen o admin, mismo patrón que `pending → rejected`). Es un hueco real del flujo — hoy un pedido aceptado no se puede cancelar/rechazar nunca. Requiere tu OK explícito porque toca la RPC operativa.
- **Opción B**: no tocar la RPC; esos 456 quedan como huecos reportados y los revisamos aparte.
- Descartada: caminarlos hacia adelante simulando despacho/entrega — inventaría datos logísticos falsos.

## (b) PLAN

### Política de cierre final (mapa estado → terminal)

| Categoría | Política |
|---|---|
| pending (60) | `rejected` con `rejection_reason_type = 'other'` y `rejection_reason = 'saneamiento_lanzamiento'` |
| accepted (323) + in_preparation (133) | `rejected` con mismo motivo — **solo si aprobás la Opción A**; si no, van a huecos |
| Despachados / en curso (ready_for_pickup, in_consolidation, assigned_to_trip, in_transit, delivered — 1.518) | Caminar la cadena real hasta `received → logistic_closed → closed`, con `p_reason = 'saneamiento_lanzamiento'` en cada paso |
| received / logistic_closed (200) | Caminar hasta `closed` |
| in_supply, supplied, delivered_to_third_party, ready_for_delivery (13) | **NO forzar** → reporte de huecos |
| fulfillment_orders sin pedido cerrable | Reporte de huecos |
| Incidencia under_review (1) | UPDATE estampado: status `closed`, motivo `saneamiento_lanzamiento` |

### (1) Ajuste del Dashboard Ejecutivo — exclusión del motivo de saneamiento

Auditoría del dashboard: la única métrica que toca `rejected` es el **embudo operativo** (`useOperationalFunnel` en `src/hooks/use-executive-dashboard.ts`): la etapa "Solicitudes" cuenta todos los pedidos (incluye rechazados) y "Aceptados" excluye pending+rejected. Una inyección de ~516 rechazos inflaría "Solicitudes", deprimiría "Aceptados" y correría el cálculo de bottleneck.

Ajuste: en `useOperationalFunnel` se agrega `rejection_reason` al select y se **excluyen los pedidos con `rejection_reason = 'saneamiento_lanzamiento'` del conteo de ambas etapas** (Solicitudes y Aceptados). Es el único punto del dashboard que referencia rechazos (verificado con búsqueda exhaustiva: no hay tasa de aceptación ni conteo de rechazos en ningún otro hook ni en la edge function `executive-insights`). Los rechazos de saneamiento quedan así invisibles para las métricas pero visibles en el detalle de cada pedido.

### (2) Actor: usuario de sistema dedicado

La RPC exige `auth.uid()` con rol admin/supervisor/owner para la mayoría de las transiciones, así que el actor debe ser un usuario real con rol. Propuesta:

1. Crear usuario de sistema `saneamiento@movilog.local` (vía la edge function `create-user` ya existente), contraseña aleatoria descartable, **rol `admin` en `user_roles`**, sin acceso de UI documentado.
2. Ese UUID se pasa como `p_actor` a la función de saneamiento, que fija `request.jwt.claims` con su `sub` para que `auth.uid()` y `has_role` funcionen dentro de la RPC real.
3. Al terminar el saneamiento, el usuario queda **deshabilitado** (baneado) — queda solo como sello histórico en `*_by` y eventos.

### Mecanismo exacto

UNA migración nueva que crea `public.fn_saneamiento_lanzamiento(p_cutoff timestamptz, p_actor uuid, p_dry_run boolean)`:

1. **SECURITY DEFINER, sin GRANT a anon/authenticated** (solo service_role).
2. Fija `request.jwt.claims` con `sub = p_actor` y **cada pedido pasa por `fn_transition_request_status` real** — mismas validaciones, triggers y eventos. Nada de UPDATE masivo crudo sobre branch_requests.
3. Recorre candidatos `created_at < p_cutoff` con bloque `BEGIN…EXCEPTION` por registro: un fallo no frena el lote, cae al reporte de huecos con el mensaje de error exacto.
4. Para `in_consolidation → assigned_to_trip` reutiliza el `trip_id` ya existente en su fulfillment_order; si no hay viaje → hueco (no crea viajes falsos).
5. Tras cerrar cada pedido, sincroniza sus `fulfillment_orders` abiertas al terminal coherente (`received`/`completed`) con UPDATE por registro estampado (no existe RPC de fulfillment).
6. **Idempotencia**: salta registros ya terminales y los que ya tienen evento con motivo `saneamiento_lanzamiento`; re-correr no duplica eventos ni re-cierra.
7. **Auditoría**: cada transición con `p_reason = 'saneamiento_lanzamiento'`, actor del sistema en los campos `*_by`, eventos habituales. Resumen del run (conteos + huecos) en `diagnostic_logs` y devuelto como jsonb.
8. **(3) Ejecución en 2 pasos**: primero `p_dry_run = true` (simula, devuelve conteos + huecos previstos, sin escribir). Te muestro ese reporte y recién con tu OK corro `p_dry_run = false`.

### Archivos
- `supabase/migrations/<fecha>_fn_saneamiento_lanzamiento.sql` (función nueva; si aprobás Opción A, misma migración incluye la enmienda de la matriz de la RPC).
- `src/hooks/use-executive-dashboard.ts` (exclusión del motivo en el embudo — único cambio frontend).
- Creación del usuario de sistema vía `create-user` (no es un archivo).
- No se toca `request-status.ts` ni ninguna otra UI.

## (c) RIESGOS DE REGRESIÓN y mitigación

- **Opción A toca la RPC operativa**: la enmienda es aditiva (2 transiciones nuevas, mismas reglas de permiso que `pending → rejected`); el checklist de regresión cubre las 15 transiciones existentes para confirmar que ninguna cambia.
- **Volumen alto** (~2.250 pedidos × varias transiciones): bloque EXCEPTION por registro, locks cortos por fila.
- **Triggers con efectos laterales** (auto-consolidación hub, creación de fulfillment, sync de padres multi-origen): comportamiento real deseado; padres que no cierren solos → hueco.
- **Usuario de sistema con rol admin**: se crea solo para el run y se deshabilita al finalizar; la función de saneamiento no recibe GRANT para roles de app.
- **Métricas ejecutivas**: la exclusión por motivo garantiza que el embudo no se contamina; verificado que no hay otra métrica de rechazos.
- **Registros posteriores al corte**: filtro estricto `created_at < '2026-08-07'` en cada consulta del lote.
- **Re-corrida**: idempotente por doble guarda (estado terminal + evento de saneamiento existente).

## Pendiente de tu OK

1. ¿Opción A (enmienda mínima de la RPC para cerrar los 456) u Opción B (quedan como huecos)?
2. ¿Confirmás la creación del usuario de sistema `saneamiento@movilog.local` con rol admin, deshabilitado al terminar?
3. Con tu OK: aplico la migración + ajuste del dashboard, corro el **dry-run**, te muestro el reporte, y recién entonces ejecuto el saneamiento real y te devuelvo el reporte final.
