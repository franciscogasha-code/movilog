-- ════════════════════════════════════════════════════════════════════
-- FASE 3 — Etapa "En abastecimiento" para pedidos desde Pre-Venta
-- ════════════════════════════════════════════════════════════════════
-- Migración consolidada M1-M6 del Volumen 3 aprobado.
--
-- ROLLBACK DOCUMENTADO (no destructivo — se aplica en orden inverso):
--   1) DROP FUNCTION fn_start_operation_from_supplied(jsonb);
--   2) DROP FUNCTION fn_confirm_local_supply(uuid);
--   3) DROP TRIGGER  trg_block_supply_transitions ON branch_requests;
--   4) DROP TRIGGER  trg_block_fulfillment_in_supply ON fulfillment_orders;
--   5) DROP FUNCTION fn_block_operations_in_supply();
--   6) DROP TRIGGER  trg_auto_promote_to_supplied ON branch_requests;
--   7) DROP FUNCTION fn_auto_promote_to_supplied();
--   8) Restaurar fn_send_presale_to_operation a su firma anterior
--      (snapshot guardado al inicio del archivo en comentario M2).
--   9) Los valores de enum 'in_supply' y 'supplied' NO pueden eliminarse
--      en Postgres; quedarían como huérfanos sin uso. Documentado.
--
-- IMPACTO CERO sobre flujo logístico existente:
--   - fn_transition_request_status no se modifica.
--   - Triggers existentes no se tocan.
--   - Estados nuevos quedan invisibles para queries logísticas
--     (frontend ya filtra vía operationalLogisticsRequests()).
-- ════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────
-- M1. Enum: agregar in_supply, supplied a request_status
-- ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'in_supply'
                 AND enumtypid = 'public.request_status'::regtype) THEN
    ALTER TYPE public.request_status ADD VALUE 'in_supply';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'supplied'
                 AND enumtypid = 'public.request_status'::regtype) THEN
    ALTER TYPE public.request_status ADD VALUE 'supplied';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────
