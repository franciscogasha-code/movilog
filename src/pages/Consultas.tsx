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
import { Plus, Search, MessageCircle, Clock, CheckCircle2, ShoppingCart, Package, Trash2, XCircle, AlertTriangle } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { ProductSearch, type ProductResult } from "@/components/shared/ProductSearch";
import { ProductCard } from "@/components/shared/ProductCard";
import { BranchSelector, MultiBranchSelector, useAutoDetectBranch } from "@/components/shared/BranchSelector";
import { ContextBanner } from "@/components/solicitudes/ContextBanner";
import { DemandAlert } from "@/components/solicitudes/DemandAlert";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useBranches } from "@/hooks/use-branches";
import {
  type RequestType,
  type DeliveryTarget,
  getOriginMode,
  getAllowedDeliveryTargets,
} from "@/lib/business-rules";

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
            <DialogHeader><DialogTitle>Consultar Disponibilidad</DialogTitle></DialogHeader>
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
                          : <span className="text-muted-foreground">Sin productos</span>}
                      </td>
                      <td className="p-3">{c.requesting_branch?.name} ({c.requesting_branch?.code})</td>
                      <td className="p-3"><StatusBadge status={c.status} config={STATUS_CONFIG} /></td>
                      <td className="p-3">
                        {c.orders_count > 0
                          ? <Badge variant="secondary" className="text-xs">{c.orders_count} pedido(s)</Badge>
                          : <span className="text-muted-foreground text-xs">—</span>}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {c.auto_close_at ? new Date(c.auto_close_at).toLocaleString("es-PY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                      </td>
                      <td className="p-3"><Button variant="ghost" size="sm"><MessageCircle className="h-4 w-4" /></Button></td>
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
          <DialogHeader><DialogTitle>Detalle de Consulta</DialogTitle></DialogHeader>
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
  const [deliveryContext, setDeliveryContext] = useState<DeliveryTarget>("branch");

  useEffect(() => {
    if (defaultBranchId && !branchId) setBranchId(defaultBranchId);
  }, [defaultBranchId]);

  const addProduct = (product: ProductResult) => {
    if (selectedProducts.find(p => p.id === product.id)) { toast.info("Producto ya agregado"); return; }
    setSelectedProducts(prev => [...prev, product]);
    setExpandedProduct(product.id);
  };

  const removeProduct = (productId: string) => {
    setSelectedProducts(prev => prev.filter(p => p.id !== productId));
    if (expandedProduct === productId) setExpandedProduct(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProducts.length || !branchId || !targetBranches.length) { toast.error("Completar todos los campos"); return; }
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
    } catch (err: any) { toast.error(err.message); }
    finally { setSubmitting(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Destino de entrega (contexto)</Label>
        <select value={deliveryContext} onChange={(e) => setDeliveryContext(e.target.value as DeliveryTarget)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <option value="branch">A sucursal (multi-origen permitido)</option>
          <option value="client">A cliente (origen único)</option>
        </select>
        <p className="text-xs text-muted-foreground">
          {deliveryContext === "branch"
            ? "Disponible para abastecimiento desde múltiples sucursales."
            : "Para entrega a cliente, el pedido debe resolverse desde una única sucursal origen."}
        </p>
      </div>

      <div className="space-y-2">
        <Label>Productos</Label>
        <ProductSearch onSelect={addProduct} excludeIds={selectedProducts.map(p => p.id)} placeholder="Buscar producto..." />
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
                  <div className="p-2 border-t border-border/50 space-y-2">
                    <DemandAlert productId={p.id} />
                    <ProductCard
                      productId={p.id} productName={p.name} productSku={p.sku}
                      productBimsCode={p.bims_code} productBarcode={(p as any).barcode}
                      productCategory={p.category} productUnit={p.unit}
                      productDescription={(p as any).description} productImageUrl={(p as any).image_url}
                      productSellPrice={(p as any).sell_price} productPriceScales={(p as any).price_scales}
                      productPriceLists={(p as any).price_lists}
                      productStockByWarehouse={(p as any).stock_by_warehouse}
                      productTotalStock={(p as any).total_stock}
                      stockMode="info_only" compact={false}
                    />
                    {deliveryContext === "branch" && (
                      <p className="text-xs text-muted-foreground italic">Se puede combinar stock de múltiples sucursales al crear el pedido.</p>
                    )}
                    {deliveryContext === "client" && (
                      <p className="text-xs text-muted-foreground italic">Identificá la sucursal que cubra el total para origen único.</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <BranchSelector label="Mi sucursal" value={branchId} onChange={setBranchId} disabled={!canChangeBranch && !!defaultBranchId} />
      <MultiBranchSelector label="Consultar a sucursales" selected={targetBranches} onChange={setTargetBranches} excludeIds={branchId ? [branchId] : []} />

      <Button type="submit" className="w-full" disabled={submitting || !selectedProducts.length}>
        {submitting ? "Enviando..." : "Enviar Consulta"}
      </Button>
    </form>
  );
}

function ConsultationDetail({ consultationId, onOrderCreated }: { consultationId: string; onOrderCreated: () => void }) {
  const queryClient = useQueryClient();
  const [createOrderOpen, setCreateOrderOpen] = useState(false);
  const [orderRequestType, setOrderRequestType] = useState<RequestType>("reposition");
  const [orderDeliveryTarget, setOrderDeliveryTarget] = useState<DeliveryTarget>("branch");

  const orderMode = getOriginMode(orderRequestType, orderDeliveryTarget);
  const allowedTargets = getAllowedDeliveryTargets(orderRequestType);

  // Enforce allowed targets
  useEffect(() => {
    if (!allowedTargets.includes(orderDeliveryTarget)) {
      setOrderDeliveryTarget(allowedTargets[0]);
    }
  }, [orderRequestType]);

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
      const { data, error } = await supabase.from("consultation_products")
        .select(`*, product:products(id, name, sku, bims_code, stock_by_warehouse, total_stock)`)
        .eq("consultation_id", consultationId);
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
      const { error } = await supabase.from("availability_consultations").update({ status: "converted" as any }).eq("id", consultationId);
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
            <Button size="sm" variant="outline" onClick={closeConsultation} className="text-xs">Cerrar consulta</Button>
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
                {cp.product?.total_stock != null && (
                  <Badge variant={cp.product.total_stock > 0 ? "default" : "destructive"} className="text-xs">
                    Stock: {Math.floor(cp.product.total_stock)}
                  </Badge>
                )}
                {derivedInOrder ? (
                  <Badge variant="outline" className="text-xs ml-auto gap-1"><CheckCircle2 className="h-3 w-3" /> Con pedido</Badge>
                ) : (
                  <Badge variant="outline" className="text-xs ml-auto text-muted-foreground"><Clock className="h-3 w-3 mr-1" /> Sin pedido</Badge>
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
        <div className="space-y-3">
          <h4 className="font-display font-semibold mb-1">Crear pedido desde consulta</h4>

          {/* Request type + delivery target */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Tipo de solicitud</Label>
              <select value={orderRequestType} onChange={(e) => setOrderRequestType(e.target.value as RequestType)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm">
                <option value="reposition">Reposición</option>
                <option value="client">Pedido Cliente</option>
                <option value="online">Pedido Online</option>
              </select>
            </div>
            {allowedTargets.length > 1 && (
              <div className="space-y-1">
                <Label className="text-xs">Destino de entrega</Label>
                <select value={orderDeliveryTarget} onChange={(e) => setOrderDeliveryTarget(e.target.value as DeliveryTarget)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm">
                  {allowedTargets.map(t => (
                    <option key={t} value={t}>{t === "branch" ? "A sucursal" : "A cliente"}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <ContextBanner requestType={orderRequestType} deliveryTarget={orderDeliveryTarget} />

          <Dialog open={createOrderOpen} onOpenChange={setCreateOrderOpen}>
            <DialogTrigger asChild>
              <Button className="w-full gap-2">
                <ShoppingCart className="h-4 w-4" />
                {orderMode === "multi" ? "Crear transferencia(s) multi-origen" : "Crear pedido con origen único"}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{orderMode === "multi" ? "Crear transferencia(s)" : "Crear pedido"}</DialogTitle>
              </DialogHeader>
              <CreateOrderFromConsultation
                consultationId={consultationId}
                requestingBranchId={c.requesting_branch_id}
                products={consultationProducts || []}
                requestType={orderRequestType}
                deliveryTarget={orderDeliveryTarget}
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
  consultationId, requestingBranchId, products, requestType, deliveryTarget, onSuccess,
}: {
  consultationId: string;
  requestingBranchId: string;
  products: any[];
  requestType: RequestType;
  deliveryTarget: DeliveryTarget;
  onSuccess: () => void;
}) {
  const { user } = useAuth();
  const { data: branches } = useBranches();
  const originMode = getOriginMode(requestType, deliveryTarget);
  const isMultiOrigin = originMode === "multi";

  const [sourceBranchId, setSourceBranchId] = useState("");
  const [selectedItems, setSelectedItems] = useState<Record<string, { qty: number; sourceBranchId?: string }>>(() => {
    const init: Record<string, { qty: number; sourceBranchId?: string }> = {};
    products.forEach(cp => { if (cp.product?.id) init[cp.product.id] = { qty: 1 }; });
    return init;
  });
  const [submitting, setSubmitting] = useState(false);

  const toggleProduct = (pid: string) => {
    setSelectedItems(prev => {
      const next = { ...prev };
      if (next[pid] !== undefined) delete next[pid];
      else next[pid] = { qty: 1 };
      return next;
    });
  };

  const updateQty = (pid: string, qty: number) => {
    setSelectedItems(prev => ({ ...prev, [pid]: { ...prev[pid], qty: Math.max(1, qty) } }));
  };

  const setItemSource = (pid: string, branchId: string) => {
    setSelectedItems(prev => ({ ...prev, [pid]: { ...prev[pid], sourceBranchId: branchId } }));
  };

  const selectedEntries = Object.entries(selectedItems).filter(([_, v]) => v.qty > 0);

  const canSubmit = (() => {
    if (!selectedEntries.length) return false;
    if (isMultiOrigin) return selectedEntries.every(([_, v]) => !!v.sourceBranchId);
    return !!sourceBranchId;
  })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) {
      toast.error(isMultiOrigin ? "Asignar origen a cada producto" : "Seleccionar sucursal origen");
      return;
    }

    setSubmitting(true);
    try {
      if (!user) { toast.error("Iniciar sesión"); return; }

      if (isMultiOrigin) {
        // Create parent
        const { data: parentReq, error: parentErr } = await supabase
          .from("branch_requests")
          .insert({
            requesting_branch_id: requestingBranchId,
            source_branch_id: requestingBranchId,
            created_by: user.id,
            request_type: requestType as any,
            delivery_target: deliveryTarget as any,
            notes: `[Pedido padre] Creado desde consulta`,
          })
          .select().single();
        if (parentErr) throw parentErr;

        const bySource: Record<string, { pid: string; qty: number }[]> = {};
        selectedEntries.forEach(([pid, v]) => {
          const src = v.sourceBranchId!;
          if (!bySource[src]) bySource[src] = [];
          bySource[src].push({ pid, qty: v.qty });
        });

        const createdNumbers: number[] = [];
        for (const [srcBranch, srcItems] of Object.entries(bySource)) {
          const { data: request, error: reqErr } = await supabase
            .from("branch_requests")
            .insert({
              requesting_branch_id: requestingBranchId,
              source_branch_id: srcBranch,
              parent_request_id: parentReq.id,
              created_by: user.id,
              request_type: requestType as any,
              delivery_target: deliveryTarget as any,
              notes: `Creado desde consulta`,
            })
            .select().single();
          if (reqErr) throw reqErr;

          const itemInserts = srcItems.map(({ pid, qty }) => ({
            request_id: request.id,
            product_id: pid,
            quantity_requested: qty,
            item_purpose: (requestType === "client" || requestType === "online" ? "client" : "reposition") as any,
          }));
          const { error: itemErr } = await supabase.from("branch_request_items").insert(itemInserts);
          if (itemErr) throw itemErr;

          const { error: linkErr } = await supabase.from("consultation_requests").insert({
            consultation_id: consultationId,
            branch_request_id: request.id,
          });
          if (linkErr) throw linkErr;

          createdNumbers.push(request.request_number);
        }

        // Link parent too
        await supabase.from("consultation_requests").insert({ consultation_id: consultationId, branch_request_id: parentReq.id });

        toast.success(`Pedido #${parentReq.request_number} con ${createdNumbers.length} transferencia(s)`);
      } else {
        const { data: request, error: reqErr } = await supabase
          .from("branch_requests")
          .insert({
            requesting_branch_id: requestingBranchId,
            source_branch_id: sourceBranchId,
            created_by: user.id,
            request_type: requestType as any,
            delivery_target: deliveryTarget as any,
            notes: `Creado desde consulta`,
          })
          .select().single();
        if (reqErr) throw reqErr;

        const itemInserts = selectedEntries.map(([product_id, v]) => ({
          request_id: request.id,
          product_id,
          quantity_requested: v.qty,
          item_purpose: (requestType === "client" || requestType === "online" ? "client" : "reposition") as any,
        }));
        const { error: itemErr } = await supabase.from("branch_request_items").insert(itemInserts);
        if (itemErr) throw itemErr;

        await supabase.from("consultation_requests").insert({ consultation_id: consultationId, branch_request_id: request.id });

        toast.success(`Pedido #${request.request_number} creado`);
      }

      onSuccess();
    } catch (err: any) { toast.error(err.message); }
    finally { setSubmitting(false); }
  };

  const itemsWithoutSource = isMultiOrigin ? selectedEntries.filter(([_, v]) => !v.sourceBranchId).length : 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <ContextBanner requestType={requestType} deliveryTarget={deliveryTarget} />

      {!isMultiOrigin && (
        <BranchSelector label="Sucursal origen (única)" value={sourceBranchId} onChange={setSourceBranchId} excludeIds={[requestingBranchId]} />
      )}

      {isMultiOrigin && (
        <p className="text-xs text-muted-foreground">Seleccioná la sucursal origen para cada producto. Se creará una transferencia por sucursal.</p>
      )}

      <div className="space-y-2">
        <Label>Productos a pedir</Label>
        <div className="space-y-2">
          {products.map((cp: any) => {
            const pid = cp.product?.id;
            if (!pid) return null;
            const itemState = selectedItems[pid];
            const isSelected = itemState !== undefined;
            return (
              <div key={cp.id} className="rounded border border-border/50 overflow-hidden">
                <div className="flex items-center gap-3 p-2">
                  <input type="checkbox" checked={isSelected} onChange={() => toggleProduct(pid)} className="rounded" />
                  <span className="flex-1 text-sm font-medium">{cp.product?.name} <span className="text-muted-foreground">({cp.product?.sku})</span></span>
                  {isSelected && (
                    <Input type="number" min={1} value={itemState.qty} onChange={e => updateQty(pid, parseInt(e.target.value) || 1)} className="w-20 h-8 text-sm" />
                  )}
                  {isMultiOrigin && isSelected && itemState.sourceBranchId && (
                    <Badge variant="outline" className="text-xs">{branches?.find(b => b.id === itemState.sourceBranchId)?.name || "—"}</Badge>
                  )}
                </div>
                {isMultiOrigin && isSelected && (
                  <div className="p-2 border-t border-border/30 bg-muted/20">
                    <Label className="text-xs text-muted-foreground mb-1 block">Sucursal origen para este producto</Label>
                    <BranchSelector value={itemState.sourceBranchId || ""} onChange={(bid) => setItemSource(pid, bid)} excludeIds={[requestingBranchId]} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {isMultiOrigin && itemsWithoutSource > 0 && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> {itemsWithoutSource} producto(s) sin origen asignado
        </p>
      )}

      <Button type="submit" className="w-full" disabled={submitting || !canSubmit}>
        {submitting ? "Creando..." : isMultiOrigin ? "Crear transferencia(s)" : "Crear pedido con origen único"}
      </Button>
    </form>
  );
}
