import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Printer, Tag, Plus, Search, CheckCircle2 } from "lucide-react";
import { PrintLabelsButton } from "@/components/etiquetas/LabelPDF";
import { toast } from "sonner";
import { branchName } from "@/lib/branch-format";

export default function Etiquetas() {
  const [search, setSearch] = useState("");
  const [createForId, setCreateForId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: fulfillments, isLoading } = useQuery({
    queryKey: ["fulfillments-for-labels"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fulfillment_orders")
        .select(`
          *,
          source_branch:branches!fulfillment_orders_source_branch_id_fkey(name, code, phone),
          destination_branch:branches!fulfillment_orders_destination_branch_id_fkey(name, code),
          branch_request:branch_requests(request_number, request_type, delivery_target, client_name, client_address)
        `)
        .not("status", "in", '("cancelled")')
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data?.filter((f: any) =>
        f.branch_request?.delivery_target === "client" ||
        f.shipping_method === "courier" ||
        (f.package_count && f.package_count > 0)
      );
    },
  });

  const { data: packages } = useQuery({
    queryKey: ["shipment-packages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shipment_packages")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const packagesByFulfillment = packages?.reduce((acc: Record<string, any[]>, p) => {
    if (!acc[p.fulfillment_order_id]) acc[p.fulfillment_order_id] = [];
    acc[p.fulfillment_order_id].push(p);
    return acc;
  }, {}) || {};

  const filtered = fulfillments?.filter((f: any) => {
    if (!search) return true;
    const term = search.toLowerCase();
    const num = f.branch_request?.request_number?.toString() || "";
    return num.includes(term) ||
      branchName(f.source_branch).toLowerCase().includes(term) ||
      f.destination_client_name?.toLowerCase().includes(term) ||
      f.branch_request?.client_name?.toLowerCase().includes(term);
  });

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Etiquetas y Bultos</h1>
        <p className="text-muted-foreground mt-1">Gestión de etiquetas para envíos a clientes y encomiendas</p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar por pedido o destino..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <Card className="glass-card">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Cargando...</div>
          ) : !filtered?.length ? (
            <div className="p-8 text-center text-muted-foreground">
              <Tag className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No hay envíos que requieran etiquetas</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left p-3 font-medium text-muted-foreground">Pedido</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Origen</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Destino</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Bultos</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Etiquetas</th>
                    <th className="text-left p-3 font-medium text-muted-foreground"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((f: any) => {
                    const pkgs = packagesByFulfillment[f.id] || [];
                    const printed = pkgs.filter((p: any) => p.label_printed).length;
                    const firstCreated = pkgs.length > 0 ? pkgs[pkgs.length - 1].created_at : null;
                    return (
                      <tr key={f.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                        <td className="p-3 font-mono font-semibold">#{f.branch_request?.request_number || "—"}</td>
                        <td className="p-3">{branchName(f.source_branch)}</td>
                        <td className="p-3">
                          {f.destination_client_name || f.branch_request?.client_name || branchName(f.destination_branch)}
                        </td>
                        <td className="p-3">
                          <Badge variant="secondary" className="text-xs">{f.package_count || 0}</Badge>
                        </td>
                        <td className="p-3">
                          {pkgs.length > 0 ? (
                            <div>
                              <div className="flex items-center gap-1.5">
                                <CheckCircle2 className="h-3 w-3 text-accent" />
                                <span className="text-xs font-medium">{pkgs.length} creada{pkgs.length > 1 ? "s" : ""}</span>
                                <span className="text-xs text-muted-foreground">({printed} impresa{printed !== 1 ? "s" : ""})</span>
                              </div>
                              {firstCreated && (
                                <span className="text-xs text-muted-foreground">
                                  {new Date(firstCreated).toLocaleString("es-PY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">Sin crear</span>
                          )}
                        </td>
                        <td className="p-3">
                          <div className="flex gap-1">
                            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setCreateForId(f.id)}>
                              <Plus className="h-3 w-3" /> {pkgs.length > 0 ? "Agregar" : "Crear"}
                            </Button>
                            {pkgs.length > 0 && (
                              <PrintLabelsButton packages={pkgs} />
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!createForId} onOpenChange={(o) => !o && setCreateForId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Crear Etiquetas</DialogTitle>
          </DialogHeader>
          {createForId && (
            <LabelForm
              fulfillmentId={createForId}
              onSuccess={() => {
                setCreateForId(null);
                queryClient.invalidateQueries({ queryKey: ["shipment-packages"] });
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

function LabelForm({ fulfillmentId, onSuccess }: { fulfillmentId: string; onSuccess: () => void }) {
  const [count, setCount] = useState(1);
  const [recipientName, setRecipientName] = useState("");
  const [destination, setDestination] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: fulfillment } = useQuery({
    queryKey: ["fulfillment-for-label", fulfillmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fulfillment_orders")
        .select(`
          *,
          source_branch:branches!fulfillment_orders_source_branch_id_fkey(name, code, phone),
          branch_request:branch_requests(client_name, client_address, delivery_target)
        `)
        .eq("id", fulfillmentId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (count < 1) { toast.error("Cantidad inválida"); return; }
    setSubmitting(true);
    try {
      const f = fulfillment as any;
      const labels = Array.from({ length: count }, (_, i) => ({
        fulfillment_order_id: fulfillmentId,
        package_number: i + 1,
        label_type: (f?.branch_request?.delivery_target === "client" ? "client_delivery" : "inter_branch") as any,
        recipient_name: recipientName || f?.destination_client_name || f?.branch_request?.client_name || "",
        destination_description: destination || f?.destination_client_address || f?.branch_request?.client_address || "",
        contact_phone: contactPhone || f?.source_branch?.phone || "",
        sending_branch_code: f?.source_branch?.code || "",
        transfer_reference: f?.bims_transfer_number || "",
        invoice_reference: f?.bims_invoice_number || "",
      }));

      const { error } = await supabase.from("shipment_packages").insert(labels);
      if (error) throw error;

      await supabase
        .from("fulfillment_orders")
        .update({ package_count: count })
        .eq("id", fulfillmentId);

      toast.success(`${count} etiqueta(s) creada(s)`);
      onSuccess();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const f = fulfillment as any;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Cantidad de bultos</Label>
          <Input type="number" min={1} value={count} onChange={(e) => setCount(parseInt(e.target.value) || 1)} />
        </div>
        <div className="space-y-2">
          <Label>Destinatario</Label>
          <Input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder={f?.destination_client_name || f?.branch_request?.client_name || ""} />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Destino / Dirección</Label>
        <Input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder={f?.destination_client_address || f?.branch_request?.client_address || ""} />
      </div>
      <div className="space-y-2">
        <Label>Teléfono de contacto</Label>
        <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder={f?.source_branch?.phone || ""} />
      </div>
      <div className="p-3 rounded-lg bg-muted/30 text-xs text-muted-foreground space-y-1">
        <p><strong>Origen:</strong> {branchName(f?.source_branch)}</p>
        {f?.bims_transfer_number && <p><strong>Transferencia:</strong> {f.bims_transfer_number}</p>}
        {f?.bims_invoice_number && <p><strong>Factura:</strong> {f.bims_invoice_number}</p>}
      </div>
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? "Creando..." : `Crear ${count} etiqueta(s)`}
      </Button>
    </form>
  );
}
