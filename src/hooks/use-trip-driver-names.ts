import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type TripLike = {
  id: string;
  driver_id?: string | null;
};

type TripDriverNameRow = {
  trip_id: string;
  driver_id: string | null;
  driver_user_id: string | null;
  driver_name: string;
};

export function tripDriverFingerprint(trips: TripLike[]) {
  return trips.map((trip) => `${trip.id}:${trip.driver_id ?? "null"}`).join("|");
}

export function useTripsWithDriverNames<TTrip extends TripLike>(
  trips: TTrip[],
  queryKeyPrefix: string,
) {
  const fingerprint = tripDriverFingerprint(trips);

  return useQuery({
    queryKey: [queryKeyPrefix, fingerprint],
    enabled: trips.length > 0,
    queryFn: async () => {
      const tripIds = trips.map((trip) => trip.id);
      const { data, error } = await supabase.rpc("fn_get_trip_driver_names" as any, {
        p_trip_ids: tripIds,
      });
      if (error) throw error;

      const byTripId = new Map(
        ((data ?? []) as TripDriverNameRow[]).map((row) => [row.trip_id, row]),
      );

      return trips.map((trip) => {
        const resolved = byTripId.get(trip.id);
        return {
          ...trip,
          driver_id: resolved?.driver_id ?? trip.driver_id ?? null,
          driver_user_id: resolved?.driver_user_id ?? null,
          driver_name: resolved?.driver_name || "Sin chofer",
        };
      });
    },
  });
}