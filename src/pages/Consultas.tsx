import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Search, MessageCircle, Clock, CheckCircle2 } from "lucide-react";
import { useBranches, useProducts } from "@/hooks/use-branches";
import { StatusBadge } from "@/components/StatusBadge";
import { toast } from "sonner";

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  open: { label: "Abierta", variant: "default" },
  responded: { label: "Respondida", variant: "secondary" },
  converted: { label: "Convertida", variant: "outline" },
  expired: { label: "Expirada", variant: "destructive" },
};

export default function Consultas() {
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: consultations, isLoading } = useQuery({
    queryKey: ["availability-consultations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("availability_consultations")
        .select(`
          *,
          requesting_branch:branches!availability_consultations_requesting_branch_id_fkey(name, code)
        `)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;

      // Fetch products for each consultation
      if (data?.length) {
        const ids = data.map(c => c.id);
        const { data: cpData } = await supabase
          .from("consultation_products")
          .select("consultation_id, product:products(name, sku)")
          .in("consultation_id", ids);

        const productsByConsultation: Record<string, any[]> = {};
        cpData?.forEach((cp: any) => {
          if (!productsByConsultation[cp.consultation_id]) productsByConsultation[cp.consultation_id] = [];
          productsByConsultation[cp.consultation_id].push(cp.product);
        });

        return data.map(c => ({ ...c, consultation_products: productsByConsultation[c.id] || [] }));
      }
      return data;
    },
  });

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Consultas de Disponibilidad</h1>
          <p className="text-muted-foreground mt-1">Consultar stock antes de crear pedidos</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> Nueva Consulta</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Consultar Disponibilidad</DialogTitle>
            </DialogHeader>
            <ConsultationForm onSuccess={() => { setCreateOpen(false); queryClient.invalidateQueries({ queryKey: ["availability-consultations"] }); }} />
          </DialogContent>
        </Dialog>
      </div>

      <Card className="glass-card">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Cargando consultas...</div>
          ) : !consultations?.length ? (
            <div className="p-8 text-center text-muted-foreground">
              <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No hay consultas activas</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left p-3 font-medium text-muted-foreground">Productos</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Sucursal</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Estado</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Cierre auto</th>
                    <th className="text-left p-3 font-medium text-muted-foreground"></th>
                  </tr>
                </thead>
                <tbody>
                  {consultations.map((c: any) => (
                    <tr key={c.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => setSelectedId(c.id)}>
                      <td className="p-3 font-medium">
                        {c.consultation_products?.length > 0
                          ? c.consultation_products.map((p: any) => p?.name).filter(Boolean).join(", ")
                          : <span className="text-muted-foreground">Sin productos</span>
                        }
                      </td>
                      <td className="p-3">{c.requesting_branch?.code}</td>
                      <td className="p-3"><StatusBadge status={c.status} config={STATUS_CONFIG} /></td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {c.auto_close_at ? new Date(c.auto_close_at).toLocaleString("es-PY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                      </td>
                      <td className="p-3">
                        <Button variant="ghost" size="sm"><MessageCircle className="h-4 w-4" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail dialog */}
      <Dialog open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalle de Consulta</DialogTitle>
          </DialogHeader>
          {selectedId && <ConsultationDetail consultationId={selectedId} />}
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

function ConsultationForm({ onSuccess }: { onSuccess: () => void }) {
  const { data: branches } = useBranches();
  const { data: products } = useProducts();
  const [submitting, setSubmitting] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<string[]>([""]);
  const [branchId, setBranchId] = useState("");
  const [targetBranches, setTargetBranches] = useState<string[]>([]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validProducts = selectedProducts.filter(Boolean);
    if (!validProducts.length || !branchId || !targetBranches.length) {
      toast.error("Completar todos los campos"); return;
    }
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Debés iniciar sesión"); return; }

      const { data: consultation, error } = await supabase
        .from("availability_consultations")
        .insert({ requesting_branch_id: branchId, created_by: user.id })
        .select()
        .single();
      if (error) throw error;

      // Insert consultation products
      const cpInsert = validProducts.map(pid => ({ consultation_id: consultation.id, product_id: pid }));
      const { error: cpErr } = await supabase.from("consultation_products").insert(cpInsert);
      if (cpErr) throw cpErr;

      // Insert targets
      const targets = targetBranches.map(bid => ({ consultation_id: consultation.id, branch_id: bid }));
      const { error: tErr } = await supabase.from("consultation_targets").insert(targets);
      if (tErr) throw tErr;

      toast.success("Consulta creada");
      onSuccess();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleBranch = (id: string) => {
    setTargetBranches(prev => prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id]);
  };

  const addProductRow = () => setSelectedProducts(prev => [...prev, ""]);
  const updateProduct = (idx: number, val: string) => {
    setSelectedProducts(prev => prev.map((p, i) => i === idx ? val : p));
  };
  const removeProduct = (idx: number) => {
    if (selectedProducts.length > 1) setSelectedProducts(prev => prev.filter((_, i) => i !== idx));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Productos</Label>
          <Button type="button" variant="ghost" size="sm" onClick={addProductRow}>+ Agregar</Button>
        </div>
        {selectedProducts.map((pid, idx) => (
          <div key={idx} className="flex gap-2">
            <select value={pid} onChange={e => updateProduct(idx, e.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="">Seleccionar producto...</option>
              {products?.map(p => <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>)}
            </select>
            {selectedProducts.length > 1 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => removeProduct(idx)} className="shrink-0">✕</Button>
            )}
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <Label>Mi sucursal</Label>
        <select value={branchId} onChange={e => setBranchId(e.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
          <option value="">Seleccionar...</option>
          {branches?.map(b => <option key={b.id} value={b.id}>{b.code} - {b.name}</option>)}
        </select>
      </div>
      <div className="space-y-2">
        <Label>Consultar a sucursales</Label>
        <div className="flex flex-wrap gap-2">
          {branches?.filter(b => b.id !== branchId).map(b => (
            <Badge
              key={b.id}
              variant={targetBranches.includes(b.id) ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => toggleBranch(b.id)}
            >
              {b.code}
            </Badge>
          ))}
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? "Enviando..." : "Enviar Consulta"}
      </Button>
    </form>
  );
}

function ConsultationDetail({ consultationId }: { consultationId: string }) {
  const { data: consultation } = useQuery({
    queryKey: ["consultation-detail", consultationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("availability_consultations")
        .select(`*, requesting_branch:branches!availability_consultations_requesting_branch_id_fkey(name, code)`)
        .eq("id", consultationId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: consultationProducts } = useQuery({
    queryKey: ["consultation-products", consultationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consultation_products")
        .select(`*, product:products(name, sku)`)
        .eq("consultation_id", consultationId);
      if (error) throw error;
      return data;
    },
    enabled: !!consultationId,
  });

  const { data: targets } = useQuery({
    queryKey: ["consultation-targets", consultationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consultation_targets")
        .select(`*, branch:branches(name, code)`)
        .eq("consultation_id", consultationId);
      if (error) throw error;
      return data;
    },
    enabled: !!consultationId,
  });

  const { data: messages } = useQuery({
    queryKey: ["consultation-messages", consultationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consultation_messages")
        .select("*")
        .eq("consultation_id", consultationId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!consultationId,
  });

  if (!consultation) return <div className="p-4 text-muted-foreground">Cargando...</div>;

  const c = consultation as any;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg font-bold">Consulta de disponibilidad</h3>
          <p className="text-sm text-muted-foreground">Desde {c.requesting_branch?.code}</p>
        </div>
        <StatusBadge status={c.status} config={STATUS_CONFIG} />
      </div>

      <div>
        <h4 className="font-display font-semibold mb-2">Productos consultados</h4>
        <div className="space-y-1">
          {consultationProducts?.map((cp: any) => (
            <div key={cp.id} className="flex items-center gap-2 p-2 rounded bg-muted/30 text-sm">
              <span className="font-medium">{cp.product?.name}</span>
              <span className="text-muted-foreground text-xs">({cp.product?.sku})</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h4 className="font-display font-semibold mb-3">Respuestas de sucursales</h4>
        <div className="space-y-2">
          {targets?.map((t: any) => (
            <div key={t.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/30 text-sm">
              <span className="font-semibold min-w-[60px]">{t.branch?.code}</span>
              {t.responded_at ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-accent" />
                  <span>Cant: <strong>{t.response_quantity ?? "—"}</strong></span>
                  {t.response_colors && <span className="text-muted-foreground">Colores: {t.response_colors}</span>}
                  {t.response_note && <span className="text-muted-foreground italic">"{t.response_note}"</span>}
                </>
              ) : (
                <span className="text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Sin respuesta</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div>
        <h4 className="font-display font-semibold mb-3">Chat</h4>
        {!messages?.length ? (
          <p className="text-sm text-muted-foreground">Sin mensajes</p>
        ) : (
          <div className="space-y-2 max-h-[200px] overflow-y-auto">
            {messages.map((m: any) => (
              <div key={m.id} className="p-2 rounded bg-muted/20 text-sm">
                <p>{m.message}</p>
                <p className="text-xs text-muted-foreground mt-1">{new Date(m.created_at).toLocaleString("es-PY")}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
