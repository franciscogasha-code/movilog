import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export type DriverActionName =
  | "pickup"
  | "pickup_from_hub"
  | "drop_at_hub"
  | "deliver_branch"
  | "deliver_customer"
  | "delivery_failed"
  | "transfer_to_driver";

type RunDriverActionParams = {
  action: DriverActionName;
  fulfillmentId: string;
  tripId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function runDriverAction({
  action,
  fulfillmentId,
  tripId = null,
  metadata = {},
}: RunDriverActionParams) {
  return supabase.rpc("fn_driver_action", {
    p_action: action,
    p_fulfillment_id: fulfillmentId,
    p_trip_id: tripId,
    p_metadata: metadata as Json,
  });
}