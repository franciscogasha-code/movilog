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
import { Plus, Trash2, Package, ChevronDown, ChevronUp, AlertTriangle, XCircle, Loader2, Split } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { ContextBanner, type EffectiveOriginMode } from "./ContextBanner";
import { DemandAlert } from "./DemandAlert";
import { SplitOriginPanel, type OriginSplit } from "./SplitOriginPanel";
import { LogisticsFieldsForm } from "./LogisticsFieldsForm";
import {
  type RequestType,
  type DeliveryTarget,
  type ShippingMethod,
  getOriginMode,
  getAllowedDeliveryTargets,
  shouldShowClientFields,
  validateShippingMethod,
} from "@/lib/business-rules";

/**
 * FormRequestType integra Pre-Venta Online como variante comercial del mismo
 * formulario de Nuevo Pedido. No crea operación logística hasta la conversión.
 */
export type FormRequestType = RequestType | "pre_sale_online";

const SALES_CHANNELS = [
  { v: "whatsapp", l: "WhatsApp" },
  { v: "ecommerce", l: "Ecommerce" },
  { v: "instagram", l: "Instagram" },
  { v: "tiktok", l: "TikTok" },
  { v: "facebook", l: "Facebook" },
  { v: "presencial", l: "Presencial" },
];

interface SelectedItem {
  product: ProductResult;
  quantity: number;
  sourceBranchId?: string;
  /** Distribución manual del usuario entre múltiples sucursales (opcional). Si está presente y suma == quantity, se usa como verdad. */
  splits?: OriginSplit[];
}

