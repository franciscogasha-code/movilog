

# Plan Final: Módulo de Planificación Logística con Ajustes Obligatorios

## Resumen

Transformar `/ruteo` en módulo operativo completo para logística, aplicando los 7 ajustes solicitados sobre el plan base ya aprobado.

---

## Estado actual verificado

- `fn_transition_request_status` (5-arg version) ya tiene:
  - Cálculo de `flow_type` correcto
  - Validación de `p_trip_id` para `assigned_to_trip`
  - UPDATE de `fulfillment_orders.trip_id` dentro del RPC (no directo)
  - Actor check: `assigned_to_trip` requiere `warehouse_operator` o admin
- `trips` table: no tiene `destination_description` ni `created_by` (hay que agregarlos)
- `trip_type` enum: solo `urban_cutoff`, `interurban_planned` (falta `supplier_pickup`)
- El chofer actualmente puede crear viajes interurbanos directamente (INSERT en `ViajeInterurbano.tsx`)
- La query de trips en `Chofer.tsx` NO filtra por `driver_id`

---

## Fase 1: Migración BD

Una sola migración:

```sql
ALTER TYPE trip_type ADD VALUE IF NOT EXISTS 'supplier_pickup';
ALTER TABLE trips ADD COLUMN destination_description text;
ALTER TABLE trips ADD COLUMN created_by uuid;
```

No se crean tablas nuevas. Todo sobre `trips`, `fulfillment_orders`, `branch_requests`.

---

## Fase 2: Ajuste al RPC `fn_transition_request_status`

**Ajuste 3 — Validación de flow_type en assigned_to_trip** (extensión controlada):

Agregar dentro del bloque `IF p_new_status = 'assigned_to_trip'` existente:

```sql
IF v_flow_type != 'interurban' THEN
  RAISE EXCEPTION 'Solo pedidos interurbanos pueden asignarse a viaje (flow_type actual: %)', COALESCE(v_flow_type, 'NULL');
END IF;
```

Esto bloquea urbanos, client_delivery y legacy. El resto del RPC no se toca.

---

## Fase 3: Reescribir `/ruteo` — 4 tabs

### Tab A: Consolidación

**Ajuste 1 — Fuente de verdad**: Query principal sobre `branch_requests`:

```sql
branch_requests WHERE status = 'in_consolidation'
  JOIN branches (source, requesting)
  JOIN fulfillment_orders (para obtener trip_id, package_count)
```

No usar `fulfillment_orders.status` como criterio. El filtro es `branch_requests.status = 'in_consolidation'`.

Muestra: agrupado por destino, con origen, documento BIMS, tipo de pedido, flow_type, fecha, prioridad SLA.

**Ajuste 2 — Asignación centralizada via RPC**: Al asignar cargas a viaje:

```typescript
// NO hacer UPDATE directo
// Sí: llamar al RPC por cada request seleccionado
await supabase.rpc("fn_transition_request_status", {
  p_request_id: requestId,
  p_new_status: "assigned_to_trip",
  p_trip_id: selectedTripId,
});
```

**Ajuste 3 — Validación**: Solo mostrar pedidos con `flow_type = 'interurban'` en la vista de consolidación. El RPC refuerza esto server-side.

Acciones:
- Checkbox multi-selección
- "Asignar a viaje existente" → selector de viajes `planned`
- "Crear viaje y asignar" → dialog de creación + asignación secuencial

### Tab B: Viajes Programados

Query: `trips WHERE status = 'planned'` + joins (vehicles, drivers, branches, count fulfillments).

Acciones:
- "Crear viaje" → Dialog: tipo (interurbano/retiro proveedor), chofer, vehículo, origen, fecha/hora, destino o descripción. **Ajuste 5**: `created_by = auth.uid()` al insertar.
- Click → Detalle (Tab C en sheet/dialog)
- "Cancelar viaje" (solo si `planned` y sin cargas)
- "Editar" (solo si `planned`)

### Tab C: Detalle del Viaje (Sheet)

Query: trip + fulfillments vinculados + branch_requests asociados.

Muestra: info viaje + lista de cargas con documento, origen, destino, estado.

Acciones:
- "Agregar carga" → selector de requests `in_consolidation` con `flow_type = 'interurban'`, ejecuta via RPC
- "Quitar carga" → desvincula: `UPDATE fulfillment_orders SET trip_id = null` + revertir request a `in_consolidation` via RPC (nueva transición `assigned_to_trip → in_consolidation` — se agrega al interurban flow del RPC)

