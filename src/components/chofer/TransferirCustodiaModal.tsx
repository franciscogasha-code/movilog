import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { User, Truck } from "lucide-react";
import { toast } from "sonner";
import { runDriverAction } from "@/lib/driver-actions";

interface Props {
  fulfillmentId: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function TransferirCustodiaModal({ fulfillmentId, open, onClose, onSuccess }: Props) {
  const { user } = useAuth();
  const [selectedDriverUserId, setSelectedDriverUserId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: drivers } = useQuery({
    queryKey: ["active-drivers-for-transfer"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drivers")
        .select(`
          id, user_id, is_active,
          assigned_branch:branches!drivers_assigned_branch_id_fkey(name, code),
          profile:profiles!drivers_user_id_fkey(full_name)
        `)
        .eq("is_active", true)
        .neq("user_id", user?.id || "");
      if (error) throw error;
      return data;
    },
    enabled: open && !!user?.id,
  });

  const handleTransfer = async () => {
    if (!selectedDriverUserId) {
      toast.error("Seleccioná un chofer");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await runDriverAction({
        action: "transfer_to_driver",
        fulfillmentId,
        metadata: {
          target_user_id: selectedDriverUserId,
          reason: reason || null,
        },
      });

      if (error) throw error;

      const result = data as any;
      if (result?.success) {
        toast.success("Custodia transferida");
        onSuccess();
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Transferir custodia</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Seleccionar chofer *</Label>
            <div className="space-y-2 max-h-[40vh] overflow-y-auto">
              {!drivers?.length ? (
                <p className="text-sm text-muted-foreground p-3">No hay otros choferes activos</p>
              ) : (
                drivers.map((d: any) => (
                  <div
                    key={d.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedDriverUserId === d.user_id
                        ? "border-primary/40 bg-primary/5"
                        : "border-border hover:bg-muted/20"
                    }`}
                    onClick={() => setSelectedDriverUserId(d.user_id)}
                  >
                    <div className="bg-muted p-2 rounded-full">
                      <User className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-sm">{(d as any).profile?.full_name || "Chofer"}</p>
                      <p className="text-xs text-muted-foreground">{(d as any).assigned_branch?.code || "—"}</p>
                    </div>
                    {selectedDriverUserId === d.user_id && (
                      <Badge className="text-xs">Seleccionado</Badge>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Motivo (opcional)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Razón de la transferencia..."
              rows={2}
            />
          </div>

          <Button
            onClick={handleTransfer}
            disabled={submitting || !selectedDriverUserId}
            className="w-full"
          >
            {submitting ? "Transfiriendo..." : "Confirmar transferencia"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
