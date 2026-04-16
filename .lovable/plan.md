

# Plan Maestro Consolidado: Redefinición del Flujo de Estados de Pedidos

## Contexto

El sistema actual usa un flujo lineal único para todos los pedidos (`pending → in_preparation → in_transit → delivered → received → logistic_closed → closed`), lo cual no refleja la operación real. Se requieren 3 escenarios diferenciados según tipo de pedido y grupo logístico.

---

## Fase 0: Checklist de Integridad Previo

Verificar antes de cualquier cambio:

| Punto | Estado esperado |
|-------|----------------|
| Enum `request_status` actual | 11 valores (pending, in_preparation, accepted, rejected, picking, dispatched, in_transit, delivered, received, logistic_closed, closed) |
| Datos existentes | 65 pedidos (41 pending, 9 closed, 5 logistic_closed, 4 delivered, 3 rejected, 2 in_preparation, 1 received) |
| Fulfillments existentes | 20 (todos pending) |
| 0 registros con estados legacy | Confirmar 0 en accepted, picking, dispatched |
| Triggers en `branch_requests` | fn_check_request_closure, fn_validate_business_rules, fn_validate_delivery_charges, fn_validate_different_branches, update_updated_at |
| RPC central | fn_transition_request_status operativo |
| RPC chofer | fn_driver_action operativo |
| Integraciones BIMS | bims-proxy, bims-sync, bims-stock-live — sin cambios |
| RLS policies | No se modifican |

---

## Fase 1: Migración de Base de Datos

### 1a. Agregar `logistic_group` a `branches` + poblar datos

```sql
ALTER TABLE branches ADD COLUMN logistic_group varchar;

UPDATE branches SET logistic_group = 'encarnacion_local' WHERE code IN ('1','9','15','5');
-- SUC SAN ROQUE (1), SUC. CABALLERO (9), STOCK ADMINISTRACION (15), Deposito Importación (5)

UPDATE branches SET logistic_group = 'luque' WHERE code = '8';
UPDATE branches SET logistic_group = 'oviedo' WHERE code = '21';
UPDATE branches SET logistic_group = 'hohenau' WHERE code = '17';

-- MUESTRAS VENTA EXTERNA (6) y Warehouse undefined → NULL (excluidas)
```

### 1b. Agregar nuevos estados al enum `request_status`

```sql
ALTER TYPE request_status ADD VALUE IF NOT EXISTS 'ready_for_pickup';
ALTER TYPE request_status ADD VALUE IF NOT EXISTS 'ready_for_delivery';
ALTER TYPE request_status ADD VALUE IF NOT EXISTS 'in_consolidation';
ALTER TYPE request_status ADD VALUE IF NOT EXISTS 'assigned_to_trip';
ALTER TYPE request_status ADD VALUE IF NOT EXISTS 'delivered_to_third_party';
```

### 1c. Agregar campos a `branch_requests`

```sql
ALTER TABLE branch_requests ADD COLUMN flow_type varchar;
ALTER TABLE branch_requests ADD COLUMN consolidation_override boolean DEFAULT null;
```

---

## Fase 2: Actualizar RPC `fn_transition_request_status`

### 2a. Cálculo de `flow_type` al aceptar (`pending → in_preparation`)

Lógica de determinación (en este orden):

1. Si `request_type IN ('client','online') AND delivery_target = 'client'` → `'client_delivery'`
2. Si `consolidation_override = false` → `'urban'`
3. Si `consolidation_override = true` → `'interurban'`
4. Si ambas sucursales tienen `logistic_group NOT NULL` e iguales → `'urban'`
5. Si alguna sucursal tiene `logistic_group = NULL` → `'interurban'` (fallback) + insertar warning en `ai_anomalies` con `anomaly_type = 'missing_logistic_group'`, `severity = 'warning'`
6. Default (grupos distintos) → `'interurban'`

El `flow_type` se persiste en el campo de `branch_requests`.

### 2b. Transiciones válidas por escenario

**Tronco común (sin cambio):**
- `pending → in_preparation` (origin/admin)
- `pending → rejected` (origin/admin, requiere reason)

**client_delivery:**
- `in_preparation → ready_for_delivery` (origin/admin, requiere doc BIMS factura)
- `ready_for_delivery → delivered_to_third_party` (origin/admin)
- `delivered_to_third_party → closed` (auto-trigger)