export function SolicitudCreateForm({
  onSuccess,
  fromConsultationId,
  editingPreSaleId,
  defaultRequestType = "reposition",
}: {
  onSuccess: () => void;
  fromConsultationId?: string | null;
  /** Si se pasa, el form arranca en modo edición de una pre-venta existente. */
  editingPreSaleId?: string | null;
  /** Tipo inicial seleccionado al abrir el formulario. */
  defaultRequestType?: FormRequestType;
}) {
  const { user } = useAuth();
  const { defaultBranchId, canChangeBranch } = useAutoDetectBranch();
  const { data: branches } = useBranches();

  // Step 1: Context
  const [requestingBranchId, setRequestingBranchId] = useState("");
  const [requestType, setRequestType] = useState<FormRequestType>(defaultRequestType);
  const [deliveryTarget, setDeliveryTarget] = useState<DeliveryTarget>("branch");

  // Step 2: Products
  const [items, setItems] = useState<SelectedItem[]>([]);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [splitPanelOpen, setSplitPanelOpen] = useState<string | null>(null);

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
  const [operationalResponsibleId, setOperationalResponsibleId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [revalidating, setRevalidating] = useState(false);

  // ── Pre-Venta: campos comerciales ─────────────────────────────
  const [salesChannel, setSalesChannel] = useState("whatsapp");
  const [clientPhone, setClientPhone] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [commercialTerms, setCommercialTerms] = useState("");
  const [loadingEdit, setLoadingEdit] = useState(!!editingPreSaleId);
  const [wasConfirmed, setWasConfirmed] = useState(false);

  const isPreSale = requestType === "pre_sale_online";

  // Derived from business rules matrix (solo aplica cuando NO es pre-venta).
  // Para pre-venta usamos defaults seguros que neutralizan la lógica logística.
  const operationalRequestType: RequestType = isPreSale ? "online" : (requestType as RequestType);
  const originMode = getOriginMode(operationalRequestType, deliveryTarget);
  const isMultiOrigin = !isPreSale && originMode === "multi";
  const allowedTargets = getAllowedDeliveryTargets(operationalRequestType);
  const showClientFieldsFlag = !isPreSale && shouldShowClientFields(operationalRequestType, deliveryTarget);
  const showDeliveryPaidBy = !isPreSale && shippingMethod === "delivery";
  const showCourierBilling = !isPreSale && shippingMethod === "courier";
  const showShippingAmount = !isPreSale && (shippingMethod === "delivery" || (shippingMethod === "courier" && courierBillingMode === "on_invoice"));
  const shippingError = isPreSale ? null : validateShippingMethod(operationalRequestType, deliveryTarget, shippingMethod);
  // Pre-venta es 100% comercial: nunca requiere dirección obligatoria ni método de envío.
  // El método logístico se define recién al convertir a pedido.
  const requiresPreSaleAddress = false;

  // Auto-detect branch
  useEffect(() => {
    if (defaultBranchId && !requestingBranchId) setRequestingBranchId(defaultBranchId);
  }, [defaultBranchId, requestingBranchId]);

  useEffect(() => {
    if (!isPreSale) return;
    setSourceBranchId("");
    setDeliveryTarget("branch");
    setOperationalResponsibleId("");
  }, [isPreSale]);

  // Business rules: enforce allowed delivery targets (no aplica a pre-venta)
  useEffect(() => {
    if (isPreSale) return;
    if (!allowedTargets.includes(deliveryTarget)) {
      setDeliveryTarget(allowedTargets[0]);
    }
  }, [requestType]);

  // Clear client fields when not needed (operacional). Pre-venta gestiona su propio set.
  useEffect(() => {
    if (isPreSale) return;
    if (!showClientFieldsFlag) {
      setClientName("");
      setClientAddress("");
    }
  }, [showClientFieldsFlag, isPreSale]);

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

  // Query operational profiles (for online requests), filtered by branch context
  const { data: operationalProfiles } = useQuery({
    queryKey: ["operational-profiles", requestingBranchId],
    queryFn: async () => {
      // Get profiles with operational roles
      const { data: roleData } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("role", ["supervisor", "warehouse_operator"] as any[]);
      if (!roleData?.length) return [];
      const userIds = [...new Set(roleData.map(r => r.user_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, user_id, full_name, all_branches_access")
        .eq("is_active", true)
        .in("user_id", userIds);
      if (!profiles?.length) return [];

      // Filter: only users with access to the requesting branch
      if (!requestingBranchId) return profiles;
      const { data: branchAccess } = await supabase
        .from("profile_branch_access")
        .select("profile_id")
        .eq("branch_id", requestingBranchId);
      const profileIdsWithAccess = new Set((branchAccess || []).map(ba => ba.profile_id));

      return profiles.filter(p =>
        p.all_branches_access || profileIdsWithAccess.has(p.id)
      );
    },
    enabled: requestType === "online",
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

  useEffect(() => {
    if (!editingPreSaleId) return;
    let mounted = true;
    (async () => {
      try {
        const { data: req, error } = await supabase
          .from("branch_requests")
          .select("*")
          .eq("id", editingPreSaleId)
          .eq("is_pre_sale", true)
          .single();
        if (error) throw error;
        if (!mounted) return;

        setRequestType("pre_sale_online");
        setRequestingBranchId(req.requesting_branch_id);
        setDeliveryTarget((req.delivery_target as DeliveryTarget) ?? "branch");
        setShippingMethod(req.shipping_method as ShippingMethod);
        setClientName(req.client_name ?? "");
        setClientAddress(req.client_address ?? "");
        setSalesChannel((req as any).sales_channel ?? "whatsapp");
        setClientPhone((req as any).client_phone ?? "");
        setClientEmail((req as any).client_email ?? "");
        setNotes(req.notes ?? "");
        setCommercialTerms(((req as any).commercial_terms ?? "") || "");
        setWasConfirmed(((req as any).pre_sale_status ?? "draft") === "confirmed");

        const { data: loadedItems, error: itemsError } = await supabase
          .from("branch_request_items")
          .select("*, product:products(*)")
          .eq("request_id", editingPreSaleId);
        if (itemsError) throw itemsError;
        if (!mounted) return;
        setItems((loadedItems ?? []).map((it: any) => ({
          product: it.product as ProductResult,
          quantity: Number(it.quantity_requested) || 1,
        })));
      } catch (err: any) {
        toast.error(`No se pudo cargar la pre-venta: ${err.message}`);
      } finally {
        if (mounted) setLoadingEdit(false);
      }
    })();
    return () => { mounted = false; };
  }, [editingPreSaleId]);

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
      // Resaltar/expandir el existente para que el usuario lo vea inmediato
      setExpandedProduct(product.id);
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
    // El último producto agregado se muestra ARRIBA para que sea inmediatamente visible
    // sin necesidad de bajar el scroll en mobile.
    setItems(prev => [{ product, quantity: 1, sourceBranchId: autoSource }, ...prev]);
    setExpandedProduct(product.id);
  };

  const removeProduct = (productId: string) => {
    setItems(prev => prev.filter(i => i.product.id !== productId));
    if (expandedProduct === productId) setExpandedProduct(null);
  };

  const updateQuantity = (productId: string, qty: number) => {
    setItems(prev => prev.map(i => {
      if (i.product.id !== productId) return i;
      const newQty = Math.max(1, qty);
      // Si tenía splits y la cantidad cambia, los splits quedan inconsistentes:
      // los preservamos pero su suma ya no coincidirá → itemHasValidSplits() retornará false
      // y el CTA quedará bloqueado. La UI mostrará un aviso para revisar.
      return { ...i, quantity: newQty };
    }));
  };

  const setItemSourceBranch = (productId: string, branchId: string) => {
    setItems(prev => prev.map(i => i.product.id === productId ? { ...i, sourceBranchId: branchId } : i));
  };

  const setItemSplits = (productId: string, splits: OriginSplit[]) => {
    setItems(prev => prev.map(i => i.product.id === productId ? { ...i, splits } : i));
  };

  // ¿El item tiene splits "tocados" (al menos 1 entrada) pero inválidos / incompletos?
  const itemHasDirtySplits = (item: SelectedItem): boolean => {
    if (!item.splits || item.splits.length === 0) return false;
    return !itemHasValidSplits(item);
  };

  // Stock por código de sucursal (live > local) para un producto.
  const getStockByCode = (product: ProductResult): Record<string, number> | null => {
    const live = getEffectiveStock(product);
    const sbw = (live?.stock_by_warehouse ?? product.stock_by_warehouse) as Record<string, number> | null | undefined;
    return sbw ?? null;
  };

  // ¿El item tiene splits válidos (>=2 sucursales con cantidad y suma == quantity)?
  const itemHasValidSplits = (item: SelectedItem): boolean => {
    if (!item.splits || item.splits.length < 2) return false;
    const cleaned = item.splits.filter(s => s.branchId && s.quantity > 0);
    if (cleaned.length < 2) return false;
    const sum = cleaned.reduce((a, b) => a + b.quantity, 0);
    return sum === item.quantity;
  };

  // Modo de origen efectivo basado en estado real, NO en la matriz fija.
  const effectiveOriginMode: EffectiveOriginMode = useMemo(() => {
    if (!items.length) return "undefined";
    // Si algún item tiene splits válidos -> multi
    if (items.some(itemHasValidSplits)) return "multi";
    // Recolectar orígenes asignados (de sourceBranchId individual o global)
    const sources = new Set<string>();
    for (const it of items) {
      if (it.sourceBranchId) sources.add(it.sourceBranchId);
    }
    if (sourceBranchId) sources.add(sourceBranchId);
    if (sources.size === 0) return "undefined";
    if (sources.size === 1) return "single";
    return "multi";
  }, [items, sourceBranchId]);

  // Stock validation errors (uses live stock if available, otherwise local)
  // Si el item tiene splits VÁLIDOS, validamos cada tramo del split (no el sourceBranchId viejo).
  const stockErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    for (const item of items) {
      const live = getEffectiveStock(item.product);
      const sbw = live?.stock_by_warehouse ?? item.product.stock_by_warehouse;
      if (isPreSale) {
        const total = live?.total_stock ?? item.product.total_stock;
        if (total != null && total < item.quantity) {
          errors[item.product.id] = `Stock insuficiente. Esta pre-venta no reserva stock.`;
        }
        continue;
      }
      if (!sbw) continue;

      // Caso A: splits válidos → validar cada tramo
      if (itemHasValidSplits(item)) {
        for (const sp of item.splits!) {
          const branchCode = branches?.find(b => b.id === sp.branchId)?.code;
          if (!branchCode) continue;
          const available = sbw[branchCode] ?? 0;
          if (available < sp.quantity) {
            const bName = branches?.find(b => b.id === sp.branchId)?.name || branchCode;
            errors[item.product.id] = `Stock insuficiente en ${bName} (disp: ${Math.floor(available)}, asignado: ${sp.quantity})`;
            break;
          }
        }
        continue;
      }

      // Caso B: sin splits → validar contra origen único (multi por item, o global mono)
      const srcId = isMultiOrigin ? item.sourceBranchId : sourceBranchId;
      if (!srcId) continue;
      const branchCode = branches?.find(b => b.id === srcId)?.code;
      if (!branchCode) continue;
      const available = sbw[branchCode] ?? 0;
      if (available < item.quantity) {
        errors[item.product.id] = `Stock insuficiente en origen (disponible: ${Math.floor(available)}, solicitado: ${item.quantity})`;
      }
    }
    return errors;
  }, [items, isPreSale, isMultiOrigin, sourceBranchId, branches, liveStock]);

  const hasStockErrors = Object.keys(stockErrors).length > 0;

  // Resumen de abastecimiento — lee splits reales y agrupa por sucursal con cantidades.
  // Se calcula SIEMPRE (no solo en multi fijo), porque el modo efectivo depende del estado real.
  const originSummary = useMemo(() => {
    const grouped: Record<string, { branchName: string; totalQty: number; products: { name: string; qty: number }[] }> = {};
    const addEntry = (bid: string, productName: string, qty: number) => {
      if (!grouped[bid]) {
        const branch = branches?.find(b => b.id === bid);
        grouped[bid] = { branchName: branch?.name || bid, totalQty: 0, products: [] };
      }
      grouped[bid].totalQty += qty;
      grouped[bid].products.push({ name: productName, qty });
    };
    items.forEach(item => {
      if (itemHasValidSplits(item)) {
        for (const sp of item.splits!) {
          if (sp.branchId && sp.quantity > 0) addEntry(sp.branchId, item.product.name, sp.quantity);
        }
      } else {
        const bid = item.sourceBranchId || sourceBranchId;
        if (bid) addEntry(bid, item.product.name, item.quantity);
      }
    });
    return grouped;
  }, [items, sourceBranchId, branches]);

  // Un item está "resuelto" si: tiene splits válidos, o sourceBranchId asignado, o estamos en mono y hay sourceBranchId global.
  const isItemResolved = (item: SelectedItem): boolean => {
    if (itemHasValidSplits(item)) return true;
    if (item.sourceBranchId && item.sourceBranchId !== requestingBranchId) return true;
    if (!isMultiOrigin && sourceBranchId && sourceBranchId !== requestingBranchId) return true;
    return false;
  };

  const itemsWithoutSource = items.filter(i => !isItemResolved(i));

  // Same-branch validation (mono-origin only; multi-origin children have different sources)
  // Exception: online + client allows same branch (direct sale from own stock)
  const isSameBranch = !isMultiOrigin && !!sourceBranchId && sourceBranchId === requestingBranchId
    && !(requestType === "online" && deliveryTarget === "client");

  // Validation
  const canSubmit = useMemo(() => {
    if (!items.length) return false;
    if (isPreSale) {
      // Pre-Venta: solo requiere cliente, teléfono y al menos un producto.
      if (!clientName.trim() || !clientPhone.trim()) return false;
      return true;
    }
    if (!requestingBranchId) return false;
    if (hasStockErrors || shippingError) return false;
    // Cada item debe estar resuelto (splits válidos, origen propio, o origen global mono)
    if (!items.every(isItemResolved)) return false;
    if (isSameBranch) return false;
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestingBranchId, items, isPreSale, clientName, clientPhone, clientAddress, requiresPreSaleAddress, isMultiOrigin, sourceBranchId, hasStockErrors, shippingError, isSameBranch]);

  const savePreSale = async () => {
    if (!user) { toast.error("Debés iniciar sesión"); return; }
    if (!clientName.trim() || !clientPhone.trim()) {
      toast.error("Completá nombre y teléfono del cliente");
      return;
    }
    if (!items.length) {
      toast.error("Agregá al menos un producto");
      return;
    }
    if (commercialTerms.trim().length > 1500) {
      toast.error("Las condiciones comerciales no pueden superar 1500 caracteres.");
      return;
    }

    // Pre-venta NO tiene sucursal "vendedora" ni lógica logística.
    // requesting_branch_id se conserva (default del perfil o primera permitida) sólo
    // para RLS/visibilidad; el resto de campos logísticos van NULL y los completa la
    // promoción a operación (fn_send_presale_to_operation).
    const ownerBranch = requestingBranchId || defaultBranchId || branches?.[0]?.id || null;
    if (!ownerBranch) {
      toast.error("No hay sucursal disponible para asociar la pre-venta");
      return;
    }

    setSubmitting(true);
    try {
      let requestId = editingPreSaleId || null;
      let requestNumber: number | undefined;
      const payload = {
        requesting_branch_id: ownerBranch,
        source_branch_id: null,
        request_type: "pre_sale_online" as any,
        status: "draft" as any,
        delivery_target: null,
        shipping_method: null,
        client_name: clientName.trim(),
        client_phone: clientPhone.trim(),
        client_email: clientEmail.trim() || null,
        client_address: clientAddress.trim() || null,
        sales_channel: salesChannel,
        is_pre_sale: true,
        notes: notes.trim() || null,
        commercial_terms: commercialTerms.trim() || null,
      } as any;

      if (editingPreSaleId) {
        const { data, error } = await supabase
          .from("branch_requests")
          .update(payload)
          .eq("id", editingPreSaleId)
          .eq("is_pre_sale", true)
          .select("request_number")
          .single();
        if (error) throw error;
        requestNumber = data.request_number;
        const { error: deleteItemsError } = await supabase
          .from("branch_request_items")
          .delete()
          .eq("request_id", editingPreSaleId);
        if (deleteItemsError) throw deleteItemsError;
      } else {
        const { data, error } = await supabase
          .from("branch_requests")
          .insert({ ...payload, pre_sale_status: "draft", created_by: user.id })
          .select("id, request_number")
          .single();
        if (error) throw error;
        requestId = data.id;
        requestNumber = data.request_number;
      }

      const itemsPayload = items.map((item) => ({
        request_id: requestId!,
        product_id: item.product.id,
        quantity_requested: item.quantity,
        item_purpose: "client" as any,
        client_name: clientName.trim(),
        client_address: clientAddress.trim() || null,
      }));
      const { error: itemsError } = await supabase.from("branch_request_items").insert(itemsPayload);
      if (itemsError) throw itemsError;

      toast.success(editingPreSaleId ? `Pre-venta #${requestNumber} actualizada` : `Pre-venta #${requestNumber} creada`);
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || "Error al guardar pre-venta");
    } finally {
      setSubmitting(false);
    }
  };

  // Re-validate stock from BIMS live right before confirmation.
  // Respeta splits válidos (valida cada tramo) y cae a origen único cuando no hay splits.
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

      if (itemHasValidSplits(item)) {
        for (const sp of item.splits!) {
          const branchCode = branches?.find(b => b.id === sp.branchId)?.code;
          if (!branchCode) continue;
          const available = sbw[branchCode] ?? 0;
          if (available < sp.quantity) {
            const bName = branches?.find(b => b.id === sp.branchId)?.name || branchCode;
            errors[item.product.id] = `Stock cambió en ${bName}: disponible ${Math.floor(available)}, asignado ${sp.quantity}`;
            break;
          }
        }
        continue;
      }

      const srcBid = item.sourceBranchId || sourceBranchId;
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

    if (isPreSale) {
      await savePreSale();
      return;
    }

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

      // ─── Aplanar items con splits ─────────────────────────────────
      // Si un item tiene splits válidos, lo expandimos en N "leaf items" (uno por sucursal).
      // Los items sin splits conservan su sourceBranchId (multi) o el global (mono).
      // El resultado: un array uniforme donde cada entrada tiene un único origen real.
      type LeafItem = { product: ProductResult; quantity: number; sourceBranchId: string };
      const leafItems: LeafItem[] = [];
      for (const it of items) {
        if (itemHasValidSplits(it)) {
          for (const sp of it.splits!) {
            if (sp.branchId && sp.quantity > 0) {
              leafItems.push({ product: it.product, quantity: sp.quantity, sourceBranchId: sp.branchId });
            }
          }
        } else {
          const src = it.sourceBranchId || sourceBranchId;
          if (!src) continue; // ya validado por canSubmit
          leafItems.push({ product: it.product, quantity: it.quantity, sourceBranchId: src });
        }
      }

      // Determinar orígenes únicos REALES desde los leaf items.
      const uniqueSourceIds = Array.from(new Set(leafItems.map((i) => i.sourceBranchId)));
      const shouldCreateParent = uniqueSourceIds.length >= 2;

      if (shouldCreateParent) {
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
            ...(operationalResponsibleId ? { operational_responsible_id: operationalResponsibleId } : {}),
            created_by: user.id,
            status: "pending" as any,
          })
          .select()
          .single();
        if (parentErr) throw parentErr;

        // Group leaf items by source branch (cada leaf ya tiene un único origen real)
        const bySource: Record<string, LeafItem[]> = {};
        leafItems.forEach(leaf => {
          if (!bySource[leaf.sourceBranchId]) bySource[leaf.sourceBranchId] = [];
          bySource[leaf.sourceBranchId].push(leaf);
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
        // Mono-origin: single request.
        // Origen efectivo: el único origen real que aparece en leafItems.
        // (Si el usuario divide pero todo terminó en 1 sucursal, también cae aquí.)
        const effectiveSourceId = uniqueSourceIds[0] || sourceBranchId;
        const { data: request, error } = await supabase
          .from("branch_requests")
          .insert({
            requesting_branch_id: requestingBranchId,
            source_branch_id: effectiveSourceId,
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
            ...(operationalResponsibleId ? { operational_responsible_id: operationalResponsibleId } : {}),
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
  if (loadingEdit) {
    return <div className="p-8 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline" /></div>;
  }

  if (showConfirmation) {
    return (
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Confirmar pedido</h3>
        <ContextBanner requestType={operationalRequestType} deliveryTarget={deliveryTarget} effectiveOriginMode={effectiveOriginMode} />

        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Productos</h4>
          {items.map(item => {
            const splitsApplied = itemHasValidSplits(item);
            const originLabel = splitsApplied
              ? item.splits!
                  .filter(s => s.branchId && s.quantity > 0)
                  .map(s => `${branches?.find(b => b.id === s.branchId)?.name || "—"} ·${s.quantity}`)
                  .join(" / ")
              : (() => {
                  const bid = item.sourceBranchId || sourceBranchId;
                  return `Origen: ${branches?.find(b => b.id === bid)?.name || "—"}`;
                })();
            return (
              <div key={item.product.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-3 p-2.5 rounded bg-muted/30 border border-border/30 text-sm min-w-0">
                <div className="min-w-0 flex-1 flex items-baseline gap-2">
                  <span className="font-medium break-words min-w-0 flex-1">{item.product.name}</span>
                  <span className="text-muted-foreground shrink-0 tabular-nums">x{item.quantity}</span>
                </div>
                <span className="text-xs text-muted-foreground break-words sm:text-right sm:shrink-0 sm:max-w-[55%]">
                  {originLabel}
                </span>
              </div>
            );
          })}
        </div>

        {effectiveOriginMode === "multi" && Object.keys(originSummary).length > 0 && (
          <div className="p-3 rounded-lg bg-muted/50 border border-border/50 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Resumen de abastecimiento</p>
            {Object.entries(originSummary).map(([bid, info]) => (
              <div key={bid} className="flex items-center justify-between text-sm">
                <span className="font-medium">{info.branchName}</span>
                <Badge variant="outline" className="text-xs tabular-nums">{info.totalQty} unidad(es)</Badge>
              </div>
            ))}
            <p className="text-xs text-muted-foreground mt-1 pt-2 border-t border-border/30">
              Se crearán <strong>{Object.keys(originSummary).length}</strong> transferencia(s) internas + 1 pedido padre.
            </p>
          </div>
        )}

        <div className="
          sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-3
          pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:pb-3
          bg-background/95 backdrop-blur-sm border-t sm:border-0 sm:bg-transparent sm:backdrop-blur-none
          flex flex-col-reverse sm:flex-row gap-2 z-10
        ">
          <Button variant="outline" className="w-full sm:flex-1 h-11" onClick={() => setShowConfirmation(false)}>
            Volver a editar
          </Button>
          <Button className="w-full sm:flex-1 h-11 font-semibold" onClick={onSubmit} disabled={submitting}>
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
      {isPreSale ? (
        <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground">
          <strong className="text-warning">Pre-Venta Online</strong> — Cotización para cliente. No reserva stock ni genera operación.
        </div>
      ) : (
        <ContextBanner requestType={operationalRequestType} deliveryTarget={deliveryTarget} effectiveOriginMode={effectiveOriginMode} />
      )}

      {/* STEP 1: Context */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">1. Contexto</h3>
        <div className={isPreSale ? "" : "grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4"}>
          {/* Tipo de solicitud SIEMPRE primero (orden obligatorio). */}
          <div className={isPreSale ? "space-y-2 max-w-sm" : "space-y-2 order-first sm:order-last"}>
            <Label>Tipo de solicitud</Label>
            <select
              value={requestType}
              onChange={(e) => setRequestType(e.target.value as FormRequestType)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="reposition">Reposición</option>
              <option value="client">Pedido Cliente</option>
              <option value="online">Pedido Online</option>
              <option value="pre_sale_online">Pre-Venta Online</option>
            </select>
          </div>
          {/* Sucursal solicitante: solo modo operativo. Pre-venta no tiene sucursal vendedora. */}
          {!isPreSale && (
            <BranchSelector
              label="Sucursal solicitante"
              value={requestingBranchId}
              onChange={setRequestingBranchId}
              disabled={!canChangeBranch && !!defaultBranchId}
            />
          )}
        </div>

        {/* Delivery target */}
        {!isPreSale && allowedTargets.length > 1 && (
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

        {isPreSale && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 rounded-lg border border-border/50 bg-muted/30 p-3">
            {editingPreSaleId && wasConfirmed && (
              <div className="sm:col-span-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground">
                Esta pre-venta ya estaba confirmada. Al editarla conserva su estado confirmado; si cambian condiciones comerciales, volvé a validar con el cliente antes de convertir.
              </div>
            )}
            <div className="space-y-2">
              <Label>Canal de venta</Label>
              <select
                value={salesChannel}
                onChange={(e) => setSalesChannel(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {SALES_CHANNELS.map((channel) => (
                  <option key={channel.v} value={channel.v}>{channel.l}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Nombre cliente *</Label>
              <Input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Nombre del cliente" />
            </div>
            <div className="space-y-2">
              <Label>Teléfono *</Label>
              <Input value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} placeholder="Número de contacto" />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="cliente@email.com" />
            </div>
            <div className="space-y-2">
              <Label>Dirección (opcional)</Label>
              <Input value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} placeholder="Dirección del cliente (opcional)" />
            </div>
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
                <div className="p-3 bg-muted/30 space-y-2">
                  {/* Fila 1: producto */}
                  <div className="flex items-start gap-2 min-w-0">
                    <Package className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium break-words">{item.product.name}</p>
                      <p className="text-xs text-muted-foreground break-words">
                        {item.product.sku && <span>SKU: {item.product.sku}</span>}
                        {item.product.bims_code && <span> • Cód: {item.product.bims_code}</span>}
                      </p>
                      {!isPreSale && isMultiOrigin && item.sourceBranchId && (
                        <p className="text-xs text-primary mt-0.5 break-words">
                          Origen: {branches?.find(b => b.id === item.sourceBranchId)?.name || "—"}
                        </p>
                      )}
                      {!isPreSale && isMultiOrigin && !item.sourceBranchId && (
                        <p className="text-xs text-amber-600 mt-0.5">Sin origen asignado</p>
                      )}
                      {stockErrors[item.product.id] && (
                        <p className="text-xs text-destructive flex items-start gap-1 mt-1">
                          <XCircle className="h-3 w-3 mt-0.5 shrink-0" />
                          <span className="break-words">{stockErrors[item.product.id]}</span>
                        </p>
                      )}
                    </div>
                  </div>
                  {/* Fila 2: controles */}
                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/40">
                    <div className="flex items-center gap-2 min-w-0">
                      <Label className="text-xs shrink-0">Cant:</Label>
                      <Input
                        type="number" min={1} value={item.quantity}
                        onChange={(e) => updateQuantity(item.product.id, parseInt(e.target.value) || 1)}
                        className="w-20 h-9 text-sm"
                        inputMode="numeric"
                      />
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!isPreSale && (
                        <Button type="button" variant="ghost" size="sm"
                          onClick={() => setSplitPanelOpen(splitPanelOpen === item.product.id ? null : item.product.id)}
                          className="h-9 px-2 text-xs gap-1"
                          aria-label="Dividir entre sucursales"
                          title="Dividir entre sucursales">
                          <Split className="h-4 w-4" />
                          <span className="hidden sm:inline">Dividir</span>
                          {itemHasValidSplits(item) && (
                            <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                              {item.splits!.filter(s => s.branchId && s.quantity > 0).length}
                            </Badge>
                          )}
                        </Button>
                      )}
                      <Button type="button" variant="ghost" size="sm"
                        onClick={() => setExpandedProduct(expandedProduct === item.product.id ? null : item.product.id)}
                        className="h-9 px-2"
                        aria-label={expandedProduct === item.product.id ? "Contraer" : "Expandir"}>
                        {expandedProduct === item.product.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
                      <Button type="button" variant="ghost" size="sm"
                        onClick={() => removeProduct(item.product.id)}
                        className="h-9 px-2"
                        aria-label="Quitar producto">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>

                  {/* Resumen visual de splits si están aplicados */}
                  {itemHasValidSplits(item) && splitPanelOpen !== item.product.id && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {item.splits!.filter(s => s.branchId && s.quantity > 0).map((s, i) => {
                        const b = branches?.find(x => x.id === s.branchId);
                        return (
                          <Badge key={i} variant="outline" className="text-[11px] gap-1">
                            <span>{b?.name || "—"}</span>
                            <span className="tabular-nums opacity-70">·{s.quantity}</span>
                          </Badge>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Panel de división entre sucursales */}
                {!isPreSale && splitPanelOpen === item.product.id && (
                  <div className="border-t border-border/50 p-3">
                    <SplitOriginPanel
                      totalQuantity={item.quantity}
                      splits={item.splits || []}
                      onChange={(splits) => setItemSplits(item.product.id, splits)}
                      stockByWarehouseCode={getStockByCode(item.product)}
                      requestingBranchId={requestingBranchId}
                      onClose={() => setSplitPanelOpen(null)}
                    />
                  </div>
                )}

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
                      stockMode={isPreSale ? "info_only" : "select_source"}
                      onSelectSourceBranch={(bid) => {
                        if (isPreSale) return;
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
                      disabledBranchIds={!isPreSale && requestingBranchId ? [requestingBranchId] : undefined}
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
      {!isPreSale && <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">3. Origen del stock</h3>

        {/* Aviso: cantidad cambió y los splits quedaron inconsistentes */}
        {items.some(itemHasDirtySplits) && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-foreground">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-medium">La cantidad cambió. Revisá la distribución entre sucursales.</p>
              <p className="text-xs text-muted-foreground">
                {items.filter(itemHasDirtySplits).map(i => i.product.name).join(", ")}
              </p>
            </div>
          </div>
        )}

        {effectiveOriginMode === "undefined" && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-foreground">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            <span>Seleccioná la sucursal origen desde el bloque de stock de cualquier producto, o usá "Dividir entre sucursales".</span>
          </div>
        )}

        {effectiveOriginMode === "single" && sourceBranchId && (
          <div className="p-3 rounded-lg bg-muted/50 border border-border/50">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Origen único</p>
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm">{branches?.find(b => b.id === sourceBranchId)?.name || "—"}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSourceBranchId("")} className="text-xs text-muted-foreground h-7">
                Cambiar
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Todo el pedido sale de esta sucursal.
            </p>
            {isSameBranch && (
              <div className="flex items-center gap-2 mt-2 p-2 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
                <XCircle className="h-4 w-4 shrink-0" />
                <span>La sucursal origen no puede ser igual a la sucursal solicitante.</span>
              </div>
            )}
          </div>
        )}

        {/* Resumen siempre que haya 1+ origen detectado (single o multi) */}
        {Object.keys(originSummary).length > 0 && (
          <div className="p-3 rounded-lg bg-muted/50 border border-border/50 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Resumen de abastecimiento</p>
              {effectiveOriginMode === "multi" && (
                <Badge variant="secondary" className="text-[10px]">Multi-origen</Badge>
              )}
            </div>
            {Object.entries(originSummary).map(([bid, info]) => (
              <div key={bid} className="flex items-center justify-between text-sm">
                <span className="font-medium">{info.branchName}</span>
                <Badge variant="outline" className="text-xs tabular-nums">{info.totalQty} unidad(es)</Badge>
              </div>
            ))}
            {effectiveOriginMode === "multi" && (
              <p className="text-xs text-muted-foreground mt-1 pt-2 border-t border-border/30">
                Se crearán {Object.keys(originSummary).length} transferencia(s) internas + 1 pedido padre.
              </p>
            )}
          </div>
        )}

        {itemsWithoutSource.length > 0 && effectiveOriginMode !== "undefined" && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-foreground">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            <span>{itemsWithoutSource.length} producto(s) sin origen resuelto</span>
          </div>
        )}
      </div>}

      {/* STEP 4: Logistics — extraído a LogisticsFieldsForm para reutilización
          desde el flujo "Iniciar operación" (estado supplied). El payload y
          comportamiento se mantienen idénticos. */}
      {!isPreSale && (
        <LogisticsFieldsForm
          operationalRequestType={operationalRequestType}
          deliveryTarget={deliveryTarget}
          formRequestType={requestType}
          operationalProfiles={operationalProfiles ?? undefined}
          value={{
            shippingMethod,
            deliveryPaidBy,
            courierBillingMode,
            shippingAmount,
            clientName,
            clientAddress,
            notes,
            operationalResponsibleId,
          }}
          onChange={(patch) => {
            if (patch.shippingMethod !== undefined) setShippingMethod(patch.shippingMethod);
            if (patch.deliveryPaidBy !== undefined) setDeliveryPaidBy(patch.deliveryPaidBy);
            if (patch.courierBillingMode !== undefined) setCourierBillingMode(patch.courierBillingMode);
            if (patch.shippingAmount !== undefined) setShippingAmount(patch.shippingAmount);
            if (patch.clientName !== undefined) setClientName(patch.clientName);
            if (patch.clientAddress !== undefined) setClientAddress(patch.clientAddress);
            if (patch.notes !== undefined) setNotes(patch.notes);
            if (patch.operationalResponsibleId !== undefined) setOperationalResponsibleId(patch.operationalResponsibleId);
          }}
        />
      )}

      {/* PRE-VENTA: Condiciones comerciales + Notas internas (siempre visibles si isPreSale) */}
      {isPreSale && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Condiciones</h3>
          <div className="space-y-2">
            <Label>Condiciones comerciales (opcional)</Label>
            <Textarea
              value={commercialTerms}
              onChange={(e) => setCommercialTerms(e.target.value)}
              placeholder={"Ej:\nValidez de la oferta: 10 días\nForma de pago: 50% anticipo, saldo contra entrega\nPlazo de entrega: 20 a 25 días\nIncluye IVA"}
              rows={5}
              maxLength={1500}
            />
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <p>Se mostrarán en la cotización enviada al cliente (PDF). Usá una línea por condición.</p>
              <span className={commercialTerms.length > 1500 ? "text-destructive font-semibold" : ""}>
                {commercialTerms.length}/1500
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notas internas (opcional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notas internas no visibles en el PDF..."
              rows={2}
            />
          </div>
        </div>
      )}

      {hasStockErrors && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
          <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span className="break-words">
            {isPreSale
              ? "Stock insuficiente. Esta pre-venta no reserva stock."
              : "Hay productos con stock insuficiente. Corregí las cantidades o cambiá el origen antes de continuar."}
          </span>
        </div>
      )}

      {/* CTA: sticky SOLO en mobile (evita tapar contenido en desktop) */}
      <div className="
        sticky bottom-0 -mx-4 px-4 pt-3
        pb-[calc(env(safe-area-inset-bottom)+0.75rem)]
        bg-background/95 backdrop-blur-sm border-t
        sm:static sm:mx-0 sm:px-0 sm:pt-2 sm:pb-2
        sm:bg-transparent sm:backdrop-blur-none sm:border-0
        z-10
      ">
        <Button
          type="submit"
          className="w-full h-12 text-sm sm:text-base font-semibold"
          disabled={submitting || !canSubmit}
        >
          {submitting
            ? (isPreSale ? "Guardando..." : "Creando...")
            : isPreSale
              ? `Guardar Pre-Venta (${items.length} ${items.length === 1 ? "producto" : "productos"})`
            : effectiveOriginMode === "multi"
              ? `Revisar y crear (${Object.keys(originSummary).length} transferencias)`
              : `Revisar y crear pedido (${items.length} ${items.length === 1 ? "producto" : "productos"})`
          }
        </Button>
      </div>
    </form>
  );
}
