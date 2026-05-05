
# Pre Venta Online — Plan v3 (final, aprobable)

Ajustes incorporados sobre v2: trigger simplificado, `original_request_type` eliminado, `seller_id` aclarado, PDF con timeout extendido y fallback progresivo, regresión de `'draft'` validada.

---

## A. Validación de regresión `status = 'draft'` ✅

Búsqueda ejecutada en todo el repo (`src/` + `supabase/`):
```
rg -n "'draft'|\"draft\"" → 0 resultados
```

- Ningún query, hook, dashboard, RPC ni RLS existente usa el literal `'draft'`.
- Las RPC operativas (`fn_transition_request_status`, `fn_driver_action`) tienen whitelist explícita de estados origen — `'draft'` no figura, así que cualquier intento de transición desde pre-venta es naturalmente rechazado.
- Los dashboards (`use-executive-dashboard`, `Index`, `Ruteo`) filtran por estados específicos (`pending`, `in_preparation`, etc.) o por flag `is_pre_sale=false` (nuevo helper). Cero contaminación.

**Conclusión**: agregar `'draft'` al enum es 100 % seguro y no rompe nada.

---

## B. Ajustes finales aplicados

### B.1 Trigger `fn_validate_pre_sale_coherence` simplificado
Sólo coherencia estructural en BD. Validación de cliente se hace en frontend (zod) + RPC `fn_send_presale_to_operation`.

```sql
CREATE OR REPLACE FUNCTION fn_validate_pre_sale_coherence()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_pre_sale THEN
    IF NEW.request_type <> 'pre_sale_online' THEN
      RAISE EXCEPTION 'Pre-venta requiere request_type=pre_sale_online (got %)', NEW.request_type;
    END IF;
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'Pre-venta requiere status=draft (got %)', NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END $$;
```

### B.2 `original_request_type` eliminado
No se agrega esa columna. La promoción setea directamente `request_type='online'` y `pre_sale_status='sent_to_operation'`, lo que ya da trazabilidad suficiente para esta fase.

### B.3 `seller_id` eliminado — se usa `created_by`
No hay diferencia funcional: el vendedor que crea la pre-venta es siempre el `auth.uid()`. Reusar `created_by` evita columna duplicada y mantiene consistencia con el resto de `branch_requests`. Si en fase 2 aparece la figura de "vendedor distinto del creador" se agrega entonces.

### B.4 Validación cliente: sólo frontend + RPC promoción
- **Frontend** (`SolicitudCreateForm` + `PreSaleClientForm`): zod valida `client_name` (≥2), `client_phone` (≥6), `client_email` opcional con formato, `client_address` obligatoria si `shipping_method ∈ {delivery, courier}`.
- **Backend** (RPC `fn_send_presale_to_operation`): re-valida nombre + teléfono + (dirección condicional) antes de promover. Si falla, no promueve y devuelve mensaje claro.
- **Trigger BD**: NO valida cliente (queda libre durante el borrador, donde el vendedor puede ir cargando datos por partes).

### B.5 PDF — timeout 3s + fallback progresivo
Helper `src/lib/pdf-image.ts`:
- `maxSize = 64px` lado mayor (resize canvas).
- Compresión `image/jpeg` calidad `0.6`.
- `timeout = 3000ms` por imagen (`Promise.race`).
- **Fallback progresivo**:
  1. Reintento único con calidad `0.4` y `timeout=2000ms`.
  2. Si falla, placeholder gris con `bims_code` como texto.
- Cache en memoria por sesión (`Map<bims_code, dataURL>`).
- Generación en paralelo con `Promise.allSettled` para que una imagen lenta no bloquee al resto.

---

## C. Modelo de datos final

```sql
-- Enums (aditivos)
ALTER TYPE request_type   ADD VALUE IF NOT EXISTS 'pre_sale_online';
ALTER TYPE request_status ADD VALUE IF NOT EXISTS 'draft';

-- Columnas
ALTER TABLE branch_requests
  ADD COLUMN is_pre_sale boolean NOT NULL DEFAULT false,
  ADD COLUMN pre_sale_status text NULL,        -- 'draft' | 'confirmed' | 'sent_to_operation'
  ADD COLUMN sales_channel  text NULL,         -- whatsapp | instagram | presencial | otro
  ADD COLUMN client_phone   text NULL,
  ADD COLUMN client_email   text NULL,
  ADD COLUMN pre_sale_confirmed_at      timestamptz NULL,
  ADD COLUMN pre_sale_sent_at           timestamptz NULL,
  ADD COLUMN pre_sale_pdf_generated_at  timestamptz NULL;

CREATE INDEX idx_branch_requests_pre_sale
  ON branch_requests(is_pre_sale, pre_sale_status)
  WHERE is_pre_sale = true;

-- Trigger coherencia (B.1)
CREATE TRIGGER trg_validate_pre_sale_coherence
  BEFORE INSERT OR UPDATE ON branch_requests
  FOR EACH ROW EXECUTE FUNCTION fn_validate_pre_sale_coherence();

-- Bloqueo fulfillment (con log en diagnostic_logs)
CREATE TRIGGER trg_block_fulfillment_presale
  BEFORE INSERT ON fulfillment_orders
  FOR EACH ROW EXECUTE FUNCTION fn_block_fulfillment_for_presale();
```