**urban:**
- `in_preparation → ready_for_pickup` (origin/admin, requiere doc BIMS transferencia)
- `ready_for_pickup → in_transit` (solo vía fn_driver_action pickup)
- `in_transit → delivered` (origin/driver/admin)
- `delivered → received` (destination/admin)
- `received → logistic_closed` (destination/admin)
- `logistic_closed → closed` (auto-trigger existente)

**interurban:**
- `in_preparation → ready_for_pickup` (origin/admin, requiere doc BIMS transferencia)
- `ready_for_pickup → in_consolidation` (solo vía fn_driver_action pickup)
- `in_consolidation → assigned_to_trip` (admin/supervisor/warehouse_operator)
- `assigned_to_trip → in_transit` (chofer/admin, al iniciar viaje)
- `in_transit → delivered → received → logistic_closed → closed` (igual que urban)

### 2c. Validación de consistencia de `flow_type`

En cada transición posterior a `in_preparation`, el RPC verifica que la transición solicitada sea coherente con el `flow_type` almacenado. Si no coincide, rechaza con error descriptivo.

### 2d. Backward compatibility

Las transiciones actuales (`in_preparation → in_transit`, etc.) se mantienen válidas para pedidos con `flow_type IS NULL` (los 65 existentes).

### 2e. Función `fn_recalculate_flow_type(p_request_id)`

Nueva función que permite a un admin recalcular el `flow_type` si cambiaron las condiciones maestras. Solo aplicable a pedidos en estado `pending` o `in_preparation`.

---

## Fase 3: Actualizar RPC `fn_driver_action` — Pickup diferenciado

En la acción `pickup`:
1. Leer el `flow_type` del `branch_request` asociado al fulfillment
2. **Si `flow_type = 'urban'`**: actualizar el request a `in_transit`
3. **Si `flow_type = 'interurban'`**: actualizar el request a `in_consolidation`
4. **Si `flow_type IS NULL`** (pedidos legacy): no tocar el request status (comportamiento actual)

La consolidación NUNCA es automática — solo ocurre cuando el chofer ejecuta retiro físico.

---

## Fase 4: Trigger `fn_check_request_closure`

Agregar al trigger existente:
- Cuando el estado cambia a `delivered_to_third_party` en pedidos `client_delivery`: auto-setear `closed_at = now()` y `status = 'closed'`
- Sin cambios para reposición (ya funciona con `logistic_closed_at`)
- Sin cambios para lógica `logistic_closed_at + admin_closed_at`

---

## Fase 5: Trigger `fn_validate_request_edit`

Agregar nuevos estados bloqueados al array:
```sql
v_blocked_statuses := ARRAY[
  'ready_for_pickup', 'ready_for_delivery',
  'in_consolidation', 'assigned_to_trip',
  'in_transit', 'delivered', 'delivered_to_third_party',
  'received', 'logistic_closed', 'closed'
];
```

---

## Fase 6: Frontend

### 6a. `src/lib/constants.ts` — Nuevos labels

```typescript
ready_for_pickup: { label: "Listo para retiro", variant: "default" },
ready_for_delivery: { label: "Listo para entrega", variant: "default" },
in_consolidation: { label: "En consolidación", variant: "default" },
assigned_to_trip: { label: "Asignado a viaje", variant: "default" },
delivered_to_third_party: { label: "Entregado a tercero", variant: "default" },
```

### 6b. `src/components/solicitudes/SolicitudDetail.tsx` — Acciones dinámicas

Reemplazar el `STATUS_ACTIONS` estático por uno dinámico basado en `flow_type`:

**client_delivery:**
- `in_preparation`: "Listo para entrega" → `ready_for_delivery`
- `ready_for_delivery`: "Confirmar entrega a tercero" → `delivered_to_third_party`

**urban / interurban:**
- `in_preparation`: "Listo para retiro" → `ready_for_pickup`
- (transiciones posteriores las maneja el chofer o logística)

**interurban adicional:**
- `in_consolidation`: "Asignar a viaje" → `assigned_to_trip` (solo admin/supervisor/warehouse_operator)
- `assigned_to_trip`: "Iniciar tránsito" → `in_transit` (chofer/admin)

