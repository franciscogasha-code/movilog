

# Plan revisado: Ajuste Área Online — Pedido Online

## Resumen

Extender "Pedido online" para permitir venta directa (origen = solicitante cuando destino es cliente), agregar campo opcional de responsable operativo, y mostrar pedidos asignados en la cola del responsable. Sin alterar flujos existentes.

---

## 1. Migración de base de datos

### a) Columna `operational_responsible_id`

```sql
ALTER TABLE public.branch_requests
  ADD COLUMN operational_responsible_id uuid REFERENCES auth.users(id) DEFAULT NULL;
```

### b) Trigger `fn_validate_different_branches` — AJUSTE CONTROLADO

Solo se permite la excepción cuando las tres condiciones se cumplen simultáneamente:

```sql
CREATE OR REPLACE FUNCTION public.fn_validate_different_branches()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.notes IS NOT NULL AND NEW.notes LIKE '%[Pedido padre multi-origen]%' THEN
    RETURN NEW;
  END IF;

  -- Allow online + client ONLY when origin = requester (direct sale)
  IF NEW.request_type = 'online'
     AND NEW.delivery_target = 'client'
     AND NEW.source_branch_id = NEW.requesting_branch_id THEN
    RETURN NEW;
  END IF;

  IF NEW.source_branch_id = NEW.requesting_branch_id THEN
    RAISE EXCEPTION 'La sucursal origen no puede ser igual a la sucursal solicitante';
  END IF;
  RETURN NEW;
END;
$$;
```

Esto garantiza que todas las demás validaciones siguen intactas; solo se omite el bloqueo de misma sucursal en el caso exacto de venta directa online.

---

## 2. Frontend — `SolicitudCreateForm.tsx`

### a) Variable `isSameBranch` (línea 255)

```ts
const isSameBranch = !isMultiOrigin && !!sourceBranchId && sourceBranchId === requestingBranchId
  && !(requestType === "online" && deliveryTarget === "client");
```

### b) Estado y selector de responsable operativo

- Agregar estado `operationalResponsibleId`.
- Mostrar selector **solo si** `requestType === "online"`.
- El selector lista únicamente perfiles activos con roles operativos válidos (`operador_logistico`, `supervisor`, `warehouse_operator`). Se consultan `profiles` + `user_roles` filtrando por estos roles.
- Campo opcional, no bloquea envío.

### c) Persistencia en `onSubmit`

Incluir `operational_responsible_id` en el insert de `branch_requests` (solo si tiene valor), tanto en flujo mono como multi-origen.

---

## 3. Frontend — `SolicitudDetail.tsx`

Mostrar el responsable operativo asignado en el detalle del pedido. Se agrega el campo `operational_responsible_id` a la query existente y se resuelve el nombre con un join a `profiles`.

---

## 4. Frontend — `Index.tsx` (Cola operativa) — AJUSTE CONTROLADO

La condición `operational_responsible_id` se incorpora **como extensión** dentro del `.or(...)` existente (línea 196-198), sin reemplazar ni eliminar condiciones actuales:

```ts
if (!isAllBranches && allowedBranchIds.length > 0) {
  query = query.or(
    `requesting_branch_id.in.(${allowedBranchIds.join(",")}),source_branch_id.in.(${allowedBranchIds.join(",")}),operational_responsible_id.eq.${user?.id}`
  );
}
```

Esto mantiene toda la visibilidad actual intacta y solo agrega la posibilidad de ver pedidos asignados al usuario.

---

## Archivos afectados

| Archivo | Cambio |
|---|---|
| Migración SQL | Agregar columna + modificar trigger (controlado) |
| `SolicitudCreateForm.tsx` | Excepción `isSameBranch`, selector filtrado por rol, persistencia |
| `SolicitudDetail.tsx` | Mostrar responsable operativo |
| `Index.tsx` | Extensión del `.or(...)` existente |

## Lo que NO se toca

- Flujos existentes de reposición, cliente, transferencias
- Lógica de stock
- Validaciones fuera del caso específico (online + client + misma sucursal)
- No se crean nuevos estados ni módulos
- No se impactan otros módulos (chofer, recepción, distribución, etc.)

