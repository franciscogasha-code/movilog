# Envío directo a otra sucursal (origen-push)

## Auditoría

**Alta existente reutilizable** — `src/components/solicitudes/AdminReposicionForm.tsx` ya crea exactamente el registro pedido: `source_branch_id`, `requesting_branch_id`, `request_type="reposition"`, `delivery_target="branch"`, `shipping_method="own_fleet"`, líneas con `item_purpose="reposition"`, carga manual (`ProductSearch`) o Excel (`ExcelImport`) y adjunto en storage. Hoy solo se muestra a admin/owner (`Solicitudes.tsx` ~línea 702).

**Estados** — `src/lib/request-status.ts` es la fuente única; no se duplica ni se modifica.

**Cómo entra un pedido a preparación (verificado en base)**:
- `branch_requests.status` tiene default `'pending'`. Ningún trigger fuerza `in_supply`: el abastecimiento es un paso *opt-in* que se dispara manualmente desde el detalle. O sea, crear el pedido no lo mete en `in_supply`.
- `fulfillment_orders` se crean **dentro** de `fn_transition_request_status` cuando el pedido llega a `in_preparation` (es la única función que inserta ahí). Por eso NO se puede insertar el pedido directo con `status='in_preparation'`: se saltearía la creación del fulfillment y los eventos operativos.
- `SolicitudDetail` ya encadena `pending → accepted → in_preparation` en una sola acción "Aceptar" vía RPC. La transición `pending→accepted` y `accepted→in_preparation` está permitida por la RPC.

**Permisos (verificados)**:
- RLS INSERT en `branch_requests`: `created_by = auth.uid()` → un `branch_operator` puede crear.
- RLS SELECT/UPDATE: `can_access_branch(...)` sobre origen o destino → el operador seguirá viendo su pedido.

## Plan

### 1. Nuevo componente `src/components/solicitudes/EnvioDirectoForm.tsx`
Basado en `AdminReposicionForm` (mismo patrón de líneas, Excel, adjunto, confirmación), con estas diferencias:
- **Origen fijo**: se toma `defaultBranchId` de `useUserBranchFilter()`; se muestra como campo de solo lectura (nombre + código). Si el usuario no tiene sucursal por defecto y tiene varias permitidas, se ofrece un selector limitado **solo** a `allowedBranchIds`; sin acceso a ninguna → mensaje y botón de crear deshabilitado.
- **Destino**: `BranchSelector` excluyendo el origen.
- **Campo nuevo "Solicitado por / medio"** (texto libre, obligatorio, máx. 120 chars).
- **Persistencia del campo**: se guarda en `notes` con prefijo estable `[Envío directo · Solicitado por: <texto>]` + notas libres debajo. Motivo: el cerco de alcance excluye cambios de esquema; el prefijo es parseable y ya existe precedente (`[Reposición administrativa]`). Si preferís columna propia (`instruction_source`), lo hago en una tanda aparte con migración + render en `SolicitudDetail`.
- **Post-insert**: tras crear el pedido y las líneas, se llama `fn_transition_request_status` dos veces (`accepted`, luego `in_preparation`), igual que la acción "Aceptar" del detalle. Así el pedido entra directo a preparación del lado del origen, se crea el `fulfillment_order` y se registran los eventos. Si la segunda transición falla, el pedido queda en `accepted` y se avisa por toast ("Pedido creado, avanzá a Preparación desde el detalle") — nunca se pierde el alta.
- Sin tocar `AdminReposicionForm.tsx` (queda intacto para admin/owner).

### 2. `src/pages/Solicitudes.tsx` (solo el bloque de botones del header)
- Agregar botón "Enviar a otra sucursal" visible para `branch_operator`, `branch_manager`, `admin`, `supervisor` y owner (oculto para viewer).
- Nuevo `Dialog` que monta `EnvioDirectoForm`, con `onSuccess` → cerrar + `refetch()`.
- El botón "Reposición admin." queda tal cual.

### 3. Sin cambios en
`request-status.ts`, RPCs, triggers, RLS, abastecimiento, cobranzas, pre-ventas, ruteo, chofer.

## Riesgos de regresión y mitigación

| Riesgo | Mitigación |
|---|---|
| Romper el alta admin | Componente nuevo separado; `AdminReposicionForm` no se toca. |
| Pedido creado pero sin avanzar (falla RPC) | Alta y transición desacopladas: el pedido queda en `pending`/`accepted` y el detalle permite avanzar manualmente. |
| Operador eligiendo origen ajeno | Origen limitado a `allowedBranchIds`; RLS + `can_access_branch` como segunda barrera. |
| Duplicar whitelists de estados | No se define ningún array local; solo se usan las transiciones vía RPC. |
| Pedido "empujado" confunde al destino | Prefijo visible en notas + badge implícito por `request_type=reposition`; el destino lo ve en su bandeja como entrada. |
| Excel/adjunto | Se reusa `ExcelImport` y el mismo bucket `request-attachments`, sin cambios. |

## Checklist de prueba (antes de declarar estable)
1. Operador de sucursal A: crear envío a B con 2 productos manuales → pedido queda **En preparación**, con fulfillment creado.
2. Mismo caso vía Excel + adjunto.
3. Origen no editable; destino no permite elegir A.
4. Sucursal B ve el pedido en su bandeja de entrada y puede completar recepción/cierre.
5. Admin/owner: "Reposición admin." sigue funcionando idéntico.
6. Ningún pedido nuevo aparece en `in_supply` ni en la cola de abastecimiento.