## D. RPC promoción a operación (UPDATE in-place)

```sql
CREATE OR REPLACE FUNCTION fn_send_presale_to_operation(p_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM branch_requests
   WHERE id = p_request_id AND is_pre_sale = true FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Pre-venta no encontrada o ya promovida'; END IF;
  IF r.created_by <> auth.uid()
     AND NOT (has_role(auth.uid(),'admin') OR is_owner(auth.uid())) THEN
    RAISE EXCEPTION 'Solo el creador o admin puede enviar a operación';
  END IF;

  -- Re-validación cliente
  IF COALESCE(r.client_name,'') = '' OR COALESCE(r.client_phone,'') = '' THEN
    RAISE EXCEPTION 'Falta nombre o teléfono del cliente';
  END IF;
  IF r.shipping_method IN ('delivery','courier')
     AND COALESCE(r.client_address,'') = '' THEN
    RAISE EXCEPTION 'Delivery/courier requiere dirección del cliente';
  END IF;

  -- UPDATE in-place: mismo id, mismo request_number
  UPDATE branch_requests
     SET is_pre_sale     = false,
         request_type    = 'online',
         status          = 'pending',
         pre_sale_status = 'sent_to_operation',
         pre_sale_sent_at = now(),
         updated_at       = now()
   WHERE id = p_request_id;
END $$;
```

## E. Centralización de queries (helper único)

`src/lib/branch-requests-query.ts`:
```ts
export const operationalRequests = () =>
  supabase.from("branch_requests").select("*").eq("is_pre_sale", false);
export const allRequests       = () => supabase.from("branch_requests");
export const preSaleRequests   = () =>
  supabase.from("branch_requests").select("*").eq("is_pre_sale", true);
```

Refactor de los 11 archivos operativos identificados; los 4 de Solicitudes/Admin usan `allRequests()` con su propio filtro UI. Se agrega regla ESLint `no-restricted-syntax` que bloquea `from("branch_requests")` fuera del helper.

## F. Frontend

- **`SolicitudCreateForm`**: opción "Pre Venta Online" → fija `request_type='pre_sale_online'`, `status='draft'`, abre `PreSaleClientForm` (zod).
- **`SolicitudDetail`**: si `is_pre_sale=true`, panel reducido: `Editar / Generar PDF / Cliente confirmó / Enviar a operación`.
- **`Solicitudes.tsx`**: chip "Pre-Ventas" + badge amarillo. Tabs operativos filtran por `is_pre_sale=false`.
- **`StatusBadge`**: variante para `pre_sale_status`.

## G. RLS

Política adicional única:
```sql
CREATE POLICY "Edit own pre-sale draft"
  ON branch_requests FOR UPDATE TO authenticated
  USING      (is_pre_sale = true AND created_by = auth.uid())
  WITH CHECK (is_pre_sale = true AND created_by = auth.uid());
```

## H. Matriz de regresión

| Escenario | Resultado | Verificación |
|-----------|-----------|--------------|
| Crear pre-venta | sólo en bandeja "Pre-Ventas" | helper excluye en Pedidos/Ruteo/Chofer/Dashboard |
| Editar pre-venta | persiste sin generar fulfillment | trigger bloqueo ok |
| Generar PDF | < 1 MB, < 5s mobile | timeout 3s + fallback |
| Promover a operación | mismo `id`, `request_number`, sin duplicar | RPC UPDATE in-place |
| Pedido normal reposición | flujo intacto | regresión cero |
| Forzar fulfillment sobre pre-venta | rechazado + `diagnostic_logs` | trigger fulfillment |
| Query operativa que olvide filtro | bloqueada en build | ESLint rule |
| Estado `'draft'` en queries existentes | invisible | grep `'draft'` = 0 hits |

## I. Archivos

**Nuevos**: migración SQL, `branch-requests-query.ts`, `pdf-image.ts`, `PreSaleClientForm.tsx`, `PreSalePDF.ts`, `PreSaleActions.tsx`, memoria `mem://negocio/pre-venta-online`.
**Editados**: 11 archivos operativos (sólo cambian la fuente de query) + `SolicitudCreateForm`, `SolicitudDetail`, `Solicitudes`, `StatusBadge`, `business-rules.ts` + regla ESLint.

## J. Fuera de alcance (fase 2)
Buscador clientes BIMS · tabla `customers` · datos fiscales · conversión a factura BIMS · `seller_id` separado de `created_by`.
