import { useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Database, RefreshCw, Loader2, CheckCircle2, AlertTriangle, Building2, Package, ChevronDown, ChevronUp, XCircle, Timer, ShieldAlert, ShieldCheck, Ban } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  getCatalogSyncStatus,
  CATALOG_STATUS_LABELS,
  CATALOG_STATUS_DESCRIPTIONS,
  type CatalogSyncStatus,
} from "@/lib/business-rules";

const BIMS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bims-proxy`;
const BIMS_SYNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bims-sync`;
const HEADERS = {
  "Content-Type": "application/json",
  apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
};

// Sync process states (state machine)
type SyncPhase = "idle" | "syncing" | "completed" | "incomplete" | "error" | "awaiting_confirmation";
type SyncStatus = "idle" | "loading" | "success" | "partial" | "error";

interface SyncError { code: string; message: string; stage: string; timestamp: string }

interface PageSyncProgress {
  currentOffset: number;
  totalBatches: number;
  totalProcessed: number;
  totalInserted: number;
  totalUpdated: number;
  totalFailed: number;
  totalSkipped: number;
  totalReceived: number;
  totalUniquePersisted: number;
  bimsTotalCount: number | null;
  errors: SyncError[];
  isRunning: boolean;
  status: SyncStatus;
  phase: SyncPhase;
  startedAt: Date | null;
  durationMs: number;
  failedOffsets: number[];
  totalBatchesAttempted: number;
  totalBatchErrors: number;
  duplicateBlockDetected: boolean;
}

interface ThresholdAlert {
  total_to_deactivate: number;
  total_current_active: number;
  deactivate_percent: number;
  threshold_percent: number;
  products_to_deactivate: { bims_code: string }[];
  activeBimsCodes: string[];
  totalPagesProcessed: number;
}

const STAGE_LABELS: Record<string, string> = {
  fetch: "Obtención",
  validation: "Validación",
  transform: "Transformación",
  upsert: "Guardado",
  deactivation: "Baja lógica",
  deactivate: "Baja lógica",
};

const PHASE_LABELS: Record<SyncPhase, string> = {
  idle: "Sin ejecutar",
  syncing: "En proceso",
  completed: "Completado correctamente",
  incomplete: "Incompleto",
  error: "Error",
  awaiting_confirmation: "Requiere confirmación",
};

const PHASE_COLORS: Record<SyncPhase, string> = {
  idle: "text-muted-foreground",
  syncing: "text-primary",
  completed: "text-green-600",
  incomplete: "text-amber-500",
  error: "text-destructive",
  awaiting_confirmation: "text-amber-600",
};

function StatusIcon({ status }: { status: SyncStatus }) {
  switch (status) {
    case "loading": return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
    case "success": return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "partial": return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    case "error": return <XCircle className="h-4 w-4 text-destructive" />;
    default: return null;
  }
}