-- Tolerancia de fn_autoset_flow_type cuando aún no hay logística
-- definida (in_supply / supplied). Sin esto, el trigger fallaría al
-- intentar derivar flow_type con source_branch_id NULL.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_autoset_flow_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.is_pre_sale, false) THEN RETURN NEW; END IF;

  -- En estados de abastecimiento aún no hay origen ni destino logístico;
  -- el flow_type se derivará al pasar a 'pending' vía fn_start_operation_from_supplied.
  IF NEW.status IN ('in_supply'::request_status, 'supplied'::request_status) THEN
    RETURN NEW;
  END IF;

  IF NEW.flow_type IS NULL THEN
    NEW.flow_type := public.fn_derive_flow_type(
      NEW.delivery_target::text,
      NEW.source_branch_id,
      NEW.requesting_branch_id
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- M2. fn_send_presale_to_operation — nueva firma reducida
--     Crea pedido en 'in_supply' SIN definir logística aún.
-- ────────────────────────────────────────────────────────────────────
-- Snapshot firma anterior (rollback):
--   fn_send_presale_to_operation(p_request_id uuid,
--                                p_requesting_branch_id uuid,
--                                p_source_branch_id uuid,
--                                p_delivery_target text,
--                                p_shipping_method text,
--                                p_operational_responsible_id uuid)
-- Eliminamos la firma anterior y creamos la nueva.
DROP FUNCTION IF EXISTS public.fn_send_presale_to_operation(uuid, uuid, uuid, text, text, uuid);

CREATE OR REPLACE FUNCTION public.fn_send_presale_to_operation(
  p_request_id uuid,
  p_requesting_branch_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_uid uuid := auth.uid();
  v_new_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  SELECT * INTO r FROM public.branch_requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF r.id IS NULL THEN
    RAISE EXCEPTION 'Pre-venta no encontrada';
  END IF;

  -- Idempotencia
  IF COALESCE(r.is_pre_sale,false) = true
     AND COALESCE(r.pre_sale_status,'') = 'converted'
     AND r.converted_to_request_id IS NOT NULL THEN
    RETURN r.converted_to_request_id;
  END IF;

  IF COALESCE(r.is_pre_sale,false) = false THEN
    -- Backwards compat: pre-venta legacy convertida in-place.
    RETURN r.id;
  END IF;

  -- Autorización
  IF r.created_by <> v_uid
     AND NOT (has_role(v_uid,'admin'::app_role) OR is_owner(v_uid)) THEN
    RAISE EXCEPTION 'Solo el creador o admin puede convertir esta pre-venta';
  END IF;

  IF p_requesting_branch_id IS NULL THEN
    RAISE EXCEPTION 'Debe seleccionar la sucursal ejecutora del pedido';
  END IF;

  IF COALESCE(r.client_name,'') = '' OR COALESCE(r.client_phone,'') = '' THEN
    RAISE EXCEPTION 'Falta nombre o teléfono del cliente';
  END IF;

  -- Crear pedido operativo en estado 'in_supply' (sin logística aún)
  INSERT INTO public.branch_requests (
    requesting_branch_id,
    source_branch_id,         -- NULL hasta "Iniciar operación"
    request_type,
    status,
    delivery_target,          -- NULL
    shipping_method,          -- NULL
    client_name,
    client_phone,
    client_email,
    client_address,
    sales_channel,
    notes,
    commercial_terms,
    is_pre_sale,
    created_from_presale_id,
    created_by
  ) VALUES (
    p_requesting_branch_id,
    NULL,
    'online'::request_type,
    'in_supply'::request_status,
    NULL,
    NULL,
    r.client_name,
    r.client_phone,
    r.client_email,
    r.client_address,
    r.sales_channel,
    r.notes,
    r.commercial_terms,
    false,
    p_request_id,
    v_uid
  ) RETURNING id INTO v_new_id;

  -- Clonar items
  INSERT INTO public.branch_request_items (
    request_id, product_id, quantity_requested, item_purpose,
    client_name, client_address, notes
  )
  SELECT
    v_new_id,
    product_id,
    quantity_requested,
    'client'::item_purpose,
    client_name,
    client_address,
    notes
  FROM public.branch_request_items
  WHERE request_id = p_request_id;

  -- Bloquear la pre-venta original
  UPDATE public.branch_requests
     SET pre_sale_status         = 'converted',
         converted_to_request_id = v_new_id,
         converted_at            = now(),
         converted_by_user_id    = v_uid,
         pre_sale_sent_at        = COALESCE(pre_sale_sent_at, now()),
         updated_at              = now()
   WHERE id = p_request_id;

  RETURN v_new_id;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- M3. fn_confirm_local_supply — caso 100% stock local sin pedidos hijos
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_confirm_local_supply(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_uid uuid := auth.uid();
  v_open_children integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  SELECT * INTO r FROM public.branch_requests WHERE id = p_request_id FOR UPDATE;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'Pedido no encontrado';
  END IF;

  IF r.status <> 'in_supply'::request_status THEN
    RAISE EXCEPTION 'Solo pedidos En abastecimiento pueden confirmarse localmente (estado actual: %)', r.status;
  END IF;

  -- Permitir solo creador, ejecutor (operador de la sucursal solicitante) o admin/owner
  IF NOT (
    r.created_by = v_uid
    OR has_role(v_uid,'admin'::app_role)
    OR is_owner(v_uid)
    OR EXISTS (SELECT 1 FROM public.profiles
                WHERE user_id = v_uid AND branch_id = r.requesting_branch_id)
  ) THEN
    RAISE EXCEPTION 'No autorizado para confirmar abastecimiento de este pedido';
  END IF;

  -- No deben existir pedidos hijos abiertos (defensa: caso A es 100% local)
  SELECT COUNT(*) INTO v_open_children
    FROM public.branch_requests
   WHERE parent_request_id = p_request_id
     AND status NOT IN ('received'::request_status,
                        'logistic_closed'::request_status,
                        'closed'::request_status,
                        'rejected'::request_status);
  IF v_open_children > 0 THEN
    RAISE EXCEPTION 'Existen % pedidos internos abiertos; no se puede confirmar abastecimiento local.', v_open_children;
  END IF;

  -- Promover a supplied (vía bypass de bloqueo)
  PERFORM set_config('movilog.supply_internal','on', true);
  UPDATE public.branch_requests
     SET status = 'supplied'::request_status,
         updated_at = now()
   WHERE id = p_request_id;
  PERFORM set_config('movilog.supply_internal','off', true);

  RETURN jsonb_build_object('request_id', p_request_id, 'status', 'supplied');
END;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- M4. fn_start_operation_from_supplied — recibe payload logístico completo
--     Replica los campos del SolicitudCreateForm.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_start_operation_from_supplied(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_uid uuid := auth.uid();
  v_request_id uuid;
  v_target delivery_target;
  v_method shipping_method;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  v_request_id := (p_payload->>'request_id')::uuid;
  IF v_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id es requerido';
  END IF;

  SELECT * INTO r FROM public.branch_requests WHERE id = v_request_id FOR UPDATE;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'Pedido no encontrado';
  END IF;

  IF r.status <> 'supplied'::request_status THEN
    RAISE EXCEPTION 'Solo pedidos Abastecidos pueden pasar a operación (estado actual: %)', r.status;
  END IF;

  IF NOT (
    r.created_by = v_uid
    OR has_role(v_uid,'admin'::app_role)
    OR is_owner(v_uid)
    OR EXISTS (SELECT 1 FROM public.profiles
                WHERE user_id = v_uid AND branch_id = r.requesting_branch_id)
  ) THEN
    RAISE EXCEPTION 'No autorizado para iniciar operación de este pedido';
  END IF;

  IF (p_payload->>'delivery_target') IS NULL OR (p_payload->>'shipping_method') IS NULL THEN
    RAISE EXCEPTION 'Debe seleccionar destino y método de entrega';
  END IF;

  v_target := (p_payload->>'delivery_target')::delivery_target;
  v_method := (p_payload->>'shipping_method')::shipping_method;

  IF v_target = 'client'
     AND v_method IN ('delivery','courier')
     AND COALESCE((p_payload->>'client_address'), r.client_address, '') = '' THEN
    RAISE EXCEPTION 'Delivery/encomienda a cliente requiere dirección';
  END IF;

  -- Bypass del trigger de bloqueo para esta transición controlada.
  PERFORM set_config('movilog.supply_internal','on', true);

  UPDATE public.branch_requests
     SET status                       = 'pending'::request_status,
         source_branch_id             = r.requesting_branch_id,  -- ejecutora abastece
         delivery_target              = v_target,
         shipping_method              = v_method,
         delivery_payer               = NULLIF(p_payload->>'delivery_payer','')::delivery_payer,
         shipping_cost                = NULLIF(p_payload->>'shipping_cost','')::numeric,
         shipping_origin_paid         = COALESCE(NULLIF(p_payload->>'shipping_origin_paid','')::numeric, 0),
         shipping_destination_paid    = COALESCE(NULLIF(p_payload->>'shipping_destination_paid','')::numeric, 0),
         courier_billing_mode         = NULLIF(p_payload->>'courier_billing_mode','')::courier_billing_mode,
         client_address               = COALESCE(NULLIF(p_payload->>'client_address',''), r.client_address),
         notes                        = COALESCE(NULLIF(p_payload->>'notes',''), r.notes),
         operational_responsible_id   = NULLIF(p_payload->>'operational_responsible_id','')::uuid,
         flow_type                    = public.fn_derive_flow_type(v_target::text, r.requesting_branch_id, r.requesting_branch_id),
         updated_at                   = now()
   WHERE id = v_request_id;

  PERFORM set_config('movilog.supply_internal','off', true);

  RETURN jsonb_build_object('request_id', v_request_id, 'status', 'pending');
END;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- M5. fn_auto_promote_to_supplied — AFTER UPDATE en branch_requests
--     Cuando un pedido hijo (parent en in_supply) se cierra, recalcula
--     cobertura del padre y, si está completa, promueve a 'supplied'.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_auto_promote_to_supplied()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_parent_id uuid;
  v_parent_status request_status;
  v_open_children integer;
BEGIN
  -- Solo nos interesa cuando un hijo cambia de estado (o al insertarse cerrado)
  IF NEW.parent_request_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('received'::request_status,
                        'logistic_closed'::request_status,
                        'closed'::request_status) THEN
    RETURN NEW;
  END IF;

  v_parent_id := NEW.parent_request_id;

  SELECT status INTO v_parent_status
    FROM public.branch_requests WHERE id = v_parent_id;

  IF v_parent_status <> 'in_supply'::request_status THEN
    RETURN NEW;
  END IF;

  -- ¿Quedan hijos abiertos?
  SELECT COUNT(*) INTO v_open_children
    FROM public.branch_requests
   WHERE parent_request_id = v_parent_id
     AND status NOT IN ('received'::request_status,
                        'logistic_closed'::request_status,
                        'closed'::request_status,
                        'rejected'::request_status);

  IF v_open_children = 0 THEN
    PERFORM set_config('movilog.supply_internal','on', true);
    UPDATE public.branch_requests
       SET status = 'supplied'::request_status, updated_at = now()
     WHERE id = v_parent_id;
    PERFORM set_config('movilog.supply_internal','off', true);
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_auto_promote_to_supplied ON public.branch_requests;
CREATE TRIGGER trg_auto_promote_to_supplied
  AFTER UPDATE OF status ON public.branch_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_auto_promote_to_supplied();

-- ────────────────────────────────────────────────────────────────────
-- M6. fn_block_operations_in_supply — bloqueos defensivos
--   a) BEFORE INSERT en fulfillment_orders: rechaza si el pedido está
--      en 'in_supply' o 'supplied'.
--   b) BEFORE UPDATE en branch_requests: rechaza salir/entrar de
--      'in_supply'/'supplied' salvo que la sesión declare bypass
--      (movilog.supply_internal='on'), usado solo por las RPCs M3/M4
--      y el trigger M5.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_block_fulfillment_in_supply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_status request_status;
BEGIN
  SELECT status INTO v_status
    FROM public.branch_requests WHERE id = NEW.branch_request_id;
  IF v_status IN ('in_supply'::request_status, 'supplied'::request_status) THEN
    RAISE EXCEPTION 'No se puede crear fulfillment para un pedido en abastecimiento (status=%)', v_status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_block_fulfillment_in_supply ON public.fulfillment_orders;
CREATE TRIGGER trg_block_fulfillment_in_supply
  BEFORE INSERT ON public.fulfillment_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_block_fulfillment_in_supply();

CREATE OR REPLACE FUNCTION public.fn_block_supply_transitions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bypass text;
BEGIN
  v_bypass := current_setting('movilog.supply_internal', true);
  IF v_bypass = 'on' THEN
    RETURN NEW;
  END IF;

  -- Bloquear cualquier transición que entre o salga de in_supply/supplied
  -- por canales no autorizados.
  IF (OLD.status IN ('in_supply'::request_status, 'supplied'::request_status)
      AND NEW.status IS DISTINCT FROM OLD.status)
  OR (NEW.status IN ('in_supply'::request_status, 'supplied'::request_status)
      AND NEW.status IS DISTINCT FROM OLD.status) THEN
    RAISE EXCEPTION 'Las transiciones de/hacia % solo se realizan vía RPCs dedicadas (fn_send_presale_to_operation, fn_confirm_local_supply, fn_start_operation_from_supplied) o el trigger de auto-promoción.', NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Mientras esté en in_supply/supplied, no permitir editar source_branch_id,
  -- requesting_branch_id, custodia o ubicación (no aplica aquí pero protege).
  IF OLD.status IN ('in_supply'::request_status, 'supplied'::request_status) THEN
    IF NEW.requesting_branch_id IS DISTINCT FROM OLD.requesting_branch_id
    OR NEW.source_branch_id     IS DISTINCT FROM OLD.source_branch_id THEN
      RAISE EXCEPTION 'No se permite cambiar sucursales mientras el pedido esté en abastecimiento'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_block_supply_transitions ON public.branch_requests;
CREATE TRIGGER trg_block_supply_transitions
  BEFORE UPDATE ON public.branch_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_block_supply_transitions();