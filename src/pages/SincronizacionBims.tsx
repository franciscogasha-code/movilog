import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Database, RefreshCw, Loader2, CheckCircle2, AlertTriangle, Building2, Package, ChevronDown, ChevronUp, XCircle } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const BIMS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bims-proxy`;
const BIMS_SYNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bims-sync`;
const HEADERS = {
  "Content-Type": "application/json",
  apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
};

type SyncStatus = "idle" | "loading" | "success" | "partial" | "error";

interface SyncResult {
  status: SyncStatus;
  message?: string;
  totalProcessed?: number;
  totalFailed?: number;
  totalInserted?: number;
  totalUpdated?: number;
  totalReceived?: number;
  errors?: { code: string; message: string; stage: string; timestamp: string }[];
  lastSync?: Date;
}

export default function SincronizacionBims() {
  const queryClient = useQueryClient();
  const [syncState, setSyncState] = useState<Record<string, SyncResult>>({
    connection: { status: "idle" },
    full: { status: "idle" },
  });
  const [showErrors, setShowErrors] = useState<string | null>(null);

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
      const { count } = await supabase.from("products").select("*", { count: "exact", head: true });
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
        .limit(10);
      return data || [];
    },
  });

  const updateSync = (key: string, result: SyncResult) => {
    setSyncState((prev) => ({ ...prev, [key]: result }));
  };

  const testConnection = async () => {
    updateSync("connection", { status: "loading" });
    try {
      const res = await fetch(`${BIMS_URL}?action=test-connection`, { method: "POST", headers: HEADERS });
      const data = await res.json();
      if (res.ok && data.success) {
        updateSync("connection", { status: "success", message: "Conexión exitosa", lastSync: new Date() });
        toast.success("Conexión con BIMS exitosa");
      } else {
        updateSync("connection", { status: "error", message: data.error || "Error desconocido" });
        toast.error(`Error BIMS: ${data.error}`);
      }
    } catch (err: any) {
      updateSync("connection", { status: "error", message: err.message });
      toast.error(`Error: ${err.message}`);
    }
  };

  const runFullSync = async () => {
    updateSync("full", { status: "loading", message: "Sincronizando..." });
    try {
      const res = await fetch(BIMS_SYNC_URL, { method: "POST", headers: HEADERS });
      const data = await res.json();

      if (res.ok && data.success) {
        const whR = data.results?.warehouses;
        const prR = data.results?.products;
        const totalFailed = (whR?.total_failed || 0) + (prR?.total_failed || 0);
        const totalProcessed = (whR?.total_processed || 0) + (prR?.total_processed || 0);
        const allErrors = [...(whR?.errors || []), ...(prR?.errors || [])];

        const status: SyncStatus = totalFailed > 0 ? (totalProcessed > 0 ? "partial" : "error") : "success";
        const statusLabel = status === "success" ? "Sincronizado" : status === "partial" ? "Sincronización parcial" : "Error en sincronización";

        updateSync("full", {
          status,
          message: statusLabel,
          totalReceived: (whR?.total_received || 0) + (prR?.total_received || 0),
          totalProcessed,
          totalInserted: (whR?.total_inserted || 0) + (prR?.total_inserted || 0),
          totalUpdated: (whR?.total_updated || 0) + (prR?.total_updated || 0),
          totalFailed,
          errors: allErrors,
          lastSync: new Date(),
        });

        if (status === "success") {
          toast.success(`Sincronización completa: ${totalProcessed} registros procesados`);
        } else {
          toast.warning(`Sincronización parcial: ${totalProcessed} OK, ${totalFailed} fallidos`);
        }

        queryClient.invalidateQueries({ queryKey: ["branches"] });
        queryClient.invalidateQueries({ queryKey: ["branches-count"] });
        queryClient.invalidateQueries({ queryKey: ["products"] });
        queryClient.invalidateQueries({ queryKey: ["products-count"] });
        queryClient.invalidateQueries({ queryKey: ["sync-logs-recent"] });
      } else {
        updateSync("full", { status: "error", message: data.error || "Error desconocido" });
        toast.error(`Error: ${data.error}`);
      }
    } catch (err: any) {
      updateSync("full", { status: "error", message: err.message });
      toast.error(`Error: ${err.message}`);
    }
  };

  const fullState = syncState.full;
  const connState = syncState.connection;

  const StatusIcon = ({ status }: { status: SyncStatus }) => {
    switch (status) {
      case "loading": return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
      case "success": return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "partial": return <AlertTriangle className="h-4 w-4 text-amber-500" />;
      case "error": return <XCircle className="h-4 w-4 text-destructive" />;
      default: return null;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Sincronización BIMS</h1>
          <p className="text-sm text-muted-foreground">Importar y actualizar datos maestros desde BIMS ERP</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={testConnection} disabled={connState.status === "loading"}>
            {connState.status === "loading" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Database className="h-4 w-4 mr-2" />}
            Probar conexión
          </Button>
          <Button onClick={runFullSync} disabled={fullState.status === "loading"}>
            {fullState.status === "loading" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Sincronizar todo
          </Button>
        </div>
      </div>

      {/* Connection status */}
      {connState.status !== "idle" && (
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-3 text-sm">
              <StatusIcon status={connState.status} />
              <span>{connState.message}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Current counts */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="py-4 flex items-center gap-3">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-2xl font-bold">{branchCount}</p>
              <p className="text-xs text-muted-foreground">Sucursales en SLIS</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 flex items-center gap-3">
            <Package className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-2xl font-bold">{productCount}</p>
              <p className="text-xs text-muted-foreground">Productos en SLIS</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sync results */}
      {fullState.status !== "idle" && fullState.status !== "loading" && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <StatusIcon status={fullState.status} />
                {fullState.message}
              </CardTitle>
              {fullState.lastSync && (
                <span className="text-xs text-muted-foreground">
                  {fullState.lastSync.toLocaleString("es-PY")}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-5 gap-3 text-center">
              {[
                { label: "Recibidos", value: fullState.totalReceived },
                { label: "Procesados", value: fullState.totalProcessed },
                { label: "Insertados", value: fullState.totalInserted },
                { label: "Actualizados", value: fullState.totalUpdated },
                { label: "Fallidos", value: fullState.totalFailed, isError: true },
              ].map(({ label, value, isError }) => (
                <div key={label} className="p-2 rounded bg-muted/30 border border-border/30">
                  <p className={`text-lg font-bold ${isError && (value ?? 0) > 0 ? "text-destructive" : ""}`}>{value ?? 0}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>

            {(fullState.errors?.length ?? 0) > 0 && (
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowErrors(showErrors === "full" ? null : "full")}
                  className="text-xs gap-1"
                >
                  {showErrors === "full" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  Ver {fullState.errors!.length} error(es)
                </Button>
                {showErrors === "full" && (
                  <div className="mt-2 max-h-[200px] overflow-y-auto space-y-1">
                    {fullState.errors!.map((err, i) => (
                      <div key={i} className="flex items-start gap-2 p-2 rounded bg-destructive/5 border border-destructive/10 text-xs">
                        <XCircle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
                        <div>
                          <span className="font-mono font-medium">{err.code}</span>
                          <span className="text-muted-foreground mx-1">•</span>
                          <span className="text-muted-foreground">[{err.stage}]</span>
                          <p className="text-muted-foreground">{err.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {fullState.status === "partial" && (
              <Button variant="outline" size="sm" onClick={runFullSync} className="gap-1">
                <RefreshCw className="h-3.5 w-3.5" /> Reintentar sincronización
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Loading state */}
      {fullState.status === "loading" && (
        <Card>
          <CardContent className="py-8 text-center space-y-2">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
            <p className="text-sm text-muted-foreground">Sincronizando datos desde BIMS...</p>
            <p className="text-xs text-muted-foreground">Esto puede tardar varios minutos para catálogos grandes.</p>
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
                    <th className="text-right p-2">Procesados</th>
                    <th className="text-right p-2">Insertados</th>
                    <th className="text-right p-2">Actualizados</th>
                    <th className="text-right p-2">Fallidos</th>
                    <th className="text-left p-2">Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {lastLogs.map((log: any) => (
                    <tr key={log.id} className="border-b border-border/30">
                      <td className="p-2 font-medium capitalize">{log.entity}</td>
                      <td className="p-2">
                        <Badge
                          variant={log.status === "success" ? "default" : log.status === "partial" ? "secondary" : "destructive"}
                          className="text-[10px]"
                        >
                          {log.status === "success" ? "OK" : log.status === "partial" ? "Parcial" : "Error"}
                        </Badge>
                      </td>
                      <td className="p-2 text-right">{log.total_processed ?? 0}</td>
                      <td className="p-2 text-right">{log.total_inserted ?? 0}</td>
                      <td className="p-2 text-right">{log.total_updated ?? 0}</td>
                      <td className="p-2 text-right text-destructive">{log.total_failed ?? 0}</td>
                      <td className="p-2 text-muted-foreground">
                        {new Date(log.created_at).toLocaleString("es-PY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
