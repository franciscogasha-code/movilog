

# Plan: Evolución del Panel Operativo — Cola Unificada con Tareas Logísticas

## Resumen

Extender `src/pages/Index.tsx` para integrar tareas de fulfillment (preparar, despachar, retirar, en tránsito, recepcionar, entregar) como un tercer tipo de ítem en la cola existente, sin modificar la lógica actual de pedidos y consultas.

## Archivo a modificar

**`src/pages/Index.tsx`** — único archivo.

---

## Cambios técnicos

### 1. Tipos extendidos

```typescript
type ItemType = "pedido" | "consulta" | "tarea";
type TaskKind = "preparar" | "despachar" | "retirar" | "en_transito" | "recepcionar" | "entregar";
type TypeFilter = "all" | "pedido" | "consulta" | "preparacion" | "transporte" | "recepcion";
```

`QueueItem` gana campo opcional `taskKind?: TaskKind`.

### 2. Query de fulfillments ampliada

Reemplazar la query actual `activeFulfillments` (que solo trae `id, status, source_branch_id, destination_branch_id`) por una completa:

```typescript
supabase.from("fulfillment_orders").select(`
  id, status, source_branch_id, destination_branch_id,
  current_custody_holder_id, created_at, updated_at,
  branch_request:branch_requests!fulfillment_orders_branch_request_id_fkey(
    request_number, request_type
  ),
  source_branch:branches!fulfillment_orders_source_branch_id_fkey(name),
  destination_branch:branches!fulfillment_orders_destination_branch_id_fkey(name)
`)
.not("status", "in", '("completed","cancelled","received","logistic_closed")')
```

### 3. Lógica de contexto automático

Para cada fulfillment, determinar `taskKind` basado en:
- **Usuario es origen** (`can_access_branch` via `allowedBranchIds` o `isAllBranches`):
  - `pending`/`picking` → `preparar`
  - `waiting_for_cut`/`waiting_for_courier` → `despachar`
- **Usuario es custodio** (`current_custody_holder_id === user.id`):
  - `dispatched`/`at_hub` → `retirar`
  - `in_transit` → `en_transito`
  - `delivery_failed` → `entregar`
- **Usuario es destino**:
  - `delivered`/`pending_physical_confirmation` → `recepcionar`
- **Admin/Owner/Supervisor**: ven todo, con `taskKind` basado en estado puro

Filtro obligatorio: `source_branch_id !== destination_branch_id`.
Si el usuario no participa, no se muestra (excepto admin/owner/supervisor).

### 4. Integración en la cola unificada

Los fulfillments mapeados se agregan al array `queueItems` como `itemType: "tarea"` con su `taskKind`. Se ordenan junto con pedidos y consultas por **prioridad → antigüedad**.

### 5. Badges visuales por taskKind

| taskKind | Ícono | Label | Estilo |
|----------|-------|-------|--------|
| preparar | Package (📦) | Preparar | `bg-blue-500/10 text-blue-600` |
| despachar | ArrowUpFromLine (📤) | Despachar | `bg-indigo-500/10 text-indigo-600` |
| retirar | Truck (🚚) | Retirar | `bg-orange-500/10 text-orange-600` |
| en_transito | Truck (🚛) | En tránsito | `bg-amber-500/10 text-amber-600` |
| recepcionar | PackageCheck (📥) | Recepcionar | `bg-teal-500/10 text-teal-600` |
| entregar | MapPin (📍) | Entregar | `bg-green-500/10 text-green-600` |

Se agregan imports: `Truck`, `ArrowUpFromLine`, `MapPin` de lucide-react.

### 6. Filtros extendidos

Tabs pasan de 3 a 6:

```
Todos | Pedidos | Consultas | Preparación | Transporte | Recepción
```

Donde:
- **Preparación** = `preparar` + `despachar`
- **Transporte** = `retirar` + `en_transito` + `entregar`
- **Recepción** = `recepcionar`

Combinables con KPIs existentes.

### 7. Acciones contextuales

| taskKind | Acción | Navegación |
|----------|--------|-----------|
| preparar | "Preparar" | `/solicitudes?detail={request_id}` |
| despachar | "Despachar" | `/solicitudes?detail={request_id}` |
| retirar | "Retirar" | `/chofer` |
| en_transito | "Continuar viaje" | `/chofer` |
| recepcionar | "Recepcionar" | `/recepcion` |
| entregar | "Reintentar" | `/chofer` |

Pedidos y consultas mantienen sus acciones actuales sin cambios.

### 8. KPIs actualizados

Los conteos de KPIs incluyen tareas:
- **Atrasados**: pedidos + consultas + tareas con prioridad overdue/critical
- **Urgentes hoy**: ídem con prioridad today
- **En curso**: total de la cola unificada
- **Pend. recepción**: solo tareas con `taskKind === "recepcionar"`

### 9. Sin cambios

- Lógica de pedidos y consultas intacta
- Prioridad y orden existentes intactos
- Quick actions intactas
- Diseño de fila en 3 zonas intacto
- Backend no se toca

