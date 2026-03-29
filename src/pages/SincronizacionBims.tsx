import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Database, RefreshCw, Loader2, CheckCircle2, AlertTriangle, Building2, Package, Users } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const BIMS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bims-proxy`;
const HEADERS = {
  "Content-Type": "application/json",
  apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
};

type SyncStatus = "idle" | "loading" | "success" | "error";

interface SyncResult {
  status: SyncStatus;
  message?: string;
  count?: number;
  lastSync?: Date;
}

export default function SincronizacionBims() {
  const queryClient = useQueryClient();
  const [syncState, setSyncState] = useState<Record<string, SyncResult>>({
    warehouses: { status: "idle" },
    products: { status: "idle" },
    connection: { status: "idle" },
  });

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

  const syncWarehouses = async () => {
    updateSync("warehouses", { status: "loading" });
    try {
      const res = await fetch(`${BIMS_URL}?action=sync-warehouses`, { method: "POST", headers: HEADERS });
      const data = await res.json();
      if (res.ok && data.success) {
        updateSync("warehouses", { status: "success", count: data.synced, message: `${data.synced} sucursales sincronizadas`, lastSync: new Date() });
        toast.success(`${data.synced} sucursales sincronizadas desde BIMS`);
        queryClient.invalidateQueries({ queryKey: ["branches"] });
        queryClient.invalidateQueries({ queryKey: ["branches-count"] });
      } else {
        updateSync("warehouses", { status: "error", message: data.error });
        toast.error(`Error: ${data.error}`);
      }
    } catch (err: any) {
      updateSync("warehouses", { status: "error", message: err.message });
      toast.error(`Error: ${err.message}`);
    }
  };

  const syncProducts = async () => {
    updateSync("products", { status: "loading" });
    try {
      const res = await fetch(`${BIMS_URL}?action=sync-products`, { method: "POST", headers: HEADERS });
      const data = await res.json();
      if (res.ok && data.success) {
        updateSync("products", { status: "success", count: data.synced, message: `${data.synced} productos sincronizados`, lastSync: new Date() });
        toast.success(`${data.synced} productos sincronizados desde BIMS`);
        queryClient.invalidateQueries({ queryKey: ["products"] });
        queryClient.invalidateQueries({ queryKey: ["products-count"] });
      } else {
        updateSync("products", { status: "error", message: data.error });
        toast.error(`Error: ${data.error}`);
      }
    } catch (err: any) {
      updateSync("products", { status: "error", message: err.message });
      toast.error(`Error: ${err.message}`);
    }
  };

  const syncAll = async () => {
    await testConnection();
    if (syncState.connection?.status === "error") return;
    await syncWarehouses();
    await syncProducts();
  };

  const StatusIcon = ({ status }: { status: SyncStatus }) => {
    switch (status) {
      case "loading": return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
      case "success": return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "error": return <AlertTriangle className="h-4 w-4 text-destructive" />;
      default: return null;
    }
  };

  const syncItems = [
    {
      key: "connection",
      icon: Database,
      title: "Conexión BIMS",
      description: "Verificar conectividad con el servidor BIMS",
      action: testConnection,
      actionLabel: "Probar conexión",
    },
    {
      key: "warehouses",
      icon: Building2,
      title: "Sucursales / Depósitos",
      description: `${branchCount} sucursales en SLIS`,
      action: syncWarehouses,
      actionLabel: "Sincronizar sucursales",
    },
    {
      key: "products",
      icon: Package,
      title: "Productos",
      description: `${productCount} productos en SLIS`,
      action: syncProducts,
      actionLabel: "Sincronizar productos",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Sincronización BIMS</h1>
          <p className="text-sm text-muted-foreground">Importar y actualizar datos maestros desde BIMS ERP</p>
        </div>
        <Button onClick={syncAll} disabled={Object.values(syncState).some((s) => s.status === "loading")}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Sincronizar todo
        </Button>
      </div>

      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-3 text-sm">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span className="text-muted-foreground">
              Sincronización automática configurada — se ejecuta <strong>cada hora</strong> desde BIMS.
              Usá los botones de abajo solo si necesitás forzar una sincronización inmediata.
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {syncItems.map((item) => {
          const state = syncState[item.key];
          return (
            <Card key={item.key} className="relative">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <item.icon className="h-4 w-4" />
                    {item.title}
                  </CardTitle>
                  <StatusIcon status={state.status} />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">{item.description}</p>

                {state.message && (
                  <Badge variant={state.status === "error" ? "destructive" : "default"} className="text-xs">
                    {state.message}
                  </Badge>
                )}

                {state.lastSync && (
                  <p className="text-[10px] text-muted-foreground">
                    Última: {state.lastSync.toLocaleTimeString("es-PY")}
                  </p>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={item.action}
                  disabled={state.status === "loading"}
                >
                  {state.status === "loading" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5 mr-2" />
                  )}
                  {item.actionLabel}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
