import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Route, Clock, AlertTriangle, Flag } from "lucide-react";
import { CloseTripModal } from "./CloseTripModal";

interface OpenTripsSectionProps {
  asModal?: boolean;
  modalOpen?: boolean;
  onModalOpenChange?: (o: boolean) => void;
}

export function OpenTripsSection({
  asModal = false,
  modalOpen = false,
  onModalOpenChange,
}: OpenTripsSectionProps) {
  const { user, isOwner, hasRole } = useAuth();
  const isPrivileged = isOwner || hasRole("admin") || hasRole("supervisor");

  const [closingTrip, setClosingTrip] = useState<any>(null);

  const { data: trips } = useQuery({
    queryKey: ["vehicle-open-trips"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicle_usages")
        .select(`
          id, vehicle_id, start_mileage, started_at, destination,
          driver_id, driver_name_text,
          vehicle:vehicles(plate, nickname),
          category:vehicle_usage_categories(name),
          driver:drivers(user_id, profile:profiles!drivers_user_id_fkey(full_name))
        `)
        .eq("status", "open")
        .order("started_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    refetchInterval: 60_000,
  });

  const tripRows = (trips || []).map((t: any) => {
    const startedAt = new Date(t.started_at);
    const hours = (Date.now() - startedAt.getTime()) / 3_600_000;
    const overdue = hours > 24;
    const driverUserId = t.driver?.user_id;
    const canClose = isPrivileged || (driverUserId && driverUserId === user?.id);

    return (
      <div key={t.id} className="p-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-sm">{t.vehicle?.plate}</span>
            {t.category?.name && <Badge variant="outline" className="text-xs">{t.category.name}</Badge>}
            {overdue && (
              <Badge variant="destructive" className="text-xs gap-1">
                <AlertTriangle className="h-3 w-3" /> +24h
              </Badge>
            )}
          </div>
          {t.destination && <p className="text-sm mt-0.5">{t.destination}</p>}
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {t.driver?.profile?.full_name || t.driver_name_text || "—"} ·
            inicio {startedAt.toLocaleString("es-PY")} · km {t.start_mileage?.toLocaleString("de-DE")}
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setClosingTrip(t)}
          disabled={!canClose}
          title={canClose ? "" : "Solo el chofer del viaje o un admin/supervisor puede cerrarlo"}
        >
          Terminar viaje
        </Button>
      </div>
    );
  });

  const emptyState = (
    <div className="p-8 text-center text-muted-foreground text-sm">
      No hay viajes en curso
    </div>
  );

  const sectionContent = (
    <>
      {trips?.length ? (
        <div className="divide-y divide-border/50">{tripRows}</div>
      ) : (
        emptyState
      )}
      <CloseTripModal
        open={!!closingTrip}
        onOpenChange={(o) => { if (!o) setClosingTrip(null); }}
        trip={closingTrip}
      />
    </>
  );

  if (asModal) {
    return (
      <Dialog open={modalOpen} onOpenChange={onModalOpenChange}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <Flag className="h-5 w-5 text-primary" /> Viajes en curso
              {trips?.length ? <span className="text-sm font-normal text-muted-foreground">({trips.length})</span> : null}
            </DialogTitle>
          </DialogHeader>
          <div className="rounded-md border border-border/50">
            {sectionContent}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onModalOpenChange?.(false)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (!trips?.length) return null;

  return (
    <Card className="glass-card border-primary/30">
      <CardHeader className="pb-2">
        <CardTitle className="font-display text-sm flex items-center gap-2 text-primary">
          <Route className="h-4 w-4" /> Viajes en curso ({trips.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-border/50 p-0">
        {sectionContent}
      </CardContent>
    </Card>
  );
}

