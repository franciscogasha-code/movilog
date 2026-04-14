import { useState, useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Search, MessageCircle, Clock, CheckCircle2, ShoppingCart, Package, Trash2, XCircle, AlertTriangle, ChevronDown, ChevronUp, Send } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { proxyImageUrl } from "@/lib/image-utils";
import { StatusBadge } from "@/components/StatusBadge";
import { ProductSearch, type ProductResult } from "@/components/shared/ProductSearch";
import { ProductCard } from "@/components/shared/ProductCard";
import { useLiveStock } from "@/hooks/use-live-stock";
import { BranchSelector, useAutoDetectBranch } from "@/components/shared/BranchSelector";
import { cn } from "@/lib/utils";
import { DemandAlert } from "@/components/solicitudes/DemandAlert";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useBranches } from "@/hooks/use-branches";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useUserBranchFilter } from "@/hooks/use-user-access";

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  open: { label: "Abierta", variant: "default" },
  responded: { label: "Respondida", variant: "secondary" },
  converted: { label: "Convertida", variant: "outline" },
  expired: { label: "Expirada", variant: "outline" },
};

export default function Consultas() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const detailParam = searchParams.get("detail");
    const actionParam = searchParams.get("action");
    if (detailParam) {
      setSelectedId(detailParam);
      setSearchParams({}, { replace: true });
    } else if (actionParam === "new") {
      setCreateOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams]);

  // RLS handles branch filtering — only consultations the user participates in are returned
  const { isAllBranches, allowedBranchIds } = useUserBranchFilter();

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
        const [cpRes, crRes, ctRes] = await Promise.all([
          supabase.from("consultation_products").select("consultation_id, product:products(name, sku)").in("consultation_id", ids),
          supabase.from("consultation_requests").select("consultation_id, branch_request_id").in("consultation_id", ids),
          supabase.from("consultation_targets").select("consultation_id, responded_at, branch:branches!consultation_targets_branch_id_fkey(id, name, code)").in("consultation_id", ids),
        ]);

        const productsByConsultation: Record<string, any[]> = {};
        cpRes.data?.forEach((cp: any) => {
          if (!productsByConsultation[cp.consultation_id]) productsByConsultation[cp.consultation_id] = [];
          productsByConsultation[cp.consultation_id].push(cp.product);
        });

        const ordersByConsultation: Record<string, number> = {};
        crRes.data?.forEach((cr: any) => {
          ordersByConsultation[cr.consultation_id] = (ordersByConsultation[cr.consultation_id] || 0) + 1;
        });

        const responsesByConsultation: Record<string, { total: number; responded: number }> = {};
        const targetBranchesByConsultation: Record<string, any[]> = {};
        ctRes.data?.forEach((ct: any) => {
          if (!responsesByConsultation[ct.consultation_id]) responsesByConsultation[ct.consultation_id] = { total: 0, responded: 0 };
          responsesByConsultation[ct.consultation_id].total++;
          if (ct.responded_at) responsesByConsultation[ct.consultation_id].responded++;
          if (ct.branch) {
            if (!targetBranchesByConsultation[ct.consultation_id]) targetBranchesByConsultation[ct.consultation_id] = [];
            targetBranchesByConsultation[ct.consultation_id].push(ct.branch);
          }
        });

        return data.map(c => ({
          ...c,
          consultation_products: productsByConsultation[c.id] || [],
          orders_count: ordersByConsultation[c.id] || 0,
          responses: responsesByConsultation[c.id] || { total: 0, responded: 0 },
          target_branches: targetBranchesByConsultation[c.id] || [],
        }));
      }
      return data;
    },
  });

  /** Build contextual route label */
  const buildRouteLabel = (c: any) => {
    const reqName = c.requesting_branch?.name ?? "?";
    const targets: any[] = c.target_branches ?? [];
    const targetCount = targets.length;

    const renderTargets = () => {
      if (targetCount === 0) return <span className="font-medium">?</span>;
      if (targetCount === 1) return <span className="font-medium">{targets[0].name}</span>;
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="font-medium cursor-default">{targetCount} sucursales</span>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs max-w-[200px]">
            {targets.map((b: any) => b.name).join(", ")}
          </TooltipContent>
        </Tooltip>
      );
    };

    if (isAllBranches) {
      return (
        <>
          <span className="text-muted-foreground text-xs">De:</span>{" "}
          <span className="font-medium">{reqName}</span>
          <span className="text-muted-foreground mx-1">→</span>
          <span className="text-muted-foreground text-xs">Para:</span>{" "}
          {renderTargets()}
        </>
      );
    }

    const isRequester = allowedBranchIds.includes(c.requesting_branch_id);
    if (isRequester) {
      return (
        <>
          <span className="text-muted-foreground text-xs">Para:</span>{" "}
          {renderTargets()}
        </>
      );
    }
    return (
      <>
        <span className="text-muted-foreground text-xs">De:</span>{" "}
        <span className="font-medium">{reqName}</span>
      </>
    );
  };

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Consultas de Disponibilidad</h1>
          <p className="text-muted-foreground mt-1">Historial de consultas de stock entre sucursales</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> Nueva Consulta</Button>
          </DialogTrigger>
          <DialogContent className="w-[calc(100vw-0.75rem)] max-w-xl max-h-[85vh] overflow-y-auto overflow-x-hidden p-3 sm:p-6">
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
              <p>No hay consultas registradas</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Productos</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Ruta</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Estado</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Respuestas</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Pedidos</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Fecha</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground"></th>
                  </tr>
                </thead>
                <tbody>
                  {consultations.map((c: any) => (
                    <tr
                      key={c.id}
                      className={cn(
                        "border-b border-border/50 hover:bg-muted/40 active:bg-muted/60 transition-all duration-150 cursor-pointer",
                        c.status === "open" && "bg-primary/[0.03]"
                      )}
                      onClick={() => setSelectedId(c.id)}
                    >
                      <td className="px-3 py-2 font-medium max-w-[200px]">
                        <span className="line-clamp-1">
                          {(() => {
                            const prods = c.consultation_products?.filter((p: any) => p?.name) ?? [];
                            if (!prods.length) return <span className="text-muted-foreground">Sin productos</span>;
                            const first = prods[0].name;
                            const rest = prods.length - 1;
                            return rest > 0 ? <>{first} <span className="text-muted-foreground">+{rest} más</span></> : first;
                          })()}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {buildRouteLabel(c)}
                        </div>
                      </td>
                      <td className="px-3 py-2"><StatusBadge status={c.status} config={STATUS_CONFIG} /></td>
                      <td className="px-3 py-2">
                        <Badge variant={c.responses?.responded > 0 ? "secondary" : "outline"} className="text-xs">
                          {c.responses?.responded ?? 0}/{c.responses?.total ?? 0}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        {c.orders_count > 0
                          ? <Badge variant="secondary" className="text-xs">{c.orders_count} pedido(s)</Badge>
                          : <span className="text-muted-foreground text-xs">—</span>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">
                        {new Date(c.created_at).toLocaleDateString("es-PY", { day: "2-digit", month: "short" })}
                      </td>
                      <td className="px-3 py-2">
                        <Button variant="ghost" size="sm" className="text-xs h-7">Ver consulta</Button>
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
        <DialogContent className="w-[calc(100vw-0.75rem)] max-w-2xl max-h-[90vh] overflow-y-auto p-3 sm:p-6">
          <DialogHeader><DialogTitle>Detalle de Consulta</DialogTitle></DialogHeader>
          {selectedId && <ConsultationDetail consultationId={selectedId} onOrderCreated={() => queryClient.invalidateQueries({ queryKey: ["availability-consultations"] })} />}
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

// ─── Creation Form ──────────────────────────────────────────────
function ConsultationForm({ onSuccess }: { onSuccess: () => void }) {
  const { user } = useAuth();
  const { data: branches } = useBranches();
  const { defaultBranchId, canChangeBranch } = useAutoDetectBranch();
  const [submitting, setSubmitting] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<ProductResult[]>([]);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [initialMessage, setInitialMessage] = useState("");
  const [productSources, setProductSources] = useState<Record<string, Set<string>>>({});
  const [customBranchId, setCustomBranchId] = useState("");

  const bimsCodes = selectedProducts.map(p => p.bims_code).filter(Boolean) as string[];
  const { liveStock, isLive } = useLiveStock(bimsCodes);

  const resolvedBranchId = (canChangeBranch && customBranchId) ? customBranchId : (defaultBranchId || "");
  const myBranch = branches?.find(b => b.id === resolvedBranchId);

  const addProduct = (product: ProductResult) => {
    if (selectedProducts.find(p => p.id === product.id)) { toast.info("Producto ya agregado"); return; }
    setSelectedProducts(prev => [...prev, product]);
    setExpandedProduct(product.id);
  };

  const removeProduct = (productId: string) => {
    setSelectedProducts(prev => prev.filter(p => p.id !== productId));
    setProductSources(prev => { const next = { ...prev }; delete next[productId]; return next; });
    if (expandedProduct === productId) setExpandedProduct(null);
  };

  const toggleProductBranch = (productId: string, targetBranchId: string) => {
    setProductSources(prev => {
      const current = new Set(prev[productId] || []);
      if (current.has(targetBranchId)) current.delete(targetBranchId);
      else current.add(targetBranchId);
      return { ...prev, [productId]: current };
    });
  };

  const derivedTargetBranches = Array.from(
    new Set(Object.values(productSources).flatMap(s => Array.from(s)))
  );

  const allProductsHaveSource = selectedProducts.length > 0 &&
    selectedProducts.every(p => (productSources[p.id]?.size ?? 0) > 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProducts.length || !resolvedBranchId || !allProductsHaveSource) {
      toast.error("Seleccioná al menos una sucursal origen por cada producto");
      return;
    }
    setSubmitting(true);
    try {
      if (!user) { toast.error("Debés iniciar sesión"); return; }

      // Create one consultation per target branch for cleaner chat/response threads
      for (const targetBranchId of derivedTargetBranches) {
        // Find products that have this branch as a source
        const productsForBranch = selectedProducts.filter(
          p => productSources[p.id]?.has(targetBranchId)
        );
        if (!productsForBranch.length) continue;

        const { data: consultation, error } = await supabase
          .from("availability_consultations")
          .insert({ requesting_branch_id: resolvedBranchId, created_by: user.id })
          .select().single();
        if (error) throw error;

        const cpInsert = productsForBranch.map(p => ({ consultation_id: consultation.id, product_id: p.id }));
        const { error: cpErr } = await supabase.from("consultation_products").insert(cpInsert);
        if (cpErr) throw cpErr;

        const { error: tErr } = await supabase.from("consultation_targets").insert([
          { consultation_id: consultation.id, branch_id: targetBranchId }
        ]);
        if (tErr) throw tErr;

        if (initialMessage.trim()) {
          await supabase.from("consultation_messages").insert({
            consultation_id: consultation.id,
            sender_id: user.id,
            message: initialMessage.trim(),
          });
        }
      }

      const count = derivedTargetBranches.length;
      toast.success(count > 1 ? `${count} consultas creadas (una por sucursal)` : "Consulta creada");
      onSuccess();
    } catch (err: any) { toast.error(err.message); }
    finally { setSubmitting(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* STEP 1: My branch */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">1. Mi sucursal</h3>
        {canChangeBranch ? (
          <BranchSelector value={resolvedBranchId} onChange={(id) => setCustomBranchId(id)} label="" />
        ) : (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30 border border-border/30">
            <Package className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium">{myBranch ? `${myBranch.name} (${myBranch.code})` : "Cargando..."}</span>
            <Badge variant="outline" className="text-xs ml-auto">Auto-detectada</Badge>
          </div>
        )}
      </div>

      {/* STEP 2: Products */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">2. Productos a consultar</h3>
        <ProductSearch onSelect={addProduct} excludeIds={selectedProducts.map(p => p.id)} placeholder="Buscar producto..." />

        {selectedProducts.length > 0 ? (
          <div className="space-y-2">
            {selectedProducts.map((p) => {
              const selectedForProduct = productSources[p.id] || new Set<string>();
              const liveData = isLive && p.bims_code && liveStock?.[p.bims_code] ? liveStock[p.bims_code] : null;
              const headerStock = liveData?.total_stock ?? p.total_stock;

              return (
                <div key={p.id} className="border border-border rounded-lg overflow-hidden">
                  <div className="space-y-2 bg-muted/30 p-2.5 sm:p-3">
                    <div className="flex min-w-0 items-start gap-3">
                      {p.image_url ? (
                        <img src={proxyImageUrl(p.image_url)} alt={p.name} className="h-8 w-8 rounded object-cover shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      ) : (
                        <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium line-clamp-2">{p.name}</p>
                        <p className="text-xs text-muted-foreground break-words">
                          {p.sku && `SKU: ${p.sku}`}
                          {p.bims_code && ` • Cód: ${p.bims_code}`}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
                      <div className="flex flex-wrap items-center gap-2">
                        {headerStock != null && (
                          <Badge variant={headerStock > 0 ? "default" : "destructive"} className="text-xs shrink-0">
                            Stock: {Math.floor(headerStock)}
                          </Badge>
                        )}
                        {selectedForProduct.size > 0 && (
                          <Badge variant="secondary" className="text-xs shrink-0">{selectedForProduct.size} origen(es)</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1 self-end sm:self-auto">
                        <Button type="button" variant="ghost" size="sm"
                          onClick={() => setExpandedProduct(expandedProduct === p.id ? null : p.id)}>
                          {expandedProduct === p.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => removeProduct(p.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </div>

                  {expandedProduct === p.id && (
                    <div className="p-2 border-t border-border/50 space-y-2">
                      <DemandAlert productId={p.id} />
                      <div className="w-full min-w-0">
                        <ProductCard
                          productId={p.id}
                          productName={p.name}
                          productSku={p.sku}
                          productBimsCode={p.bims_code}
                          productBarcode={p.barcode}
                          productCategory={p.category}
                          productUnit={p.unit}
                          productDescription={p.description}
                          productImageUrl={p.image_url}
                          productSellPrice={p.sell_price}
                          productPriceScales={p.price_scales as { min_quantity: number; price: number }[] | undefined}
                          productPriceLists={p.price_lists as { name: string; amount: number }[] | undefined}
                          productStockByWarehouse={p.stock_by_warehouse as Record<string, number> | undefined}
                          productTotalStock={p.total_stock}
                          stockMode="select_multi"
                          selectedBranchIds={selectedForProduct}
                          onToggleBranch={(bid) => toggleProductBranch(p.id, bid)}
                          compact={false}
                          liveStock={isLive && p.bims_code && liveStock?.[p.bims_code] ? liveStock[p.bims_code] : null}
                          isLive={isLive}
                        />
                      </div>
                      {selectedForProduct.size === 0 && (
                        <p className="text-xs text-destructive flex items-center gap-1 px-2 sm:px-3 pb-2">
                          <AlertTriangle className="h-3 w-3" /> Seleccioná al menos una sucursal
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center p-6 rounded-lg border border-dashed border-border text-muted-foreground text-sm">
            <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
            Buscá y agregá productos usando el buscador
          </div>
        )}
      </div>

      {/* Summary of derived targets */}
      {derivedTargetBranches.length > 0 && (
        <div className="p-3 rounded-lg bg-muted/30 border border-border/30 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Sucursales a consultar:</p>
          <div className="flex flex-wrap gap-1.5">
            {derivedTargetBranches.map(bid => {
              const b = branches?.find(br => br.id === bid);
              return b ? (
                <Badge key={bid} variant="secondary" className="text-xs">{b.name} ({b.code})</Badge>
              ) : null;
            })}
          </div>
        </div>
      )}

      {/* Initial message */}
      <div className="space-y-2">
        <Label className="text-xs font-medium flex items-center gap-1.5">
          <MessageCircle className="h-3.5 w-3.5" />
          Mensaje inicial (opcional)
        </Label>
        <Textarea
          value={initialMessage}
          onChange={(e) => setInitialMessage(e.target.value)}
          placeholder="Ej: ¿Tienen este producto en azul y verde?"
          rows={2}
          className="text-sm resize-none"
        />
        <p className="text-[11px] text-muted-foreground">Se enviará como primer mensaje del chat con las sucursales consultadas.</p>
      </div>

      <Button type="submit" className="w-full" disabled={submitting || !selectedProducts.length || !allProductsHaveSource}>
        {submitting ? "Enviando..." : "Enviar Consulta"}
      </Button>
    </form>
  );
}

// ─── Response Form (for consulted branches) ─────────────────────
function TargetResponseForm({ target, onSuccess }: { target: any; onSuccess: () => void }) {
  const [quantity, setQuantity] = useState(target.response_quantity?.toString() || "");
  const [colors, setColors] = useState(target.response_colors || "");
  const [note, setNote] = useState(target.response_note || "");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("fn_respond_consultation_target", {
        p_target_id: target.id,
        p_quantity: quantity ? parseFloat(quantity) : null,
        p_colors: colors.trim() || null,
        p_note: note.trim() || null,
      });
      if (error) throw error;
      toast.success("Respuesta registrada");
      onSuccess();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
      <p className="text-xs font-semibold text-primary uppercase tracking-wider">Responder consulta</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Cantidad disponible</Label>
          <Input
            type="number"
            min="0"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="Ej: 15"
            className="h-9 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Colores disponibles</Label>
          <Input
            value={colors}
            onChange={(e) => setColors(e.target.value)}
            placeholder="Ej: Azul, Rojo"
            className="h-9 text-sm"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Nota</Label>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Observaciones..."
          rows={2}
          className="text-sm resize-none"
        />
      </div>
      <Button size="sm" onClick={handleSubmit} disabled={submitting} className="w-full">
        {submitting ? "Enviando..." : (target.responded_at ? "Actualizar respuesta" : "Responder consulta")}
      </Button>
    </div>
  );
}

// ─── Detail View ────────────────────────────────────────────────
function ConsultationDetail({ consultationId, onOrderCreated }: { consultationId: string; onOrderCreated: () => void }) {
  const { user, hasBranch } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [newMessage, setNewMessage] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["consultation-detail", consultationId] });
    queryClient.invalidateQueries({ queryKey: ["consultation-targets", consultationId] });
    queryClient.invalidateQueries({ queryKey: ["consultation-messages", consultationId] });
    queryClient.invalidateQueries({ queryKey: ["availability-consultations"] });
  };

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
        .select(`*, product:products(id, name, sku, bims_code, stock_by_warehouse, total_stock, image_url)`)
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

  const senderIds = [...new Set(messages?.map(m => m.sender_id) || [])];
  const { data: senderProfiles } = useQuery({
    queryKey: ["sender-profiles", senderIds.join(",")],
    queryFn: async () => {
      if (!senderIds.length) return [];
      const { data } = await supabase.from("profiles").select("user_id, full_name, default_branch_id").in("user_id", senderIds);
      return data || [];
    },
    enabled: senderIds.length > 0,
  });

  const { data: senderRoles } = useQuery({
    queryKey: ["sender-roles", senderIds.join(",")],
    queryFn: async () => {
      if (!senderIds.length) return [];
      const { data } = await supabase.from("user_roles").select("user_id, role").in("user_id", senderIds);
      return data || [];
    },
    enabled: senderIds.length > 0,
  });

  const { data: allBranches } = useBranches();

  const getSenderInfo = (senderId: string) => {
    const profile = senderProfiles?.find(p => p.user_id === senderId);
    const branch = profile?.default_branch_id ? allBranches?.find(b => b.id === profile.default_branch_id) : null;
    const roles = senderRoles?.filter(r => r.user_id === senderId).map(r => r.role) || [];
    const isAdmin = roles.some(r => ["admin", "supervisor", "owner"].includes(r));
    return {
      name: profile?.full_name || "Usuario",
      branch: branch?.name || null,
      isAdmin,
    };
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !user) return;
    setSendingMessage(true);
    try {
      const { error } = await supabase.from("consultation_messages").insert({
        consultation_id: consultationId,
        message: newMessage.trim(),
        sender_id: user.id,
      });
      if (error) throw error;
      setNewMessage("");
      queryClient.invalidateQueries({ queryKey: ["consultation-messages", consultationId] });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSendingMessage(false);
    }
  };

  const closeConsultation = async () => {
    try {
      const { error } = await supabase.from("availability_consultations").update({ status: "converted" as any }).eq("id", consultationId);
      if (error) throw error;
      toast.success("Consulta marcada como convertida");
      invalidateAll();
      onOrderCreated();
    } catch (err: any) { toast.error(err.message); }
  };

  if (!consultation) return <div className="p-4 text-muted-foreground">Cargando...</div>;
  const c = consultation as any;
  const isActive = c.status === "open" || c.status === "responded";
  const isCreator = c.created_by === user?.id;

  // Determine which targets the current user can respond to
  const myRespondableTargets = targets?.filter((t: any) =>
    !t.responded_at && hasBranch(t.branch_id)
  ) || [];
  const myRespondedTargets = targets?.filter((t: any) =>
    t.responded_at && hasBranch(t.branch_id)
  ) || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg font-bold">Consulta de disponibilidad</h3>
          <p className="text-sm text-muted-foreground">
            Solicitante: <strong>{c.requesting_branch?.name}</strong> ({c.requesting_branch?.code})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={c.status} config={STATUS_CONFIG} />
          {isActive && isCreator && (
            <Button size="sm" variant="outline" onClick={closeConsultation} className="text-xs">Cerrar consulta</Button>
          )}
        </div>
      </div>

      {/* Products */}
      <div>
        <h4 className="font-display font-semibold mb-2">Productos consultados</h4>
        <div className="space-y-1">
          {consultationProducts?.map((cp: any) => (
            <div key={cp.id} className="flex items-center gap-2 p-2 rounded bg-muted/30 text-sm">
              {cp.product?.image_url && (
                <img src={proxyImageUrl(cp.product.image_url)} alt={cp.product?.name} className="h-8 w-8 rounded object-cover shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              )}
              <span className="font-medium">{cp.product?.name}</span>
              <span className="text-muted-foreground text-xs">({cp.product?.sku})</span>
              {cp.product?.total_stock != null && (
                <Badge variant={cp.product.total_stock > 0 ? "default" : "destructive"} className="text-xs ml-auto">
                  Stock: {Math.floor(cp.product.total_stock)}
                </Badge>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Branch Responses */}
      <div>
        <h4 className="font-display font-semibold mb-3">Respuestas de sucursales</h4>
        <div className="space-y-3">
          {targets?.map((t: any) => {
            const canRespond = isActive && hasBranch(t.branch_id);
            const showForm = canRespond && !t.responded_at;
            const showEditForm = canRespond && t.responded_at;

            return (
              <div key={t.id} className="rounded-lg border border-border/30 overflow-hidden">
                <div className="flex items-center gap-3 p-3 bg-muted/30 text-sm">
                  <span className="font-semibold min-w-[80px]">{t.branch?.name}</span>
                  <span className="text-xs text-muted-foreground">({t.branch?.code})</span>
                  {t.responded_at ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-accent" />
                      <span>Cant: <strong>{t.response_quantity ?? "—"}</strong></span>
                      {t.response_colors && <span className="text-muted-foreground">Colores: {t.response_colors}</span>}
                      {t.response_note && <span className="text-muted-foreground italic truncate max-w-[200px]">"{t.response_note}"</span>}
                    </>
                  ) : (
                    <span className="text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Sin respuesta</span>
                  )}
                </div>
                {/* Response form for the user's branch */}
                {(showForm || showEditForm) && (
                  <div className="border-t border-border/30">
                    <TargetResponseForm target={t} onSuccess={invalidateAll} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Chat */}
      <div>
        <h4 className="font-display font-semibold mb-3 flex items-center gap-2">
          <MessageCircle className="h-4 w-4" /> Chat
        </h4>
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="max-h-[250px] overflow-y-auto p-3 space-y-2 bg-muted/10">
            {!messages?.length ? (
              <p className="text-sm text-muted-foreground text-center py-4">Sin mensajes aún. Iniciá la conversación.</p>
            ) : (
              messages.map((m: any) => {
                const sender = getSenderInfo(m.sender_id);
                const isMe = m.sender_id === user?.id;
                return (
                  <div key={m.id} className={cn("flex flex-col gap-0.5 max-w-[85%]", isMe ? "ml-auto items-end" : "items-start")}>
                    <div className={cn(
                      "px-3 py-2 rounded-lg text-sm",
                      isMe ? "bg-primary text-primary-foreground" : "bg-muted"
                    )}>
                      <p>{m.message}</p>
                    </div>
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <span className="font-medium">{sender.name}</span>
                      {sender.isAdmin && <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 leading-none">Admin</Badge>}
                      {sender.branch && <span>• {sender.branch}</span>}
                      <span>• {new Date(m.created_at).toLocaleString("es-PY", { hour: "2-digit", minute: "2-digit" })}</span>
                    </p>
                  </div>
                );
              })
            )}
          </div>
          {isActive && (
            <div className="p-2 border-t border-border flex items-center gap-2 bg-background">
              <Input
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Escribí un mensaje..."
                className="flex-1 h-9 text-sm"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
              />
              <Button type="button" size="sm" onClick={handleSendMessage} disabled={sendingMessage || !newMessage.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Linked orders */}
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

      {/* Create order button */}
      {isActive && (
        <div>
          <Button
            className="w-full gap-2"
            onClick={() => navigate(`/solicitudes?from_consultation=${consultationId}`)}
          >
            <ShoppingCart className="h-4 w-4" />
            Crear pedido desde esta consulta
          </Button>
        </div>
      )}
    </div>
  );
}
