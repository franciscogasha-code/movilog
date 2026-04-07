import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Search, MessageCircle, Clock, CheckCircle2, ShoppingCart, Package, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { ProductSearch, type ProductResult } from "@/components/shared/ProductSearch";
import { ProductCard } from "@/components/shared/ProductCard";
import { BranchSelector, MultiBranchSelector, useAutoDetectBranch } from "@/components/shared/BranchSelector";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

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
        .select(`*, requesting_branch:branches!availability_consultations_requesting_branch_id_fkey(name, code)`)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;

      if (data?.length) {
        const ids = data.map(c => c.id);
        const { data: cpData } = await supabase.from("consultation_products").select("consultation_id, product:products(name, sku)").in("consultation_id", ids);
        const { data: crData } = await supabase.from("consultation_requests").select("consultation_id, branch_request_id").in("consultation_id", ids);

        const productsByConsultation: Record<string, any[]> = {};
        cpData?.forEach((cp: any) => {
          if (!productsByConsultation[cp.consultation_id]) productsByConsultation[cp.consultation_id] = [];
          productsByConsultation[cp.consultation_id].push(cp.product);
        });

        const ordersByConsultation: Record<string, number> = {};
        crData?.forEach((cr: any) => {
          ordersByConsultation[cr.consultation_id] = (ordersByConsultation[cr.consultation_id] || 0) + 1;
        });

        return data.map(c => ({
          ...c,
          consultation_products: productsByConsultation[c.id] || [],
          orders_count: ordersByConsultation[c.id] || 0,
        }));
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
                    <th className="text-left p-3 font-medium text-muted-foreground">Pedidos</th>
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
                      <td className="p-3">{c.requesting_branch?.name} ({c.requesting_branch?.code})</td>
                      <td className="p-3"><StatusBadge status={c.status} config={STATUS_CONFIG} /></td>
                      <td className="p-3">
                        {c.orders_count > 0
                          ? <Badge variant="secondary" className="text-xs">{c.orders_count} pedido(s)</Badge>
                          : <span className="text-muted-foreground text-xs">—</span>
                        }
                      </td>
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

      <Dialog open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalle de Consulta</DialogTitle>
          </DialogHeader>
          {selectedId && <ConsultationDetail consultationId={selectedId} onOrderCreated={() => queryClient.invalidateQueries({ queryKey: ["availability-consultations"] })} />}
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

function ConsultationForm({ onSuccess }: { onSuccess: () => void }) {
  const { user } = useAuth();
  const { defaultBranchId, canChangeBranch } = useAutoDetectBranch();
  const [submitting, setSubmitting] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<ProductResult[]>([]);
  const [branchId, setBranchId] = useState(defaultBranchId || "");
  const [targetBranches, setTargetBranches] = useState<string[]>([]);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);

  // Auto-set branch on mount
  useEffect(() => {
    if (defaultBranchId && !branchId) setBranchId(defaultBranchId);
  }, [defaultBranchId]);

  const addProduct = (product: ProductResult) => {
    if (selectedProducts.find(p => p.id === product.id)) {
      toast.info("Producto ya agregado");
      return;
    }
    setSelectedProducts(prev => [...prev, product]);
    setExpandedProduct(product.id);
  };

  const removeProduct = (productId: string) => {
    setSelectedProducts(prev => prev.filter(p => p.id !== productId));
    if (expandedProduct === productId) setExpandedProduct(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProducts.length || !branchId || !targetBranches.length) {
      toast.error("Completar todos los campos"); return;
    }
    setSubmitting(true);
    try {
      if (!user) { toast.error("Debés iniciar sesión"); return; }

      const { data: consultation, error } = await supabase
        .from("availability_consultations")
        .insert({ requesting_branch_id: branchId, created_by: user.id })
        .select().single();
      if (error) throw error;

      const cpInsert = selectedProducts.map(p => ({ consultation_id: consultation.id, product_id: p.id }));
      const { error: cpErr } = await supabase.from("consultation_products").insert(cpInsert);
      if (cpErr) throw cpErr;

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

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Products with search */}
      <div className="space-y-2">
        <Label>Productos</Label>
        <ProductSearch
          onSelect={addProduct}
          excludeIds={selectedProducts.map(p => p.id)}
          placeholder="Buscar producto..."
        />

        {selectedProducts.length > 0 && (
          <div className="space-y-2 mt-2">
            {selectedProducts.map((p) => (
              <div key={p.id} className="border border-border rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 p-2 bg-muted/30">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 text-sm font-medium truncate">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{p.sku}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setExpandedProduct(expandedProduct === p.id ? null : p.id)}>
                    {expandedProduct === p.id ? "▲" : "▼"}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeProduct(p.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
                {expandedProduct === p.id && (
                  <div className="p-2 border-t border-border/50">
                    <ProductCard
                      productId={p.id}
                      productName={p.name}
                      productSku={p.sku}
                      productBimsCode={p.bims_code}
                      productCategory={p.category}
                      productUnit={p.unit}
                      compact={false}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Branch */}
      <BranchSelector
        label="Mi sucursal"
        value={branchId}
        onChange={setBranchId}
        disabled={!canChangeBranch && !!defaultBranchId}
      />

      {/* Target branches */}
      <MultiBranchSelector
        label="Consultar a sucursales"
        selected={targetBranches}
        onChange={setTargetBranches}
        excludeIds={branchId ? [branchId] : []}
      />

      <Button type="submit" className="w-full" disabled={submitting || !selectedProducts.length}>
        {submitting ? "Enviando..." : "Enviar Consulta"}
      </Button>
    </form>
  );
}

function ConsultationDetail({ consultationId, onOrderCreated }: { consultationId: string; onOrderCreated: () => void }) {
  const queryClient = useQueryClient();
  const [createOrderOpen, setCreateOrderOpen] = useState(false);

  const { data: consultation } = useQuery({
    queryKey: ["consultation-detail", consultationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("availability_consultations")
        .select(`*, requesting_branch:branches!availability_consultations_requesting_branch_id_fkey(name, code)`)
        .eq("id", consultationId).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: consultationProducts } = useQuery({
    queryKey: ["consultation-products", consultationId],
    queryFn: async () => {
      const { data, error } = await supabase.from("consultation_products").select(`*, product:products(id, name, sku, bims_code)`).eq("consultation_id", consultationId);
      if (error) throw error;
      return data;
    },
    enabled: !!consultationId,
  });

  const { data: targets } = useQuery({
    queryKey: ["consultation-targets", consultationId],
    queryFn: async () => {
      const { data, error } = await supabase.from("consultation_targets").select(`*, branch:branches(name, code)`).eq("consultation_id", consultationId);
      if (error) throw error;
      return data;
    },
    enabled: !!consultationId,
  });

  const { data: linkedOrders } = useQuery({
    queryKey: ["consultation-orders", consultationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consultation_requests")
        .select(`*, branch_request:branch_requests(request_number, status, source_branch_id, requesting_branch_id, source_branch:branches!branch_requests_source_branch_id_fkey(name, code))`)
        .eq("consultation_id", consultationId);
      if (error) throw error;
      return data;
    },
    enabled: !!consultationId,
  });

  const { data: messages } = useQuery({
    queryKey: ["consultation-messages", consultationId],
    queryFn: async () => {
      const { data, error } = await supabase.from("consultation_messages").select("*").eq("consultation_id", consultationId).order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!consultationId,
  });

  const closeConsultation = async () => {
    try {
      const { error } = await supabase
        .from("availability_consultations")
        .update({ status: "converted" as any })
        .eq("id", consultationId);
      if (error) throw error;
      toast.success("Consulta cerrada");
      queryClient.invalidateQueries({ queryKey: ["consultation-detail", consultationId] });
      onOrderCreated();
    } catch (err: any) { toast.error(err.message); }
  };

  if (!consultation) return <div className="p-4 text-muted-foreground">Cargando...</div>;
  const c = consultation as any;
  const canCreateOrder = c.status === "open" || c.status === "responded";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg font-bold">Consulta de disponibilidad</h3>
          <p className="text-sm text-muted-foreground">Desde {c.requesting_branch?.name} ({c.requesting_branch?.code})</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={c.status} config={STATUS_CONFIG} />
          {canCreateOrder && (
            <Button size="sm" variant="outline" onClick={closeConsultation} className="text-xs">
              Cerrar consulta
            </Button>
          )}
        </div>
      </div>

      <div>
        <h4 className="font-display font-semibold mb-2">Productos consultados</h4>
        <div className="space-y-1">
          {consultationProducts?.map((cp: any) => {
            const derivedInOrder = linkedOrders && linkedOrders.length > 0;
            return (
              <div key={cp.id} className="flex items-center gap-2 p-2 rounded bg-muted/30 text-sm">
                <span className="font-medium">{cp.product?.name}</span>
                <span className="text-muted-foreground text-xs">({cp.product?.sku})</span>
                {derivedInOrder ? (
                  <Badge variant="outline" className="text-xs ml-auto text-accent border-accent/30 gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Con pedido
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs ml-auto text-muted-foreground">
                    <Clock className="h-3 w-3 mr-1" /> Sin pedido
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h4 className="font-display font-semibold mb-3">Respuestas de sucursales</h4>
        <div className="space-y-2">
          {targets?.map((t: any) => (
            <div key={t.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/30 text-sm">
              <span className="font-semibold min-w-[80px]">{t.branch?.name}</span>
              <span className="text-xs text-muted-foreground">({t.branch?.code})</span>
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

      {(linkedOrders?.length ?? 0) > 0 && (
        <div>
          <h4 className="font-display font-semibold mb-2">Pedidos creados</h4>
          <div className="space-y-1">
            {linkedOrders?.map((lr: any) => (
              <div key={lr.id} className="flex items-center gap-2 p-2 rounded bg-accent/5 border border-accent/20 text-sm">
                <ShoppingCart className="h-4 w-4 text-accent" />
                <span className="font-semibold">Pedido #{lr.branch_request?.request_number}</span>
                <span className="text-muted-foreground">desde {lr.branch_request?.source_branch?.name} ({lr.branch_request?.source_branch?.code})</span>
                <Badge variant="outline" className="text-xs ml-auto">{lr.branch_request?.status}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {canCreateOrder && (
        <div>
          <Dialog open={createOrderOpen} onOpenChange={setCreateOrderOpen}>
            <DialogTrigger asChild>
              <Button className="w-full gap-2">
                <ShoppingCart className="h-4 w-4" /> Crear pedido desde esta consulta
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Crear pedido</DialogTitle>
              </DialogHeader>
              <CreateOrderFromConsultation
                consultationId={consultationId}
                requestingBranchId={c.requesting_branch_id}
                products={consultationProducts || []}
                onSuccess={() => {
                  setCreateOrderOpen(false);
                  queryClient.invalidateQueries({ queryKey: ["consultation-orders", consultationId] });
                  onOrderCreated();
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      )}

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

function CreateOrderFromConsultation({
  consultationId,
  requestingBranchId,
  products,
  onSuccess,
}: {
  consultationId: string;
  requestingBranchId: string;
  products: any[];
  onSuccess: () => void;
}) {
  const { user } = useAuth();
  const [sourceBranchId, setSourceBranchId] = useState("");
  const [selectedItems, setSelectedItems] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    products.forEach(cp => { if (cp.product?.id) init[cp.product.id] = 1; });
    return init;
  });
  const [submitting, setSubmitting] = useState(false);

  const toggleProduct = (pid: string) => {
    setSelectedItems(prev => {
      const next = { ...prev };
      if (next[pid] !== undefined) delete next[pid];
      else next[pid] = 1;
      return next;
    });
  };

  const updateQty = (pid: string, qty: number) => {
    setSelectedItems(prev => ({ ...prev, [pid]: Math.max(1, qty) }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const items = Object.entries(selectedItems).filter(([_, qty]) => qty > 0);
    if (!items.length || !sourceBranchId) { toast.error("Seleccionar sucursal origen y al menos un producto"); return; }

    setSubmitting(true);
    try {
      if (!user) { toast.error("Iniciar sesión"); return; }

      const { data: request, error: reqErr } = await supabase
        .from("branch_requests")
        .insert({
          requesting_branch_id: requestingBranchId,
          source_branch_id: primarySourceId,
          created_by: user.id,
          request_type: "reposition" as any,
          status: "pending" as any,
          notes: `Creado desde consulta de disponibilidad`,
        })
        .select().single();
      if (reqErr) throw reqErr;

      const itemInserts = items.map(([product_id, qty]) => ({
        request_id: request.id,
        product_id,
        quantity_requested: qty,
      }));
      const { error: itemErr } = await supabase.from("branch_request_items").insert(itemInserts);
      if (itemErr) throw itemErr;

      const { error: linkErr } = await supabase.from("consultation_requests").insert({
        consultation_id: consultationId,
        branch_request_id: request.id,
      });
      if (linkErr) throw linkErr;

      toast.success(`Pedido #${request.request_number} creado`);
      onSuccess();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <MultiBranchSelector
        label="Sucursal(es) origen"
        selected={sourceBranchIds}
        onChange={setSourceBranchIds}
        excludeIds={[requestingBranchId]}
      />

      <div className="space-y-2">
        <Label>Productos a pedir</Label>
        <div className="space-y-2">
          {products.map((cp: any) => {
            const pid = cp.product?.id;
            if (!pid) return null;
            const isSelected = selectedItems[pid] !== undefined;
            return (
              <div key={cp.id} className="flex items-center gap-3 p-2 rounded border border-border/50">
                <input type="checkbox" checked={isSelected} onChange={() => toggleProduct(pid)} className="rounded" />
                <span className="flex-1 text-sm font-medium">{cp.product?.name} <span className="text-muted-foreground">({cp.product?.sku})</span></span>
                {isSelected && (
                  <Input type="number" min={1} value={selectedItems[pid]} onChange={e => updateQty(pid, parseInt(e.target.value) || 1)}
                    className="w-20 h-8 text-sm" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={submitting || !sourceBranchIds.length}>
        {submitting ? "Creando..." : "Crear pedido"}
      </Button>
    </form>
  );
}
