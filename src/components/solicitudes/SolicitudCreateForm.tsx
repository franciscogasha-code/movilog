import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ProductSearch, type ProductResult } from "@/components/shared/ProductSearch";
import { ProductCard } from "@/components/shared/ProductCard";
import { BranchSelector, useAutoDetectBranch } from "@/components/shared/BranchSelector";
import { useBranches } from "@/hooks/use-branches";
import { useLiveStock, revalidateLiveStock } from "@/hooks/use-live-stock";
import { Plus, Trash2, Package, ChevronDown, ChevronUp, AlertTriangle, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { ContextBanner } from "./ContextBanner";
import { DemandAlert } from "./DemandAlert";
import {
  type RequestType,
  type DeliveryTarget,
  type ShippingMethod,
  getOriginMode,
  getAllowedDeliveryTargets,
  shouldShowClientFields,
  validateShippingMethod,
} from "@/lib/business-rules";

// ShippingMethod imported from business-rules

interface SelectedItem {
  product: ProductResult;
  quantity: number;
  sourceBranchId?: string;
}

export function SolicitudCreateForm({ onSuccess, fromConsultationId }: { onSuccess: () => void; fromConsultationId?: string | null }) {
  const { user } = useAuth();
  const { defaultBranchId, canChangeBranch } = useAutoDetectBranch();
  const { data: branches } = useBranches();

  // Step 1: Context
  const [requestingBranchId, setRequestingBranchId] = useState("");
  const [requestType, setRequestType] = useState<RequestType>("reposition");
  const [deliveryTarget, setDeliveryTarget] = useState<DeliveryTarget>("branch");

  // Step 2: Products
  const [items, setItems] = useState<SelectedItem[]>([]);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);

  // Step 3: Origin — single source (mono-origin mode only)
  const [sourceBranchId, setSourceBranchId] = useState("");

  // Step 4: Logistics
  const [shippingMethod, setShippingMethod] = useState<ShippingMethod>("own_fleet");
  const [clientName, setClientName] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [deliveryPaidBy, setDeliveryPaidBy] = useState<"company" | "client">("company");
  const [shippingAmount, setShippingAmount] = useState<string>("");
  const [courierBillingMode, setCourierBillingMode] = useState<"on_invoice" | "collect_at_destination">("on_invoice");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [revalidating, setRevalidating] = useState(false);

  // Derived from business rules matrix
  const originMode = getOriginMode(requestType, deliveryTarget);
  const isMultiOrigin = originMode === "multi";
  const allowedTargets = getAllowedDeliveryTargets(requestType);
  const showClientFieldsFlag = shouldShowClientFields(requestType, deliveryTarget);
  const showDeliveryPaidBy = shippingMethod === "delivery";
  const showCourierBilling = shippingMethod === "courier";
  const showShippingAmount = shippingMethod === "delivery" || (shippingMethod === "courier" && courierBillingMode === "on_invoice");
  const shippingError = validateShippingMethod(requestType, deliveryTarget, shippingMethod);

  // Auto-detect branch
  useEffect(() => {
    if (defaultBranchId && !requestingBranchId) setRequestingBranchId(defaultBranchId);
  }, [defaultBranchId, requestingBranchId]);

  // Business rules: enforce allowed delivery targets
  useEffect(() => {
    if (!allowedTargets.includes(deliveryTarget)) {
      setDeliveryTarget(allowedTargets[0]);
    }
  }, [requestType]);

  // Clear client fields when not needed
  useEffect(() => {
    if (!showClientFieldsFlag) {
      setClientName("");
      setClientAddress("");
    }
  }, [showClientFieldsFlag]);

  // When switching from multi to mono, clear per-product sources
  useEffect(() => {
    if (!isMultiOrigin) {
      setItems(prev => prev.map(i => ({ ...i, sourceBranchId: undefined })));
    } else {
      setSourceBranchId("");
    }
  }, [isMultiOrigin]);

  // ─── Pre-load consultation data ───────────────────────────────
  const consultationLoaded = useRef(false);
  const { data: consultationData } = useQuery({
    queryKey: ["consultation-preload", fromConsultationId],
    queryFn: async () => {
      if (!fromConsultationId) return null;
      const [consRes, cpRes, ctRes] = await Promise.all([
        supabase.from("availability_consultations")
          .select("requesting_branch_id")
          .eq("id", fromConsultationId).single(),
        supabase.from("consultation_products")
          .select("product:products(*)")
          .eq("consultation_id", fromConsultationId),
        supabase.from("consultation_targets")
          .select("branch_id, response_quantity, response_colors, response_note, responded_at, branch:branches(name, code)")
          .eq("consultation_id", fromConsultationId),
      ]);
      return {
        consultation: consRes.data,
        products: cpRes.data,
        targets: ctRes.data,
      };
    },
    enabled: !!fromConsultationId,
  });

  useEffect(() => {
    if (!consultationData || consultationLoaded.current) return;
    consultationLoaded.current = true;

    // Set requesting branch
    if (consultationData.consultation?.requesting_branch_id) {
      setRequestingBranchId(consultationData.consultation.requesting_branch_id);
    }

    // Add products with suggested quantities from responses
    if (consultationData.products?.length) {
      const respondedTargets = consultationData.targets?.filter((t: any) => t.responded_at) || [];
      const newItems: SelectedItem[] = consultationData.products.map((cp: any) => {
        // Use max responded quantity as suggested
        const maxQty = respondedTargets.reduce((max: number, t: any) => {
          return t.response_quantity ? Math.max(max, t.response_quantity) : max;
        }, 1);
        return {
          product: cp.product as ProductResult,
          quantity: maxQty,
        };
      });
      setItems(newItems);
    }
  }, [consultationData]);

  // Live stock from BIMS
  const bimsCodes = items.map(i => i.product.bims_code).filter(Boolean) as string[];
  const { liveStock, isLive } = useLiveStock(bimsCodes);

  // Helper to get effective stock for an item
  const getEffectiveStock = (product: ProductResult) => {
    if (isLive && product.bims_code && liveStock?.[product.bims_code]) {
      return liveStock[product.bims_code];
    }
    return null;
  };

  const addProduct = (product: ProductResult) => {
    if (items.find(i => i.product.id === product.id)) {
      toast.info("Producto ya agregado");
      return;
    }
    let autoSource: string | undefined;
    const sbw = product.stock_by_warehouse;
    if (isMultiOrigin && sbw && typeof sbw === "object") {
      let maxQty = 0;
      let maxWhId = "";
      for (const [whId, qty] of Object.entries(sbw)) {
        if ((qty as number) > maxQty) { maxQty = qty as number; maxWhId = whId; }
      }
      if (maxWhId) {
        const branch = branches?.find(b => b.code === maxWhId);
        if (branch) autoSource = branch.id;
      }
    }
    setItems(prev => [...prev, { product, quantity: 1, sourceBranchId: autoSource }]);
    setExpandedProduct(product.id);
  };

  const removeProduct = (productId: string) => {
    setItems(prev => prev.filter(i => i.product.id !== productId));
    if (expandedProduct === productId) setExpandedProduct(null);
  };

  const updateQuantity = (productId: string, qty: number) => {
    setItems(prev => prev.map(i => i.product.id === productId ? { ...i, quantity: Math.max(1, qty) } : i));
  };

  const setItemSourceBranch = (productId: string, branchId: string) => {
    setItems(prev => prev.map(i => i.product.id === productId ? { ...i, sourceBranchId: branchId } : i));
  };

  // Stock validation errors (uses live stock if available, otherwise local)
  const stockErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    for (const item of items) {
      const live = getEffectiveStock(item.product);
      const sbw = live?.stock_by_warehouse ?? item.product.stock_by_warehouse;
      if (!sbw) continue;

      if (isMultiOrigin && item.sourceBranchId) {
        const branchCode = branches?.find(b => b.id === item.sourceBranchId)?.code;
        if (branchCode) {
          const available = sbw[branchCode] ?? 0;
          if (available < item.quantity) {
            errors[item.product.id] = `Stock insuficiente en origen (disponible: ${Math.floor(available)}, solicitado: ${item.quantity})`;
          }
        }
      } else if (!isMultiOrigin && sourceBranchId) {
        const branchCode = branches?.find(b => b.id === sourceBranchId)?.code;
        if (branchCode) {
          const available = sbw[branchCode] ?? 0;
          if (available < item.quantity) {
            errors[item.product.id] = `Stock insuficiente (disponible: ${Math.floor(available)}, solicitado: ${item.quantity})`;
          }
        }
      }
    }
    return errors;
  }, [items, isMultiOrigin, sourceBranchId, branches, liveStock]);

  const hasStockErrors = Object.keys(stockErrors).length > 0;

  // Multi-origin summary
  const originSummary = useMemo(() => {
    if (!isMultiOrigin) return null;
    const grouped: Record<string, { branchName: string; count: number; products: string[] }> = {};
    items.forEach(item => {
      const bid = item.sourceBranchId;
      if (!bid) return;
      if (!grouped[bid]) {
        const branch = branches?.find(b => b.id === bid);
        grouped[bid] = { branchName: branch?.name || bid, count: 0, products: [] };
      }
      grouped[bid].count++;
      grouped[bid].products.push(item.product.name);
    });
    return grouped;
  }, [items, isMultiOrigin, branches]);

  const itemsWithoutSource = items.filter(i => !i.sourceBranchId);

  // Same-branch validation (mono-origin only; multi-origin children have different sources)
  const isSameBranch = !isMultiOrigin && !!sourceBranchId && sourceBranchId === requestingBranchId;

  // Validation
  const canSubmit = useMemo(() => {
    if (!requestingBranchId || !items.length) return false;
    if (hasStockErrors || shippingError) return false;
    if (isMultiOrigin) return items.every(i => !!i.sourceBranchId);
    if (!sourceBranchId || isSameBranch) return false;
    return true;
  }, [requestingBranchId, items, isMultiOrigin, sourceBranchId, hasStockErrors, shippingError, isSameBranch]);

  // Re-validate stock from BIMS live right before confirmation
  const revalidateStock = async (): Promise<Record<string, string>> => {
    const codes = items.map(i => i.product.bims_code).filter(Boolean) as string[];
    const freshData = await revalidateLiveStock(codes);
    const errors: Record<string, string> = {};

    for (const item of items) {
      const code = item.product.bims_code;
      const sbw = code && freshData[code]
        ? freshData[code].stock_by_warehouse
        : (item.product.stock_by_warehouse as Record<string, number> | null);
      if (!sbw) continue;

      const srcBid = isMultiOrigin ? item.sourceBranchId : sourceBranchId;
      if (!srcBid) continue;

      const branchCode = branches?.find(b => b.id === srcBid)?.code;
      if (branchCode) {
        const available = sbw[branchCode] ?? 0;
        if (available < item.quantity) {
          errors[item.product.id] = `Stock cambió: disponible ${Math.floor(available)}, solicitado ${item.quantity}`;
        }
      }
    }
    return errors;
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Show confirmation step first
    if (!showConfirmation && canSubmit) {
      setShowConfirmation(true);
      return;
    }

    if (!canSubmit) {
      if (isMultiOrigin && itemsWithoutSource.length > 0) {
        toast.error(`Falta asignar origen a ${itemsWithoutSource.length} producto(s)`);
      } else if (hasStockErrors) {
        toast.error("Hay productos con stock insuficiente en el origen seleccionado");
      } else {
        toast.error("Completar todos los campos obligatorios");
      }
      return;
    }

    setSubmitting(true);
    setRevalidating(true);

    try {
      // Revalidate stock before persisting
      const freshErrors = await revalidateStock();
      setRevalidating(false);

      if (Object.keys(freshErrors).length > 0) {
        const errorProducts = Object.keys(freshErrors).map(pid => {
          const item = items.find(i => i.product.id === pid);
          return item?.product.name || pid;
        });
        toast.error(`Stock insuficiente al confirmar: ${errorProducts.join(", ")}`);
        setShowConfirmation(false);
        setSubmitting(false);
        return;
      }

      if (!user) { toast.error("Debés iniciar sesión"); setSubmitting(false); return; }

      if (isMultiOrigin) {
        // Create parent request first
        const { data: parentRequest, error: parentErr } = await supabase
          .from("branch_requests")
          .insert({
            requesting_branch_id: requestingBranchId,
            source_branch_id: requestingBranchId, // placeholder for parent
            request_type: requestType as any,
            delivery_target: deliveryTarget as any,
            shipping_method: shippingMethod as any,
            delivery_payer: showDeliveryPaidBy ? deliveryPaidBy : null,
            shipping_cost: showShippingAmount && shippingAmount ? parseFloat(shippingAmount) : null,
            shipping_origin_paid: showDeliveryPaidBy && deliveryPaidBy === "company" && shippingAmount ? parseFloat(shippingAmount) : 0,
            shipping_destination_paid: showDeliveryPaidBy && deliveryPaidBy === "client" && shippingAmount ? parseFloat(shippingAmount) : 0,
            courier_billing_mode: showCourierBilling ? courierBillingMode : null,
            notes: notes ? `[Pedido padre multi-origen] ${notes}` : "[Pedido padre multi-origen]",
            created_by: user.id,
            status: "pending" as any,
          })
          .select()
          .single();
        if (parentErr) throw parentErr;

        // Group by source branch
        const bySource: Record<string, SelectedItem[]> = {};
        items.forEach(item => {
          const bid = item.sourceBranchId!;
          if (!bySource[bid]) bySource[bid] = [];
          bySource[bid].push(item);
        });

        const createdNumbers: number[] = [];
        const createdIds: string[] = [];

        try {
          for (const [srcBranch, srcItems] of Object.entries(bySource)) {
            const { data: request, error } = await supabase
              .from("branch_requests")
              .insert({
                requesting_branch_id: requestingBranchId,
                source_branch_id: srcBranch,
                parent_request_id: parentRequest.id,
                request_type: requestType as any,
                delivery_target: deliveryTarget as any,
                shipping_method: shippingMethod as any,
                delivery_payer: showDeliveryPaidBy ? deliveryPaidBy : null,
                shipping_cost: showShippingAmount && shippingAmount ? parseFloat(shippingAmount) : null,
                courier_billing_mode: showCourierBilling ? courierBillingMode : null,
                notes: notes || null,
                created_by: user.id,
              })
              .select()
              .single();
            if (error) throw error;

            createdIds.push(request.id);

            const itemsToInsert = srcItems.map((item) => ({
              request_id: request.id,
              product_id: item.product.id,
              quantity_requested: item.quantity,
              item_purpose: (requestType === "client" || requestType === "online" ? "client" : "reposition") as any,
            }));
            const { error: itemsError } = await supabase.from("branch_request_items").insert(itemsToInsert);
            if (itemsError) throw itemsError;

            createdNumbers.push(request.request_number);
          }
        } catch (childErr: any) {
          // Rollback: mark parent as rejected to avoid orphan state
          await supabase.from("branch_requests").update({
            status: "rejected" as any,
            rejection_reason: `Error al crear transferencias hijas: ${childErr.message}`,
            rejected_at: new Date().toISOString(),
          }).eq("id", parentRequest.id);

          // Mark any created children as rejected too
          if (createdIds.length > 0) {
            await supabase.from("branch_requests").update({
              status: "rejected" as any,
              rejection_reason: `Rollback por error en creación multi-origen`,
              rejected_at: new Date().toISOString(),
            }).in("id", createdIds);
          }

          throw new Error(`Error al crear transferencias: ${childErr.message}. El pedido fue cancelado.`);
        }

        toast.success(`Pedido #${parentRequest.request_number} creado con ${createdNumbers.length} transferencia(s): #${createdNumbers.join(", #")}`);

        // Link to consultation if created from one
        if (fromConsultationId) {
          await supabase.from("consultation_requests").insert({
            consultation_id: fromConsultationId,
            branch_request_id: parentRequest.id,
          });
          await supabase.from("availability_consultations")
            .update({ status: "converted" as any, updated_at: new Date().toISOString() })
            .eq("id", fromConsultationId);
        }
      } else {
        // Mono-origin: single request
        const { data: request, error } = await supabase
          .from("branch_requests")
          .insert({
            requesting_branch_id: requestingBranchId,
            source_branch_id: sourceBranchId,
            request_type: requestType as any,
            delivery_target: deliveryTarget as any,
            shipping_method: shippingMethod as any,
            client_name: showClientFieldsFlag ? (clientName || null) : null,
            client_address: showClientFieldsFlag ? (clientAddress || null) : null,
            delivery_payer: showDeliveryPaidBy ? deliveryPaidBy : null,
            shipping_cost: showShippingAmount && shippingAmount ? parseFloat(shippingAmount) : null,
            shipping_origin_paid: showDeliveryPaidBy && deliveryPaidBy === "company" && shippingAmount ? parseFloat(shippingAmount) : 0,
            shipping_destination_paid: showDeliveryPaidBy && deliveryPaidBy === "client" && shippingAmount ? parseFloat(shippingAmount) : 0,
            courier_billing_mode: showCourierBilling ? courierBillingMode : null,
            notes: notes || null,
            created_by: user.id,
          })
          .select()
          .single();
        if (error) throw error;

        const itemsToInsert = items.map((item) => ({
          request_id: request.id,
          product_id: item.product.id,
          quantity_requested: item.quantity,
          item_purpose: (requestType === "client" || requestType === "online" ? "client" : "reposition") as any,
          client_name: showClientFieldsFlag ? (clientName || null) : null,
          client_address: showClientFieldsFlag ? (clientAddress || null) : null,
        }));
        const { error: itemsError } = await supabase.from("branch_request_items").insert(itemsToInsert);
        if (itemsError) throw itemsError;

        toast.success(`Pedido #${request.request_number} creado`);

        // Link to consultation if created from one
        if (fromConsultationId) {
          await supabase.from("consultation_requests").insert({
            consultation_id: fromConsultationId,
            branch_request_id: request.id,
          });
          // Mark consultation as converted
          await supabase.from("availability_consultations")
            .update({ status: "converted" as any, updated_at: new Date().toISOString() })
            .eq("id", fromConsultationId);
        }
      }

      onSuccess();
    } catch (err: any) {
      toast.error(err.message || "Error al crear pedido");
    } finally {
      setSubmitting(false);
      setRevalidating(false);
      setShowConfirmation(false);
    }
  };

  // Confirmation summary view
  if (showConfirmation) {
    return (
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Confirmar pedido</h3>
        <ContextBanner requestType={requestType} deliveryTarget={deliveryTarget} />

        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Productos</h4>
          {items.map(item => (
            <div key={item.product.id} className="flex items-center justify-between p-2 rounded bg-muted/30 border border-border/30 text-sm">
              <div className="flex-1 min-w-0">
                <span className="font-medium truncate">{item.product.name}</span>
                <span className="text-muted-foreground ml-2">x{item.quantity}</span>
              </div>
              <span className="text-xs text-muted-foreground">
                {isMultiOrigin
                  ? `Origen: ${branches?.find(b => b.id === item.sourceBranchId)?.name || "—"}`
                  : `Origen: ${branches?.find(b => b.id === sourceBranchId)?.name || "—"}`
                }
              </span>
            </div>
          ))}
        </div>

        {isMultiOrigin && originSummary && Object.keys(originSummary).length > 0 && (
          <div className="p-3 rounded-lg bg-muted/50 border border-border/50 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Resumen de abastecimiento</p>
            {Object.entries(originSummary).map(([bid, info]) => (
              <div key={bid} className="flex items-center justify-between text-sm">
                <span className="font-medium">{info.branchName}</span>
                <Badge variant="outline" className="text-xs">{info.count} producto(s)</Badge>
              </div>
            ))}
            <p className="text-xs text-muted-foreground mt-1 pt-2 border-t border-border/30">
              Se crearán <strong>{Object.keys(originSummary).length}</strong> transferencia(s) internas + 1 pedido padre.
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => setShowConfirmation(false)}>
            Volver a editar
          </Button>
          <Button className="flex-1" onClick={onSubmit} disabled={submitting}>
            {revalidating ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" />Verificando stock...</>
            ) : submitting ? (
              "Creando..."
            ) : (
              "Confirmar pedido"
            )}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* Context Banner */}
      <ContextBanner requestType={requestType} deliveryTarget={deliveryTarget} />

      {/* STEP 1: Context */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">1. Contexto</h3>
        <div className="grid grid-cols-2 gap-4">
          <BranchSelector
            label="Sucursal solicitante"
            value={requestingBranchId}
            onChange={setRequestingBranchId}
            disabled={!canChangeBranch && !!defaultBranchId}
          />
          <div className="space-y-2">
            <Label>Tipo de solicitud</Label>
            <select
              value={requestType}
              onChange={(e) => setRequestType(e.target.value as RequestType)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="reposition">Reposición</option>
              <option value="client">Pedido Cliente</option>
              <option value="online">Pedido Online</option>
            </select>
          </div>
        </div>

        {/* Delivery target */}
        {allowedTargets.length > 1 && (
          <div className="space-y-2">
            <Label>Destino de entrega</Label>
            <select
              value={deliveryTarget}
              onChange={(e) => setDeliveryTarget(e.target.value as DeliveryTarget)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {allowedTargets.map(t => (
                <option key={t} value={t}>{t === "branch" ? "A sucursal" : "A cliente"}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* STEP 2: Products */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">2. Productos</h3>
        <ProductSearch onSelect={addProduct} excludeIds={items.map(i => i.product.id)} />

        {items.length > 0 ? (
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.product.id} className="border border-border rounded-lg overflow-hidden">
                <div className="flex items-center gap-3 p-3 bg-muted/30">
                  <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.product.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.product.sku && `SKU: ${item.product.sku}`}
                      {item.product.bims_code && ` • Cód: ${item.product.bims_code}`}
                      {isMultiOrigin && item.sourceBranchId && (
                        <span className="ml-1 text-primary">
                          • Origen: {branches?.find(b => b.id === item.sourceBranchId)?.name || "—"}
                        </span>
                      )}
                      {isMultiOrigin && !item.sourceBranchId && (
                        <span className="ml-1 text-amber-500">• Sin origen asignado</span>
                      )}
                    </p>
                    {stockErrors[item.product.id] && (
                      <p className="text-xs text-destructive flex items-center gap-1 mt-0.5">
                        <XCircle className="h-3 w-3" /> {stockErrors[item.product.id]}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs shrink-0">Cant:</Label>
                    <Input
                      type="number" min={1} value={item.quantity}
                      onChange={(e) => updateQuantity(item.product.id, parseInt(e.target.value) || 1)}
                      className="w-20 h-8 text-sm"
                    />
                    <Button type="button" variant="ghost" size="sm"
                      onClick={() => setExpandedProduct(expandedProduct === item.product.id ? null : item.product.id)}>
                      {expandedProduct === item.product.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeProduct(item.product.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>

                {expandedProduct === item.product.id && (
                  <div className="p-3 border-t border-border/50 space-y-2">
                    <DemandAlert productId={item.product.id} />
                    <ProductCard
                      productId={item.product.id}
                      productName={item.product.name}
                      productSku={item.product.sku}
                      productBimsCode={item.product.bims_code}
                      productBarcode={item.product.barcode}
                      productCategory={item.product.category}
                      productUnit={item.product.unit}
                      productDescription={item.product.description}
                      productImageUrl={item.product.image_url}
                      productSellPrice={item.product.sell_price}
                      productPriceScales={item.product.price_scales as { min_quantity: number; price: number }[] | undefined}
                      productPriceLists={item.product.price_lists as { name: string; amount: number }[] | undefined}
                      productStockByWarehouse={item.product.stock_by_warehouse as Record<string, number> | undefined}
                      productTotalStock={item.product.total_stock}
                      stockMode="select_source"
                      onSelectSourceBranch={(bid) => {
                        if (isMultiOrigin) {
                          setItemSourceBranch(item.product.id, bid);
                        } else {
                          // Mono-origin: selecting source from any product sets the global source
                          setSourceBranchId(bid);
                        }
                      }}
                      selectedSourceBranchId={isMultiOrigin ? item.sourceBranchId : sourceBranchId}
                      requiredQuantity={item.quantity}
                      compact={false}
                      liveStock={getEffectiveStock(item.product)}
                      isLive={isLive}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center p-6 rounded-lg border border-dashed border-border text-muted-foreground text-sm">
            <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
            Buscá y agregá productos usando el buscador
          </div>
        )}
      </div>

      {/* STEP 3: Origin */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">3. Origen del stock</h3>

        {isMultiOrigin ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Seleccioná la sucursal origen desde la ficha de cada producto. Se creará una transferencia por cada sucursal origen.
            </p>

            {itemsWithoutSource.length > 0 && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-foreground">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                <span>{itemsWithoutSource.length} producto(s) sin origen asignado</span>
              </div>
            )}

            {originSummary && Object.keys(originSummary).length > 0 && (
              <div className="p-3 rounded-lg bg-muted/50 border border-border/50 space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Resumen de abastecimiento</p>
                {Object.entries(originSummary).map(([bid, info]) => (
                  <div key={bid} className="flex items-center justify-between text-sm">
                    <span className="font-medium">{info.branchName}</span>
                    <Badge variant="outline" className="text-xs">{info.count} producto(s)</Badge>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground mt-1 pt-2 border-t border-border/30">
                  Se crearán {Object.keys(originSummary).length} transferencia(s) internas asociadas a esta solicitud.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div>
            {sourceBranchId ? (
              <div className="p-3 rounded-lg bg-muted/50 border border-border/50">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Origen seleccionado</p>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm">{branches?.find(b => b.id === sourceBranchId)?.name || "—"}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setSourceBranchId("")} className="text-xs text-muted-foreground h-7">
                    Cambiar
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Seleccionado desde la ficha de producto. Todo el pedido sale de esta sucursal.
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-foreground">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                <span>Seleccioná la sucursal origen desde el bloque de stock de cualquier producto (paso 2).</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* STEP 4: Logistics */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">4. Logística</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Método de envío</Label>
            <select
              value={shippingMethod}
              onChange={(e) => setShippingMethod(e.target.value as ShippingMethod)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="own_fleet">Flota propia</option>
              <option value="courier">Encomienda</option>
              <option value="pickup">Retiro en sucursal</option>
              <option value="delivery">Delivery</option>
            </select>
          </div>
        </div>

        {showDeliveryPaidBy && (
          <div className="space-y-2 p-3 rounded-lg bg-muted/50 border border-border/50">
            <Label>¿Quién paga el delivery?</Label>
            <div className="flex gap-3">
              <Badge variant={deliveryPaidBy === "company" ? "default" : "outline"} className="cursor-pointer" onClick={() => setDeliveryPaidBy("company")}>
                Empresa paga
              </Badge>
              <Badge variant={deliveryPaidBy === "client" ? "default" : "outline"} className="cursor-pointer" onClick={() => setDeliveryPaidBy("client")}>
                Cliente paga
              </Badge>
            </div>
          </div>
        )}

        {showCourierBilling && (
          <div className="space-y-2 p-3 rounded-lg bg-muted/50 border border-border/50">
            <Label>Modalidad de cobro de encomienda</Label>
            <div className="flex gap-3">
              <Badge variant={courierBillingMode === "on_invoice" ? "default" : "outline"} className="cursor-pointer" onClick={() => setCourierBillingMode("on_invoice")}>
                En factura
              </Badge>
              <Badge variant={courierBillingMode === "collect_at_destination" ? "default" : "outline"} className="cursor-pointer" onClick={() => setCourierBillingMode("collect_at_destination")}>
                Cobro en destino
              </Badge>
            </div>
          </div>
        )}

        {showShippingAmount && (
          <div className="space-y-2 p-3 rounded-lg bg-muted/50 border border-border/50">
            <Label>Monto de envío (Gs.)</Label>
            <Input
              type="number"
              min={0}
              value={shippingAmount}
              onChange={(e) => setShippingAmount(e.target.value)}
              placeholder="Ingresá el monto del envío"
            />
          </div>
        )}

        {showClientFieldsFlag && (
          <div className="grid grid-cols-2 gap-4 p-3 rounded-lg bg-muted/50 border border-border/50">
            <div className="space-y-2">
              <Label>Cliente (nombre)</Label>
              <Input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Nombre del cliente" />
            </div>
            <div className="space-y-2">
              <Label>Dirección de entrega</Label>
              <Input value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} placeholder="Dirección" />
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label>Notas</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observaciones adicionales..." rows={2} />
        </div>
      </div>

      {hasStockErrors && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
          <XCircle className="h-4 w-4 shrink-0" />
          <span>Hay productos con stock insuficiente. Corregí las cantidades o cambiá el origen antes de continuar.</span>
        </div>
      )}

      <Button type="submit" className="w-full" disabled={submitting || !canSubmit}>
        {submitting
          ? "Creando..."
          : isMultiOrigin
            ? `Revisar y crear ${Object.keys(originSummary || {}).length || 0} transferencia(s)`
            : `Revisar y crear pedido (${items.length} producto${items.length !== 1 ? "s" : ""})`
        }
      </Button>
    </form>
  );
}
