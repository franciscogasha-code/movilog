import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Loader2, CheckCircle2, ExternalLink, PackageCheck, Clock, Warehouse, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { REQUEST_STATUS_CONFIG } from "@/lib/constants";
import { StatusBadge } from "@/components/StatusBadge";
import { useLiveStock, revalidateLiveStock, type LiveStockData } from "@/hooks/use-live-stock";
import { useBranches } from "@/hooks/use-branches";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSupplyResolution } from "@/hooks/use-supply-resolution";
import { SplitOriginPanel } from "./SplitOriginPanel";
import { SupplyCommitModal } from "./SupplyCommitModal";

const AUTO_FOCUS_NEXT = true;

const closedSet = new Set(["received", "logistic_closed", "closed", "rejected"]);

export function SupplyResolutionPanel({
  requestId,
  onUpdate,
}: {
  requestId: string;
  onUpdate: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { data: branches } = useBranches();

  // ─── Datos del padre + items + hijos ───────────────────────────────
  const { data: parent, isLoading: loadingParent } = useQuery({
    queryKey: ["supply-parent", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_requests")
        .select("id, request_number, requesting_branch_id, status, requesting_branch:branches!branch_requests_requesting_branch_id_fkey(name, code)")
        .eq("id", requestId)
        .single();
      if (error) throw error;
      return data;
    },
    refetchInterval: 15_000, // V4: captar promoción del trigger B en flujo 100% local
  });

  const { data: items = [], isLoading: loadingItems } = useQuery({
    queryKey: ["supply-items", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_request_items")
        .select("id, product_id, quantity_requested, local_supply_qty, product:products(name, sku, bims_code, stock_by_warehouse)")
        .eq("request_id", requestId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: children = [], isLoading: loadingChildren } = useQuery({
    queryKey: ["supply-children", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_requests")
        .select("id, request_number, status, source_branch:branches!branch_requests_source_branch_id_fkey(name, code)")
        .eq("parent_request_id", requestId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 30_000,
  });

  const { data: commitEventCount = 0, isLoading: loadingCommitEvents } = useQuery({
    queryKey: ["supply-commit-events", requestId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("operational_events")
        .select("id", { count: "exact", head: true })
        .eq("reference_type", "branch_request")
        .eq("reference_id", requestId)
        .eq("event_type", "supply_resolution_committed");
      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 30_000,
  });

  // V5A hardening: monitorMode debe depender de evidencia real de resolución confirmada.
  // Estado in_supply es el punto de trabajo inicial; NO significa commit.
  // Señales válidas: hijos creados por RPC o evento supply_resolution_committed.
  const hasChildren = (children as any[]).length > 0;
  const parentStatus = (parent as any)?.status;
  const hasCommitEvent = commitEventCount > 0;
  const resolutionSignalsLoading = loadingParent || loadingChildren || loadingCommitEvents;
  const monitorMode = !resolutionSignalsLoading && (hasChildren || hasCommitEvent || parentStatus === "supplied" || closedSet.has(parentStatus));
  // anyLocal sigue usándose SOLO dentro del bloque monitor para mostrar resumen de stock local.
  const anyLocal = items.some((i: any) => Number(i.local_supply_qty) > 0);

  // ─── Live stock para items (solo en modo resolución) ──────────────
  const bimsCodes = useMemo(
    () => (monitorMode || resolutionSignalsLoading ? [] : items.map((i: any) => i.product?.bims_code).filter(Boolean) as string[]),
    [items, monitorMode, resolutionSignalsLoading]
  );
  const { liveStock, isLoadingStock } = useLiveStock(bimsCodes);

  const requestingCode = (parent as any)?.requesting_branch?.code;
  const localStockOf = (bims: string | null | undefined) => {
    if (!bims) return 0;
    const live = liveStock?.[bims];
    if (!live || !requestingCode) return 0;
    return Math.floor(live.stock_by_warehouse?.[requestingCode] ?? 0);
  };
  const stockByCodeFor = (bims: string | null | undefined) => {
    if (!bims) return null;
    const live = liveStock?.[bims];
    return live?.stock_by_warehouse ?? null;
  };

  // ─── Hook estado resolución ────────────────────────────────────────
  const itemDefs = useMemo(
    () => items.map((i: any) => ({
      id: i.id,
      product_id: i.product_id,
      quantity_requested: Number(i.quantity_requested),
    })),
    [items]
  );
  const res = useSupplyResolution(itemDefs);

  // ─── Accordion controlado + auto-focus ─────────────────────────────
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  useEffect(() => {
    if (!monitorMode && !openItemId && itemDefs.length > 0) setOpenItemId(itemDefs[0].id);
  }, [monitorMode, openItemId, itemDefs]);

  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const handleItemValid = (itemId: string) => {
    if (!AUTO_FOCUS_NEXT) return;
    const next = res.nextIncompleteId(itemId);
    setOpenItemId(next);
    if (!next) return;
    // V4: delay defensivo en mobile para evitar competir con animación Radix Accordion (iOS Safari).
    const delay = isMobile ? 150 : 0;
    window.setTimeout(() => {
      if (document.activeElement instanceof HTMLInputElement) return;
      if (!isMobile) return;
      itemRefs.current[next]?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, delay);
  };

  // Detectar transiciones incompleto→cobertura total para disparar auto-focus.
  // Con abastecimiento parcial permitido, isItemValid es laxo; el avance se basa en cobertura total.
  const validityRef = useRef<Record<string, boolean>>({});
  useEffect(() => {
    for (const it of itemDefs) {
      const wasFull = validityRef.current[it.id] ?? false;
      const isFull = res.isItemFullyCovered(it.id, it.quantity_requested);
      if (!wasFull && isFull && openItemId === it.id) {
        handleItemValid(it.id);
      }
      validityRef.current[it.id] = isFull;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res.state, itemDefs]);

  // V4: limpiar marca de "stale" cuando el operador edita la resolución.
  const stateSig = useMemo(() => JSON.stringify(res.state), [res.state]);
  const lastStateSigRef = useRef(stateSig);
  useEffect(() => {
    if (lastStateSigRef.current !== stateSig) {
      lastStateSigRef.current = stateSig;
      setStaleItemIds((prev) => (prev.size === 0 ? prev : new Set()));
    }
  }, [stateSig]);

  // ─── Commit ────────────────────────────────────────────────────────
  const [commitOpen, setCommitOpen] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [revalidating, setRevalidating] = useState(false);
  const [staleItemIds, setStaleItemIds] = useState<Set<string>>(new Set());
  const idempotencyKeyRef = useRef<string | null>(null);

  // V4: Revalidación pre-modal contra stock vivo BIMS fresco.
  async function openCommitWithRevalidation() {
    if (revalidating || committing) return;
    setRevalidating(true);
    setStaleItemIds(new Set());
    try {
      const codes = (items as any[]).map((i) => i.product?.bims_code).filter(Boolean) as string[];
      const fresh: LiveStockData = await revalidateLiveStock(codes);
      const failed = new Set<string>();
      for (const it of items as any[]) {
        const bims = it.product?.bims_code as string | undefined;
        const live = bims ? fresh[bims] : undefined;
        const localAvail = bims && requestingCode ? Math.floor(live?.stock_by_warehouse?.[requestingCode] ?? 0) : 0;
        const st = res.state[it.id] ?? { localQty: 0, externals: [] };
        if (st.localQty > localAvail) { failed.add(it.id); continue; }
        for (const ext of st.externals) {
          const b = branches?.find((x: any) => x.id === ext.branchId);
          const code = b?.code;
          const avail = code ? Math.floor(live?.stock_by_warehouse?.[code] ?? 0) : 0;
          if (ext.qty > avail) { failed.add(it.id); break; }
        }
      }
      // Refrescar el cache de useLiveStock con el snapshot fresco
      qc.invalidateQueries({ queryKey: ["live-stock"] });
      if (failed.size > 0) {
        setStaleItemIds(failed);
        const firstFailed = (items as any[]).find((i) => failed.has(i.id))?.id ?? null;
        if (firstFailed) setOpenItemId(firstFailed);
        toast.error("El stock cambió. Revisá los items resaltados.");
        return;
      }
      setCommitOpen(true);
    } catch (e: any) {
      toast.error(e?.message || "No se pudo revalidar stock");
    } finally {
      setRevalidating(false);
    }
  }

  async function doCommit() {
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = crypto.randomUUID();
    setCommitting(true);
    try {
      const { error } = await supabase.rpc("fn_commit_supply_resolution" as any, {
        p_request_id: requestId,
        p_resolutions: res.buildPayload(),
        p_idempotency_key: idempotencyKeyRef.current,
      });
      if (error) throw error;
      toast.success("Abastecimiento confirmado");
      qc.invalidateQueries({ queryKey: ["branch-request-detail", requestId] });
      qc.invalidateQueries({ queryKey: ["branch-requests"] });
      qc.invalidateQueries({ queryKey: ["supply-children", requestId] });
      qc.invalidateQueries({ queryKey: ["supply-items", requestId] });
      qc.invalidateQueries({ queryKey: ["supply-parent", requestId] });
      // V4: invalidar cache live-stock para evitar stock viejo en navegación/back/refresh.
      qc.invalidateQueries({ queryKey: ["live-stock"] });
      qc.removeQueries({ queryKey: ["live-stock"], exact: false });
      onUpdate();
      setCommitOpen(false);
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (msg.includes("partial_supply_not_allowed")) {
        toast.error("No se puede confirmar abastecimiento parcial. Cubrí todas las cantidades.");
      } else if (msg.includes("self_source_not_allowed")) {
        toast.error("La sucursal ejecutora no puede ser origen externo.");
      } else if (msg.includes("incomplete_resolution")) {
        toast.error("Faltan items por resolver.");
      } else {
        toast.error(msg || "No se pudo confirmar abastecimiento");
      }
      idempotencyKeyRef.current = null; // permitir reintento limpio
    } finally {
      setCommitting(false);
    }
  }

  const productMap = useMemo(() => {
    const m: Record<string, { name: string; sku?: string | null }> = {};
    for (const i of items as any[]) {
      m[i.product_id] = { name: i.product?.name ?? "Producto", sku: i.product?.sku };
    }
    return m;
  }, [items]);

  const openChildren = (children as any[]).filter((c) => !closedSet.has(c.status));

  if (resolutionSignalsLoading || loadingItems) {
    return (
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando abastecimiento…
        </CardContent>
      </Card>
    );
  }

  // ─── Render: MODO MONITOR ──────────────────────────────────────────
  if (monitorMode) {
    return (
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardContent className="p-4 space-y-4">
          <div className="flex items-start gap-3">
            <PackageCheck className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">En abastecimiento</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Resolución confirmada. Esperando cierre de pedidos internos / promoción automática.
              </p>
            </div>
          </div>

          {anyLocal && (
            <div className="rounded-md border border-border/60 bg-background p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-2">
                <Warehouse className="h-3.5 w-3.5" /> Stock local registrado
              </p>
              <ul className="space-y-1 text-sm">
                {(items as any[]).filter((i) => Number(i.local_supply_qty) > 0).map((i) => (
                  <li key={i.id} className="flex justify-between gap-2">
                    <span className="truncate">{i.product?.name}</span>
                    <span className="tabular-nums font-medium shrink-0">{Number(i.local_supply_qty)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(children as any[]).length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Pedidos internos vinculados ({children.length})
              </p>
              <div className="rounded-md border border-border/60 overflow-hidden divide-y divide-border/50 bg-background">
                {(children as any[]).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => navigate(`/solicitudes?detail=${c.id}`)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-sm font-semibold">#{c.request_number}</span>
                      {c.source_branch?.name && (
                        <span className="text-xs text-muted-foreground truncate">desde {c.source_branch.name}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={c.status} config={REQUEST_STATUS_CONFIG} />
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  </button>
                ))}
              </div>
              {openChildren.length > 0 ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  <span>Esperando recepción de {openChildren.length} pedido(s) interno(s).</span>
                </div>
              ) : (
                <p className="text-xs text-success">Todos los pedidos internos están cerrados.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // ─── Render: MODO RESOLUCIÓN ───────────────────────────────────────
  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardContent className="p-4 space-y-4 pb-20 md:pb-4">
        <div className="flex items-start gap-3">
          <PackageCheck className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Resolver abastecimiento</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Indicá cuánto stock tenés localmente y cuánto pedís a otras sucursales. Si no llegás al total solicitado, podés continuar igual: el faltante queda registrado como demanda no satisfecha.
            </p>
          </div>
        </div>

        {isLoadingStock && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Consultando stock vivo BIMS…
          </div>
        )}

        <Accordion
          type="single"
          collapsible
          value={openItemId ?? undefined}
          onValueChange={(v) => setOpenItemId(v || null)}
          className="space-y-2"
        >
          {(items as any[]).map((it) => {
            const requested = Number(it.quantity_requested);
            const sum = res.itemSum(it.id);
            const valid = res.isItemValid(it.id, requested);
            const fullyCovered = res.isItemFullyCovered(it.id, requested);
            const shortfall = Math.max(0, requested - sum);
            const localMax = Math.min(requested, localStockOf(it.product?.bims_code));
            const st = res.state[it.id] ?? { localQty: 0, externals: [] };
            const externalRemaining = requested - st.localQty;
            const isStale = staleItemIds.has(it.id);

            return (
              <AccordionItem
                key={it.id}
                value={it.id}
                ref={(el: any) => (itemRefs.current[it.id] = el)}
                className={`rounded-md border bg-background data-[state=open]:border-primary/50 ${
                  isStale ? "border-destructive/60 bg-destructive/5" : "border-border"
                }`}
              >
                <AccordionTrigger className="px-3 py-2 hover:no-underline">
                  <div className="flex items-center justify-between gap-3 w-full min-w-0">
                    <div className="min-w-0 text-left">
                      <p className="text-sm font-medium truncate">{it.product?.name ?? "Producto"}</p>
                      <p className="text-[11px] text-muted-foreground">
                        Requerido: <span className="tabular-nums">{requested}</span>
                        {shortfall > 0 && !isStale && (
                          <span className="ml-2 text-amber-700 font-medium">· Faltan {shortfall}</span>
                        )}
                        {isStale && <span className="ml-2 text-destructive font-medium">· Stock cambió</span>}
                      </p>
                    </div>
                    {isStale ? (
                      <Badge variant="outline" className="border-destructive/60 text-destructive gap-1 shrink-0">
                        <AlertCircle className="h-3 w-3" /> Revisar
                      </Badge>
                    ) : fullyCovered ? (
                      <Badge className="bg-success/15 text-success border-success/30 gap-1 shrink-0">
                        <CheckCircle2 className="h-3 w-3" /> {sum}/{requested}
                      </Badge>
                    ) : valid ? (
                      <Badge variant="outline" className="border-amber-500/50 text-amber-700 gap-1 shrink-0 tabular-nums">
                        <AlertCircle className="h-3 w-3" /> {sum}/{requested}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-destructive/40 text-destructive gap-1 shrink-0 tabular-nums">
                        <AlertCircle className="h-3 w-3" /> {sum}/{requested}
                      </Badge>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-3 pb-3 space-y-3">
                  {/* Local */}
                  <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium flex items-center gap-1.5">
                        <Warehouse className="h-3.5 w-3.5 text-muted-foreground" />
                        Stock local en {(parent as any)?.requesting_branch?.name ?? "esta sucursal"}
                      </p>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        Disp.: {localStockOf(it.product?.bims_code)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={localMax}
                        value={st.localQty || ""}
                        onChange={(e) => {
                          const v = parseInt(e.target.value) || 0;
                          res.setLocal(it.id, Math.min(Math.max(0, v), requested));
                        }}
                        placeholder="0"
                        className="w-24 h-9 tabular-nums"
                      />
                      {localMax > 0 && st.localQty < localMax && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => res.setLocal(it.id, Math.min(localMax, requested))}
                        >
                          Cubrir todo local ({localMax})
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Externos */}
                  {externalRemaining > 0 && (
                    <SplitOriginPanel
                      totalQuantity={externalRemaining}
                      splits={st.externals.map((e) => ({ branchId: e.branchId, quantity: e.qty }))}
                      onChange={(splits) =>
                        res.setExternals(
                          it.id,
                          splits.map((s) => ({ branchId: s.branchId, qty: s.quantity }))
                        )
                      }
                      stockByWarehouseCode={stockByCodeFor(it.product?.bims_code)}
                      requestingBranchId={(parent as any)?.requesting_branch_id}
                      onClose={() => {/* no-op: el panel está embebido */}}
                    />
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </CardContent>

      {/* CTA sticky cuando todo está completo */}
      {res.allValid && (
        <div className="sticky bottom-0 inset-x-0 bg-background/95 backdrop-blur border-t border-border p-3 z-10">
          <Button
            className="w-full"
            size="lg"
            onClick={openCommitWithRevalidation}
            disabled={committing || revalidating || staleItemIds.size > 0}
          >
            {revalidating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4 mr-2" />
            )}
            {revalidating ? "Revalidando stock…" : "Revisar y confirmar abastecimiento"}
          </Button>
        </div>
      )}

      <SupplyCommitModal
        open={commitOpen}
        onOpenChange={setCommitOpen}
        items={itemDefs}
        state={res.state}
        products={productMap}
        requestingBranchName={(parent as any)?.requesting_branch?.name}
        onConfirm={doCommit}
        loading={committing}
      />
    </Card>
  );
}