function PhaseIcon({ phase }: { phase: SyncPhase }) {
  switch (phase) {
    case "syncing": return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
    case "completed": return <ShieldCheck className="h-4 w-4 text-green-500" />;
    case "incomplete": return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    case "error": return <XCircle className="h-4 w-4 text-destructive" />;
    case "awaiting_confirmation": return <ShieldAlert className="h-4 w-4 text-amber-600" />;
    default: return null;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function ErrorsByStage({ errors }: { errors: SyncError[] }) {
  const grouped: Record<string, SyncError[]> = {};
  errors.forEach(e => {
    const stage = e.stage || "unknown";
    if (!grouped[stage]) grouped[stage] = [];
    grouped[stage].push(e);
  });

  return (
    <div className="space-y-2">
      {Object.entries(grouped).map(([stage, stageErrors]) => (
        <div key={stage}>
          <p className="text-xs font-medium text-muted-foreground mb-1">
            {STAGE_LABELS[stage] || stage} ({stageErrors.length})
          </p>
          <div className="space-y-1">
            {stageErrors.slice(0, 20).map((err, i) => (
              <div key={i} className="flex items-start gap-2 p-1.5 rounded bg-destructive/5 border border-destructive/10 text-xs">
                <XCircle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <span className="font-mono font-medium">{err.code}</span>
                  <p className="text-muted-foreground truncate">{err.message}</p>
                </div>
              </div>
            ))}
            {stageErrors.length > 20 && (
              <p className="text-xs text-muted-foreground">... y {stageErrors.length - 20} más</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

const PAGE_SIZE = 100;

function emptyProgress(): PageSyncProgress {
  return {
    currentOffset: 0, totalBatches: 0, totalProcessed: 0, totalInserted: 0, totalUpdated: 0,
    totalFailed: 0, totalSkipped: 0, totalReceived: 0, totalUniquePersisted: 0, bimsTotalCount: null, errors: [],
    isRunning: false, status: "idle", phase: "idle", startedAt: null, durationMs: 0,
    failedOffsets: [], totalBatchesAttempted: 0, totalBatchErrors: 0, duplicateBlockDetected: false,
  };
}

export default function SincronizacionBims() {
  const queryClient = useQueryClient();
  const [connStatus, setConnStatus] = useState<SyncStatus>("idle");
  const [connMessage, setConnMessage] = useState("");
  const syncLockRef = useRef(false);

  // Warehouse sync state
  const [whState, setWhState] = useState<{ status: SyncStatus; stats?: any; durationMs?: number }>({ status: "idle" });

  // Product paginated sync state
  const [prodProgress, setProdProgress] = useState<PageSyncProgress>(emptyProgress());
  const [showErrors, setShowErrors] = useState(false);

  // Threshold confirmation dialog
  const [thresholdAlert, setThresholdAlert] = useState<ThresholdAlert | null>(null);

  const { data: branchCount = 0 } = useQuery({
    queryKey: ["branches-count"],
    queryFn: async () => {
      const { count } = await supabase.from("branches").select("*", { count: "exact", head: true });
      return count || 0;
    },
  });

  const { data: productCount = 0 } = useQuery({
    queryKey: ["products-count"],
    queryFn: async () => {
      const { count } = await supabase.from("products").select("*", { count: "exact", head: true }).eq("is_active", true);
      return count || 0;
    },
  });

  const { data: lastLogs } = useQuery({
    queryKey: ["sync-logs-recent"],
    queryFn: async () => {
      const { data } = await supabase
        .from("sync_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      return data || [];
    },
  });

  const { data: syncRunTotals } = useQuery({
    queryKey: ["sync-run-totals"],
    queryFn: async () => {
      const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
      const { data } = await supabase
        .from("sync_logs")
        .select("total_received, total_processed, total_failed, status, triggered_by")
        .eq("entity", "products")
        .gte("created_at", oneHourAgo)
        .order("created_at", { ascending: false })
        .limit(500);
      return data || [];
    },
  });

  const lastSuccessSync = lastLogs?.find((l: any) => l.entity === "products" && l.status === "success");

  const lastSyncRun = (() => {
    if (!syncRunTotals?.length) return { totalReceived: 0, totalPages: 0, failedPages: 0 };
    const pageLogs = syncRunTotals.filter((l: any) => l.triggered_by?.startsWith("page_"));
    if (!pageLogs.length) return { totalReceived: 0, totalPages: 0, failedPages: 0 };
    const totalReceived = pageLogs.reduce((sum: number, l: any) => sum + (l.total_received || 0), 0);
    const failedPages = pageLogs.filter((l: any) => l.status !== "success").length;
    return { totalReceived, totalPages: pageLogs.length, failedPages };
  })();

  const bimsTotalFromLiveSync = prodProgress.bimsTotalCount;
  const bimsTotalFromAccumulated = prodProgress.totalReceived > 0 ? prodProgress.totalReceived : 0;
  const estimatedCatalogSize = bimsTotalFromLiveSync
    ?? (bimsTotalFromAccumulated > lastSyncRun.totalReceived ? bimsTotalFromAccumulated : lastSyncRun.totalReceived);
  const effectiveCatalogSize = estimatedCatalogSize ?? 0;

  const catalogCoverage = effectiveCatalogSize > 0
    ? Math.min(productCount / effectiveCatalogSize, 1)
    : (productCount > 0 ? -1 : 0);
  const catalogStatus = getCatalogSyncStatus(productCount, effectiveCatalogSize, prodProgress.isRunning);
  const catalogHealthy = catalogStatus === "complete";
  const totalMissing = effectiveCatalogSize > 0 ? Math.max(effectiveCatalogSize - productCount, 0) : 0;

  const testConnection = async () => {
    setConnStatus("loading");
    try {
      const res = await fetch(`${BIMS_URL}?action=test-connection`, { method: "POST", headers: HEADERS });
      const data = await res.json();
      if (res.ok && data.success) {
        setConnStatus("success");
        setConnMessage("Conexión exitosa");
        toast.success("Conexión con BIMS exitosa");
      } else {
        setConnStatus("error");
        setConnMessage(data.error || "Error desconocido");
        toast.error(`Error BIMS: ${data.error}`);
      }
    } catch (err: any) {
      setConnStatus("error");
      setConnMessage(err.message);
      toast.error(`Error: ${err.message}`);
    }
  };

  const syncWarehouses = async () => {
    setWhState({ status: "loading" });
    const start = Date.now();
    try {
      const res = await fetch(`${BIMS_SYNC_URL}?entity=warehouses`, { method: "POST", headers: HEADERS });
      const data = await res.json();
      const duration = Date.now() - start;
      if (res.ok && data.success) {
        setWhState({ status: data.stats.total_failed > 0 ? "partial" : "success", stats: data.stats, durationMs: duration });
        toast.success(`Sucursales: ${data.stats.total_processed} procesadas`);
        queryClient.invalidateQueries({ queryKey: ["branches-count"] });
        queryClient.invalidateQueries({ queryKey: ["branches"] });
      } else {
        setWhState({ status: "error", durationMs: duration });
        toast.error(data.error || "Error sincronizando sucursales");
      }
    } catch (err: any) {
      setWhState({ status: "error", durationMs: Date.now() - start });
      toast.error(err.message);
    }
  };

  /** Execute the deactivation step with all validations */
  const executeDeactivation = useCallback(async (
    activeBimsCodes: string[],
    totalPagesProcessed: number,
    totalPageErrors: number,
    forceConfirmed = false,
  ): Promise<"success" | "threshold" | "error" | "blocked"> => {
    try {
      const res = await fetch(`${BIMS_SYNC_URL}?entity=products&action=deactivate_missing`, {
        method: "POST",
        headers: { ...HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({
          active_bims_codes: activeBimsCodes,
          sync_completed: true,
          total_pages_processed: totalPagesProcessed,
          total_errors: totalPageErrors,
          force_confirmed: forceConfirmed,
        }),
      });
      const data = await res.json();

      if (data.success) {
        if (data.total_deactivated > 0) {
          toast.info(`${data.total_deactivated} productos dados de baja lógica`);
        }
        return "success";
      }

      if (data.reason === "threshold_exceeded" && data.requires_confirmation) {
        setThresholdAlert({
          ...data,
          activeBimsCodes,
          totalPagesProcessed,
        });
        return "threshold";
      }

      if (data.reason === "sync_incomplete" || data.reason === "sync_had_errors") {
        toast.warning(data.error);
        return "blocked";
      }

      toast.error(data.error || "Error en desactivación");
      return "error";
    } catch (err: any) {
      console.error("Deactivation error:", err);
      toast.error(`Error en baja lógica: ${err.message}`);
      return "error";
    }
  }, []);

  /** Handle threshold confirmation */
  const handleThresholdConfirm = useCallback(async () => {
    if (!thresholdAlert) return;
    const result = await executeDeactivation(
      thresholdAlert.activeBimsCodes,
      thresholdAlert.totalPagesProcessed,
      0,
      true, // force confirmed
    );
    setThresholdAlert(null);
    if (result === "success") {
      setProdProgress(prev => ({ ...prev, phase: "completed" }));
      queryClient.invalidateQueries({ queryKey: ["products-count"] });
      queryClient.invalidateQueries({ queryKey: ["sync-logs-recent"] });
    }
  }, [thresholdAlert, executeDeactivation, queryClient]);

  const handleThresholdCancel = useCallback(() => {
    setThresholdAlert(null);
    setProdProgress(prev => ({ ...prev, phase: "completed" }));
    toast.info("Desactivación cancelada. Los productos existentes no fueron modificados.");
  }, []);

  /**
   * Paginated product sync with full validation
   */
  const syncProducts = useCallback(async (retryPages?: number[]) => {
    // RULE 7: Prevent parallel syncs
    if (syncLockRef.current) {
      toast.warning("Ya hay una sincronización en curso");
      return;
    }
    syncLockRef.current = true;

    const startTime = Date.now();
    setProdProgress({
      ...emptyProgress(),
      isRunning: true,
      status: "loading",
      phase: "syncing",
      startedAt: new Date(),
      ...(retryPages ? {
        totalProcessed: prodProgress.totalProcessed,
        totalInserted: prodProgress.totalInserted,
        totalUpdated: prodProgress.totalUpdated,
        totalReceived: prodProgress.totalReceived,
      } : {}),
    });

    const pages = retryPages || (() => {
      const arr: number[] = [];
      for (let i = 1; i <= 500; i++) arr.push(i);
      return arr;
    })();

    let totalProcessed = retryPages ? prodProgress.totalProcessed : 0;
    let totalInserted = retryPages ? prodProgress.totalInserted : 0;
    let totalUpdated = retryPages ? prodProgress.totalUpdated : 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    let totalReceived = retryPages ? prodProgress.totalReceived : 0;
    let bimsTotalCount: number | null = retryPages ? prodProgress.bimsTotalCount : null;
    let pagesProcessed = 0;
    let pagesAttempted = 0;
    let pageErrors = 0;
    const allErrors: SyncError[] = [];
    const newFailedPages: number[] = [];
    const allActiveBimsCodes: string[] = [];
    let totalInactiveSkipped = 0;

    for (const pageNum of pages) {
      pagesAttempted++;
      try {
        const res = await fetch(`${BIMS_SYNC_URL}?entity=products&page=${pageNum}&limit=${PAGE_SIZE}`, {
          method: "POST",
          headers: HEADERS,
        });

        if (!res.ok) {
          newFailedPages.push(pageNum);
          pageErrors++;
          totalFailed++;
          allErrors.push({ code: `page_${pageNum}`, message: `HTTP ${res.status}`, stage: "fetch", timestamp: new Date().toISOString() });
          continue;
        }

        const data = await res.json();
        if (!data.success) {
          newFailedPages.push(pageNum);
          pageErrors++;
          totalFailed++;
          allErrors.push({ code: `page_${pageNum}`, message: data.error || "Unknown", stage: "fetch", timestamp: new Date().toISOString() });
          continue;
        }

        const s = data.stats;
        totalReceived += s.total_received || 0;
        totalProcessed += s.total_processed || 0;
        totalInserted += s.total_inserted || 0;
        totalUpdated += s.total_updated || 0;
        totalFailed += s.total_failed || 0;
        totalSkipped += s.total_skipped || 0;
        if (s.errors?.length) allErrors.push(...s.errors);
        if (s.total_failed > 0) newFailedPages.push(pageNum);
        pagesProcessed++;

        if (Array.isArray(data.active_bims_codes)) {
          allActiveBimsCodes.push(...data.active_bims_codes);
        }
        if (data.total_inactive_skipped) {
          totalInactiveSkipped += data.total_inactive_skipped;
        }

        if (data.bims_total_count != null && !isNaN(Number(data.bims_total_count))) {
          bimsTotalCount = Number(data.bims_total_count);
        }

        setProdProgress(prev => ({
          ...prev,
          currentPage: pageNum,
          totalPages: pagesProcessed,
          totalProcessed,
          totalInserted,
          totalUpdated,
          totalFailed,
          totalSkipped,
          totalReceived,
          bimsTotalCount,
          errors: allErrors.slice(0, 200),
          durationMs: Date.now() - startTime,
          totalPagesAttempted: pagesAttempted,
          totalPageErrors: pageErrors,
        }));

        if (!retryPages && !data.has_more) break;
      } catch (err: any) {
        newFailedPages.push(pageNum);
        pageErrors++;
        totalFailed++;
        allErrors.push({ code: `page_${pageNum}`, message: err.message, stage: "fetch", timestamp: new Date().toISOString() });
      }
    }

    // Determine sync completion status
    const syncCompletedCleanly = pageErrors === 0 && newFailedPages.length === 0;

    // RULE 1: Only deactivate if sync completed without ANY errors
    let phase: SyncPhase;
    if (!retryPages && allActiveBimsCodes.length > 0 && syncCompletedCleanly) {
      const deactivateResult = await executeDeactivation(allActiveBimsCodes, pagesProcessed, 0);
      if (deactivateResult === "threshold") {
        phase = "awaiting_confirmation";
      } else if (deactivateResult === "success") {
        phase = "completed";
      } else {
        phase = "completed"; // Deactivation failed but sync itself completed
      }
    } else if (!syncCompletedCleanly) {
      // RULE 1: Sync incomplete — do NOT deactivate
      phase = pageErrors > 0 ? (totalProcessed > 0 ? "incomplete" : "error") : "incomplete";
      if (!retryPages) {
        toast.warning("Sincronización incompleta. No se ejecutó baja lógica para proteger datos.");
      }
    } else {
      phase = totalProcessed > 0 ? "completed" : "error";
    }

    const finalStatus: SyncStatus = totalFailed > 0
      ? (totalProcessed > 0 ? "partial" : "error")
      : "success";

    setProdProgress(prev => ({
      ...prev,
      isRunning: false,
      status: finalStatus,
      phase,
      totalPages: pagesProcessed,
      totalProcessed,
      totalInserted,
      totalUpdated,
      totalFailed,
      totalSkipped,
      totalReceived,
      bimsTotalCount,
      errors: allErrors.slice(0, 200),
      failedPages: newFailedPages,
      durationMs: Date.now() - startTime,
      totalPagesAttempted: pagesAttempted,
      totalPageErrors: pageErrors,
    }));

    // Release lock
    syncLockRef.current = false;

    queryClient.invalidateQueries({ queryKey: ["products-count"] });
    queryClient.invalidateQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["sync-logs-recent"] });
    queryClient.invalidateQueries({ queryKey: ["sync-run-totals"] });

    if (finalStatus === "success" && phase === "completed") {
      const inactiveMsg = totalInactiveSkipped > 0 ? ` (${totalInactiveSkipped} inactivos omitidos)` : "";
      toast.success(`Productos: ${totalProcessed} activos sincronizados en ${formatDuration(Date.now() - startTime)}${inactiveMsg}`);
    } else if (finalStatus === "partial") {
      toast.warning(`Sincronización parcial: ${totalProcessed} OK, ${totalFailed} con error (${newFailedPages.length} páginas fallidas)`);
    } else if (phase === "awaiting_confirmation") {
      // Toast handled by threshold dialog
    } else if (phase !== "completed") {
      toast.error("Error en sincronización de productos");
    }
  }, [prodProgress, executeDeactivation, queryClient]);

  const runFullSync = async () => {
    await syncWarehouses();
    await syncProducts();
  };

  const isAnySyncing = whState.status === "loading" || prodProgress.isRunning;
  const progressPercent = prodProgress.totalReceived > 0
    ? Math.round((prodProgress.totalProcessed / prodProgress.totalReceived) * 100)
    : (prodProgress.isRunning ? 0 : 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Sincronización BIMS</h1>
          <p className="text-sm text-muted-foreground">Importar y actualizar datos maestros desde BIMS ERP</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={testConnection} disabled={connStatus === "loading" || isAnySyncing}>
            {connStatus === "loading" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Database className="h-4 w-4 mr-2" />}
            Probar conexión
          </Button>
          <Button onClick={runFullSync} disabled={isAnySyncing}>
            {isAnySyncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Sincronizar todo
          </Button>
        </div>
      </div>

      {/* Connection status */}
      {connStatus !== "idle" && (
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-3 text-sm">
              <StatusIcon status={connStatus} />
              <span>{connMessage}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sync phase banner */}
      {prodProgress.phase !== "idle" && prodProgress.phase !== "syncing" && (
        <Card className={`border ${
          prodProgress.phase === "completed" ? "border-green-500/30 bg-green-500/5" :
          prodProgress.phase === "incomplete" ? "border-amber-500/30 bg-amber-500/5" :
          prodProgress.phase === "awaiting_confirmation" ? "border-amber-500/30 bg-amber-500/5" :
          prodProgress.phase === "error" ? "border-destructive/30 bg-destructive/5" : ""
        }`}>
          <CardContent className="py-3">
            <div className="flex items-start gap-3 text-sm">
              <PhaseIcon phase={prodProgress.phase} />
              <div>
                <p className="font-medium text-foreground">
                  Sincronización: {PHASE_LABELS[prodProgress.phase]}
                </p>
                <p className="text-muted-foreground text-xs mt-0.5">
                  {prodProgress.phase === "completed" && "Todos los datos son confiables y están actualizados."}
                  {prodProgress.phase === "incomplete" && (
                    <>
                      {prodProgress.totalPageErrors} página(s) con error. 
                      <strong className="text-amber-600"> No se ejecutó baja lógica</strong> para proteger la integridad de los datos.
                    </>
                  )}
                  {prodProgress.phase === "awaiting_confirmation" && "Se detectó una cantidad inusual de productos a desactivar. Requiere confirmación manual."}
                  {prodProgress.phase === "error" && "La sincronización falló. Reintente manualmente."}
                </p>
                {prodProgress.durationMs > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Duración: {formatDuration(prodProgress.durationMs)} • {prodProgress.totalPagesAttempted} páginas procesadas
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Catalog status banner */}
      {catalogStatus !== "complete" && catalogStatus !== "in_progress" && prodProgress.phase === "idle" && (
        <Card className={`border-destructive/30 ${catalogStatus === "unknown" ? "bg-muted/30" : "bg-destructive/5"}`}>
          <CardContent className="py-3">
            <div className="flex items-start gap-3 text-sm">
              <ShieldAlert className={`h-5 w-5 shrink-0 mt-0.5 ${catalogStatus === "unknown" ? "text-muted-foreground" : "text-destructive"}`} />
              <div>
                <p className="font-medium text-foreground">
                  Estado del catálogo: {CATALOG_STATUS_LABELS[catalogStatus]}
                </p>
                <p className="text-muted-foreground">
                  {CATALOG_STATUS_DESCRIPTIONS[catalogStatus]}
                  {effectiveCatalogSize > 0 && (
                    <span className="ml-1">
                      ({productCount} de {effectiveCatalogSize} productos — {Math.round(catalogCoverage * 100)}%)
                      {totalMissing > 0 && <span className="text-destructive font-medium"> — {totalMissing} faltantes</span>}
                    </span>
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {catalogStatus === "complete" && prodProgress.phase === "idle" && (
        <Card className="border-green-500/30 bg-green-500/5">
          <CardContent className="py-3">
            <div className="flex items-start gap-3 text-sm">
              <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-foreground">
                  Catálogo completo — Sistema operativo
                </p>
                <p className="text-muted-foreground">
                  {productCount} de {effectiveCatalogSize} productos sincronizados (100%).
                  {lastSuccessSync && (
                    <span className="ml-1">
                      Última sincronización: {new Date(lastSuccessSync.created_at).toLocaleString("es-PY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Metrics grid */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="py-4 flex items-center gap-3">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-2xl font-bold">{branchCount}</p>
              <p className="text-xs text-muted-foreground">Sucursales</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 flex items-center gap-3">
            <Package className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-2xl font-bold">{productCount}</p>
              <p className="text-xs text-muted-foreground">Activos en SLIS</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-2xl font-bold">{effectiveCatalogSize > 0 ? effectiveCatalogSize : "—"}</p>
            <p className="text-xs text-muted-foreground">Procesados desde BIMS</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className={`text-2xl font-bold ${totalMissing > 0 ? "text-destructive" : ""}`}>{effectiveCatalogSize > 0 ? totalMissing : "—"}</p>
            <p className="text-xs text-muted-foreground">Faltantes</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <Badge variant={catalogHealthy ? "default" : "destructive"} className="text-[10px]">
              {CATALOG_STATUS_LABELS[catalogStatus]}
            </Badge>
            <p className="text-xs text-muted-foreground mt-1">Estado</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className={`text-lg font-bold ${catalogHealthy ? "text-green-600" : catalogCoverage < 0 ? "text-muted-foreground" : "text-destructive"}`}>
              {catalogCoverage >= 0 ? `${Math.round(catalogCoverage * 100)}%` : "Sin ref."}
            </p>
            <p className="text-xs text-muted-foreground">Cobertura</p>
          </CardContent>
        </Card>
      </div>

      {/* Warehouse sync result */}
      {whState.status !== "idle" && whState.status !== "loading" && whState.stats && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <StatusIcon status={whState.status} />
              Sucursales — {whState.stats.total_processed} procesadas
              {whState.durationMs != null && <span className="text-xs text-muted-foreground ml-auto">{formatDuration(whState.durationMs)}</span>}
            </CardTitle>
          </CardHeader>
        </Card>
      )}

      {/* Product sync progress */}
      {(prodProgress.isRunning || prodProgress.status !== "idle") && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <StatusIcon status={prodProgress.status} />
                Productos
                {prodProgress.isRunning && <span className="text-xs text-muted-foreground">Página {prodProgress.currentPage}...</span>}
                {!prodProgress.isRunning && (
                  <span className={`text-xs ${PHASE_COLORS[prodProgress.phase]}`}>
                    — {PHASE_LABELS[prodProgress.phase]}
                  </span>
                )}
              </CardTitle>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {prodProgress.durationMs > 0 && (
                  <span className="flex items-center gap-1"><Timer className="h-3 w-3" />{formatDuration(prodProgress.durationMs)}</span>
                )}
                {prodProgress.totalPagesAttempted > 0 && (
                  <span>{prodProgress.totalPagesAttempted} págs</span>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Progress bar */}
            {prodProgress.isRunning && (
              <div className="space-y-1">
                <Progress value={progressPercent} className="h-2" />
                <p className="text-xs text-muted-foreground text-center">
                  {prodProgress.totalProcessed} procesados • Página {prodProgress.currentPage}
                  {prodProgress.totalPageErrors > 0 && (
                    <span className="text-amber-500 ml-2">• {prodProgress.totalPageErrors} pág(s) con error</span>
                  )}
                </p>
              </div>
            )}

            {/* Stats grid */}
            <div className="grid grid-cols-6 gap-3 text-center">
              {[
                { label: "Recibidos", value: prodProgress.totalReceived },
                { label: "Procesados", value: prodProgress.totalProcessed },
                { label: "Insertados", value: prodProgress.totalInserted },
                { label: "Actualizados", value: prodProgress.totalUpdated },
                { label: "Omitidos", value: prodProgress.totalSkipped },
                { label: "Fallidos", value: prodProgress.totalFailed, isError: true },
              ].map(({ label, value, isError }) => (
                <div key={label} className="p-2 rounded bg-muted/30 border border-border/30">
                  <p className={`text-lg font-bold ${isError && value > 0 ? "text-destructive" : ""}`}>{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>

            {/* Errors */}
            {prodProgress.errors.length > 0 && (
              <div>
                <Button variant="ghost" size="sm" onClick={() => setShowErrors(!showErrors)} className="text-xs gap-1">
                  {showErrors ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  Ver {prodProgress.errors.length} error(es) por etapa
                </Button>
                {showErrors && (
                  <div className="mt-2 max-h-[300px] overflow-y-auto">
                    <ErrorsByStage errors={prodProgress.errors} />
                  </div>
                )}
              </div>
            )}

            {/* Retry failed pages */}
            {!prodProgress.isRunning && prodProgress.failedPages.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => syncProducts(prodProgress.failedPages)} className="gap-1">
                <RefreshCw className="h-3.5 w-3.5" />
                Reintentar {prodProgress.failedPages.length} página(s) fallida(s)
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Loading state for warehouses */}
      {whState.status === "loading" && (
        <Card>
          <CardContent className="py-6 text-center space-y-2">
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
            <p className="text-sm text-muted-foreground">Sincronizando sucursales...</p>
          </CardContent>
        </Card>
      )}

      {/* Recent logs */}
      {lastLogs && lastLogs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Historial de sincronizaciones</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left p-2">Entidad</th>
                    <th className="text-left p-2">Estado</th>
                    <th className="text-right p-2">Recibidos</th>
                    <th className="text-right p-2">Procesados</th>
                    <th className="text-right p-2">Insertados</th>
                    <th className="text-right p-2">Actualizados</th>
                    <th className="text-right p-2">Fallidos</th>
                    <th className="text-right p-2">Duración</th>
                    <th className="text-left p-2">Origen</th>
                    <th className="text-left p-2">Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {lastLogs.map((log: any) => {
                    const duration = log.duration_seconds != null
                      ? formatDuration(log.duration_seconds * 1000)
                      : "—";
                    const statusLabel = log.status === "success" ? "OK" :
                      log.status === "partial" ? "Parcial" :
                      log.status === "blocked" ? "Bloqueado" : "Error";
                    const statusVariant = log.status === "success" ? "default" :
                      log.status === "partial" ? "secondary" :
                      log.status === "blocked" ? "outline" : "destructive";
                    return (
                      <tr key={log.id} className="border-b border-border/30">
                        <td className="p-2 font-medium capitalize">{log.entity}</td>
                        <td className="p-2">
                          <Badge variant={statusVariant as any} className="text-[10px]">
                            {statusLabel}
                          </Badge>
                        </td>
                        <td className="p-2 text-right">{log.total_received ?? 0}</td>
                        <td className="p-2 text-right">{log.total_processed ?? 0}</td>
                        <td className="p-2 text-right">{log.total_inserted ?? 0}</td>
                        <td className="p-2 text-right">{log.total_updated ?? 0}</td>
                        <td className="p-2 text-right text-destructive">{log.total_failed ?? 0}</td>
                        <td className="p-2 text-right text-muted-foreground">{duration}</td>
                        <td className="p-2 text-muted-foreground">{log.triggered_by || "system"}</td>
                        <td className="p-2 text-muted-foreground">
                          {new Date(log.created_at).toLocaleString("es-PY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Threshold confirmation dialog */}
      <AlertDialog open={!!thresholdAlert} onOpenChange={(open) => { if (!open) handleThresholdCancel(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-amber-600">
              <ShieldAlert className="h-5 w-5" />
              Cantidad inusual de productos a desactivar
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  La sincronización detectó que <strong className="text-foreground">{thresholdAlert?.total_to_deactivate}</strong> de{" "}
                  <strong className="text-foreground">{thresholdAlert?.total_current_active}</strong> productos activos
                  ({thresholdAlert?.deactivate_percent}%) serían dados de baja lógica.
                </p>
                <p>
                  Esto supera el umbral de seguridad del {thresholdAlert?.threshold_percent}%.
                  Puede ser causado por una falla en la API de BIMS, respuesta incompleta o problema de red.
                </p>
                {thresholdAlert && thresholdAlert.products_to_deactivate.length > 0 && (
                  <div className="bg-muted/50 rounded p-2 max-h-32 overflow-y-auto text-xs">
                    <p className="font-medium mb-1">Primeros productos a desactivar:</p>
                    {thresholdAlert.products_to_deactivate.map((p, i) => (
                      <span key={i} className="font-mono">{p.bims_code}{i < thresholdAlert.products_to_deactivate.length - 1 ? ", " : ""}</span>
                    ))}
                    {thresholdAlert.total_to_deactivate > 50 && (
                      <p className="mt-1 text-muted-foreground">... y {thresholdAlert.total_to_deactivate - 50} más</p>
                    )}
                  </div>
                )}
                <p className="font-medium text-foreground">
                  ¿Desea confirmar la desactivación de estos productos?
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleThresholdCancel}>
              <Ban className="h-4 w-4 mr-1" />
              Cancelar — No desactivar
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleThresholdConfirm} className="bg-amber-600 hover:bg-amber-700">
              <ShieldAlert className="h-4 w-4 mr-1" />
              Confirmar desactivación
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