### Tab D: En Curso

Query: `trips WHERE status = 'in_progress'` + fulfillments + drivers.

Solo lectura + monitoreo.

---

## Fase 4: Ajustes al chofer

### 4a. Restringir creación de viajes (Ajuste 4)

**`ViajeInterurbano.tsx`**: Reemplazar INSERT directo por:
- Mostrar viajes `planned` asignados al chofer (`driver_id = myDriver.id`)
- Botón "Iniciar viaje" que hace UPDATE `planned → in_progress` (ya existe esta lógica)
- Si no hay viajes planned: "No hay viajes programados"
- Mantener: finalizar viaje, agregar tarea emergente en ruta

**`CorteUrbano.tsx`**: Sin cambios (cortes urbanos son sesiones operativas, no planificación).

### 4b. Filtrar trips por driver (Ajuste 7)

**`Chofer.tsx` línea 72-84**: Agregar filtro por `driver_id`:

```typescript
// Necesita myDriver.id antes de esta query
.eq("driver_id", myDriverId)
```

El chofer solo ve sus viajes asignados.

---

## Fase 5: Retiros de proveedores

- Crear viaje con `trip_type = 'supplier_pickup'`
- `destination_description` almacena nombre/dirección del proveedor
- Se visualiza con badge diferenciado en listas
- El chofer lo inicia y ejecuta igual que un viaje interurbano
- No requiere fulfillments previos (puede no tener pedido interno asociado)

---

## Fase 6: Extensión controlada al RPC — Desasignación

Agregar una transición inversa al interurban flow:

```sql
(v_old_status = 'assigned_to_trip' AND p_new_status = 'in_consolidation')
```

Con permisos: `admin`, `supervisor`, `warehouse_operator`. Esto permite quitar cargas de un viaje desde el detalle.

Al ejecutar esta transición inversa, también limpiar `trip_id`:

```sql
IF v_old_status = 'assigned_to_trip' AND p_new_status = 'in_consolidation' THEN
  UPDATE fulfillment_orders SET trip_id = NULL, updated_at = now()
  WHERE branch_request_id = p_request_id;
END IF;
```

---

## Componentes nuevos

| Componente | Ubicación |
|-----------|-----------|
| `LogisticaConsolidacion.tsx` | `src/components/logistica/` |
| `LogisticaViajesProgramados.tsx` | `src/components/logistica/` |
| `LogisticaViajeDetalle.tsx` | `src/components/logistica/` |
| `LogisticaViajesEnCurso.tsx` | `src/components/logistica/` |
| `CrearViajeForm.tsx` | `src/components/logistica/` |

---

## Archivos impactados

| Archivo | Cambio |
|---------|--------|
| Migración SQL | `supplier_pickup` enum, `destination_description`, `created_by` en trips |
| Migración SQL | Extensión controlada a `fn_transition_request_status`: validación flow_type + desasignación |
| `src/pages/Ruteo.tsx` | Reescritura completa: 4 tabs |
| 5 componentes nuevos en `src/components/logistica/` | Consolidación, programados, detalle, en curso, crear viaje |
| `src/components/chofer/ViajeInterurbano.tsx` | Solo iniciar viajes planned asignados |
| `src/pages/Chofer.tsx` | Filtrar trips por `driver_id` |

## Lo que NO se toca

- `fn_driver_action` — sin cambios
- Panel operativo (`Index.tsx`) — sin cambios
- Tabs "Mis cargas", "Retiro", "Historial" del chofer — sin cambios
- `CorteUrbano.tsx` — sin cambios
- RLS, BIMS, eventos, backward compatibility — sin cambios
- `SolicitudDetail.tsx` — el selector de viaje ya funciona ahí

---

## Validación post-implementación (Ajuste 7)

| Check | Método |
|-------|--------|
| Consolidación muestra solo `branch_requests.status = 'in_consolidation'` | Verificar query |
| Asignación usa exclusivamente RPC, no UPDATE directo | Revisar código |
| Solo `flow_type = 'interurban'` permite asignación a viaje | Intentar asignar urbano → debe fallar |
| Chofer no puede crear viajes interurbanos | Verificar UI |
| Chofer solo ve sus viajes | Verificar query con filtro driver_id |
| `created_by` se completa al crear viaje | Verificar INSERT |
| Desasignación revierte a `in_consolidation` y limpia `trip_id` | Probar quitar carga de viaje |
| 65 pedidos legacy siguen funcionando | Query flow_type IS NULL |
| 20 fulfillments sin impacto | Verificar status |

