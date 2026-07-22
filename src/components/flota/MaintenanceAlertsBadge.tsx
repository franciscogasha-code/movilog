import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Wrench } from "lucide-react";

export function useMaintenanceAlerts(vehicleId: string, currentMileage: number) {
  return useQuery({
    queryKey: ["maintenance-alerts", vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicle_maintenance")
        .select("id, scheduled_date, scheduled_km, alert_km_threshold, alert_days_threshold, status")
        .eq("vehicle_id", vehicleId)
        .in("status", ["scheduled", "in_progress"]);
      if (error) throw error;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let overdue = 0;
      let upcoming = 0;
      for (const m of data ?? []) {
        const kmThr = m.alert_km_threshold ?? 500;
        const dayThr = m.alert_days_threshold ?? 7;
        let isOverdue = false;
        let isUpcoming = false;
        if (m.scheduled_date) {
          const d = new Date(m.scheduled_date);
          const diffDays = Math.floor((d.getTime() - today.getTime()) / 86400000);
          if (diffDays < 0) isOverdue = true;
          else if (diffDays <= dayThr) isUpcoming = true;
        }
        if (m.scheduled_km && currentMileage) {
          const diffKm = m.scheduled_km - currentMileage;
          if (diffKm < 0) isOverdue = true;
          else if (diffKm <= kmThr) isUpcoming = true;
        }
        if (isOverdue) overdue++;
        else if (isUpcoming) upcoming++;
      }
      return { overdue, upcoming };
    },
    enabled: !!vehicleId,
  });
}

export function MaintenanceAlertsBadge({ vehicleId, currentMileage }: { vehicleId: string; currentMileage: number }) {
  const { data } = useMaintenanceAlerts(vehicleId, currentMileage);
  if (!data || (data.overdue === 0 && data.upcoming === 0)) return null;
  if (data.overdue > 0) {
    return (
      <Badge variant="destructive" className="text-xs gap-1">
        <AlertTriangle className="h-3 w-3" /> Mantenimiento vencido
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs gap-1 border-secondary/40 text-secondary">
      <Wrench className="h-3 w-3" /> Próximo mant.
    </Badge>
  );
}