**Común:**
- `delivered`: "Confirmar recepción" → `received` (destination)
- `received`: "Cierre logístico" → `logistic_closed` (destination)
- `logistic_closed` (no reposición + admin): "Cierre administrativo" → setea `admin_closed_at` + `admin_closed_by`

**Sin `flow_type` (legacy):** mantener acciones actuales.

### 6c. `src/components/solicitudes/RequestProgressBar.tsx` — Pasos dinámicos

Recibir `flow_type` como prop. Renderizar según escenario:

- **client_delivery**: Pendiente → Preparación → Listo entrega → Entregado tercero → Cerrado (5 pasos)
- **urban**: Pendiente → Preparación → Listo retiro → Tránsito → Entregado → Recibido → Cierre log. → Cerrado (8 pasos)
- **interurban**: Pendiente → Preparación → Listo retiro → Consolidación → Asignado viaje → Tránsito → Entregado → Recibido → Cierre log. → Cerrado (10 pasos)
- **null (legacy)**: pasos actuales sin cambio

### 6d. `src/pages/Solicitudes.tsx` — Filtros actualizados

```typescript
STATUS_GROUPS = [
  { key: "pending", label: "Pendientes", statuses: ["pending"] },
  { key: "preparation", label: "En preparación", statuses: ["in_preparation", "ready_for_pickup", "ready_for_delivery"] },
  { key: "transit", label: "En tránsito / logística", statuses: ["in_consolidation", "assigned_to_trip", "in_transit", "delivered", "delivered_to_third_party"] },
  { key: "closed", label: "Cerrados", statuses: ["received", "logistic_closed", "closed", "rejected"] },
];
```

### 6e. `src/pages/Index.tsx` — Incluir nuevos estados en queries de pendientes

Agregar los nuevos estados activos a las consultas que alimentan la cola operativa.

---

## Fase 7: Validación Post-implementación

| Verificación | Método |
|-------------|--------|
| 65 pedidos existentes siguen funcionando | Query: todos con `flow_type IS NULL` mantienen acciones legacy |
| 20 fulfillments sin impacto | Query: todos siguen en `pending` |
| Triggers existentes no fallan con nuevos estados | Probar transición completa en cada escenario |
| `fn_driver_action` pickup diferencia urban/interurban | Test con fulfillment de cada tipo |
| `fn_validate_request_edit` bloquea en nuevos estados | Intentar editar ítem en `ready_for_pickup` |
| Fallback genera warning en `ai_anomalies` | Crear pedido con sucursal sin `logistic_group` |
| Auto-cierre `delivered_to_third_party → closed` funciona | Probar flujo cliente completo |
| BIMS intacto | bims-sync, bims-stock-live, bims-proxy sin cambios |
| RLS intacto | Policies no se modifican |

---

## Lo que NO se modifica

- Flujo de consultas de disponibilidad
- Integraciones BIMS (bims-sync, bims-stock-live, bims-proxy)
- RLS policies (operan sobre roles/sucursales, no estados)
- Tabla `fulfillment_orders` ni su enum `fulfillment_status`
- Triggers de alertas existentes (fn_auto_resolve_alerts, fn_preparation_time_alert, etc.)
- Tabla `diagnostic_logs`
- Módulo chofer (excepto lógica de pickup en fn_driver_action)

---

## Archivos impactados

| Archivo | Cambio |
|---------|--------|
| Migración SQL (nueva) | Enum, campos, datos logistic_group |
| `fn_transition_request_status` (SQL) | Flow_type calc, nuevas transiciones, validación consistencia |
| `fn_driver_action` (SQL) | Pickup diferenciado urban/interurban |
| `fn_check_request_closure` (SQL) | Auto-close para delivered_to_third_party |
| `fn_validate_request_edit` (SQL) | Nuevos estados bloqueados |
| `fn_recalculate_flow_type` (SQL nuevo) | Recalculo manual admin |
| `src/lib/constants.ts` | Labels nuevos estados |
| `src/components/solicitudes/SolicitudDetail.tsx` | STATUS_ACTIONS dinámico por flow_type |
| `src/components/solicitudes/RequestProgressBar.tsx` | Pasos dinámicos por flow_type |
| `src/pages/Solicitudes.tsx` | STATUS_GROUPS actualizados |
| `src/pages/Index.tsx` | Queries actualizadas |

