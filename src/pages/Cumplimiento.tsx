import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/StatusBadge";
import { FULFILLMENT_STATUS_CONFIG, SHIPPING_METHOD_LABELS, REQUEST_TYPE_LABELS, COMMERCIAL_EXCEPTION_STATUS_LABELS } from "@/lib/constants";
import { Package, Truck, MapPin, Search, Clock, User } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useUserBranchFilter } from "@/hooks/use-user-access";
import { usePaginatedQuery } from "@/hooks/use-paginated-query";
import { PaginationBar } from "@/components/shared/PaginationBar";

// MODULE 5: Priority order (visual only, no blocking)
const PRIORITY_ORDER: Record<string, number> = {
  consultation: 1,
  client: 2,
  online: 3,
  redistribution: 4,
  reposition: 5,
  mixed: 3,
};

const PRIORITY_LABELS: Record<number, { label: string; color: string }> = {
  1: { label: "🔴 Consultas", color: "border-destructive/30" },
  2: { label: "🟠 Entregas cliente", color: "border-secondary/30" },
  3: { label: "🟡 Online / Mixto", color: "border-warning/30" },
  4: { label: "🔵 Redistribución", color: "border-info/30" },
  5: { label: "⚪ Reposición sucursal", color: "border-border" },
};

// MODULE 6: Custody state labels
const CUSTODY_LABELS: Record<string, string> = {
  pending: "En sucursal origen",
  picking: "En sucursal origen",
  waiting_for_cut: "En sucursal origen",
  waiting_for_courier: "En sucursal origen",
  dispatched: "Con chofer",
  in_transit: "Con chofer",
  pending_physical_confirmation: "Pend. confirmación física",
  delivered: "Entregado",
  received: "En sucursal destino",
  completed: "Completado",
  cancelled: "Cancelado",
};

export default function Cumplimiento() {
  const [search, setSearch] = useState("");
  const { isAllBranches, allowedBranchIds } = useUserBranchFilter();

  // Debounce búsqueda server-side por # pedido o cliente
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const {
    rows: fulfillments,
    total,
    page,
    pageSize,
    totalPages,
    from,
    to,
    isLoading,
    isFetching,
    setPage,
  } = usePaginatedQuery<any>({
    queryKey: ["all-fulfillments-prioritized", debouncedSearch, isAllBranches, allowedBranchIds],
    initialPageSize: 25,
    buildQuery: () => {
      let query: any = supabase
        .from("fulfillment_orders")
        .select(
          `*,
           source_branch:branches!fulfillment_orders_source_branch_id_fkey(name, code),
           destination_branch:branches!fulfillment_orders_destination_branch_id_fkey(name, code),
           trip:trips(trip_number, status),
           branch_request:branch_requests(request_number, request_type, delivery_target, client_name)`,
          { count: "exact" },
        )
        .in("status", ["pending", "picking", "waiting_for_cut", "waiting_for_courier", "dispatched", "in_transit", "pending_physical_confirmation"] as any)
        .order("created_at", { ascending: false });

      if (!isAllBranches && allowedBranchIds.length > 0) {
        query = query.or(`source_branch_id.in.(${allowedBranchIds.join(",")}),destination_branch_id.in.(${allowedBranchIds.join(",")})`);
      }

      if (debouncedSearch) {
        query = query.or(`destination_client_name.ilike.%${debouncedSearch}%,bims_invoice_number.ilike.%${debouncedSearch}%`);
      }

      return query;
    },
  });

  // La búsqueda ya es server-side; aplicamos directamente el resultado paginado.
  const filtered = fulfillments;

  // Group by priority (sobre la página visible)
  const grouped = new Map<number, any[]>();
  filtered?.forEach((f: any) => {
    const requestType = (f.branch_request as any)?.request_type || "reposition";
    const priority = PRIORITY_ORDER[requestType] || 5;
    if (!grouped.has(priority)) grouped.set(priority, []);
    grouped.get(priority)!.push(f);
  });

  const sortedPriorities = Array.from(grouped.entries()).sort((a, b) => a[0] - b[0]);

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Ejecución Física</h1>
        <p className="text-muted-foreground mt-1">Bandeja de fulfillment priorizada — custodia y ubicación en tiempo real</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="glass-card">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-primary/10 p-2.5 rounded-xl"><Package className="h-5 w-5 text-primary" /></div>
            <div><p className="text-xs text-muted-foreground uppercase">Total activas</p><p className="text-2xl font-display font-bold">{total}</p></div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-secondary/10 p-2.5 rounded-xl"><Clock className="h-5 w-5 text-secondary" /></div>
            <div><p className="text-xs text-muted-foreground uppercase">Esperando</p><p className="text-2xl font-display font-bold">
              {fulfillments?.filter((f: any) => ["pending", "picking", "waiting_for_cut"].includes(f.status)).length || 0}
            </p></div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-info/10 p-2.5 rounded-xl"><Truck className="h-5 w-5 text-info" /></div>
            <div><p className="text-xs text-muted-foreground uppercase">Con chofer</p><p className="text-2xl font-display font-bold">
              {fulfillments?.filter((f: any) => ["dispatched", "in_transit"].includes(f.status)).length || 0}
            </p></div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-warning/10 p-2.5 rounded-xl"><MapPin className="h-5 w-5 text-warning" /></div>
            <div><p className="text-xs text-muted-foreground uppercase">Pend. confirm.</p><p className="text-2xl font-display font-bold">
              {fulfillments?.filter((f: any) => f.status === "pending_physical_confirmation").length || 0}
            </p></div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por cliente o factura BIMS..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        {totalPages > 1 && (
          <p className="text-[11px] text-muted-foreground italic">
            La agrupación por prioridad se aplica dentro de la página actual.
          </p>
        )}
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground">Cargando...</div>
      ) : sortedPriorities.length === 0 ? (
        <div className="p-8 text-center text-muted-foreground">
          <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>Sin fulfillments activos</p>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedPriorities.map(([priority, items]) => {
            const priorityCfg = PRIORITY_LABELS[priority] || PRIORITY_LABELS[5];
            return (
              <Card key={priority} className={`glass-card ${priorityCfg.color}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="font-display text-sm">{priorityCfg.label} ({items.length})</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y divide-border/50">
                    {items.map((f: any) => {
                      const statusCfg = FULFILLMENT_STATUS_CONFIG[f.status] || FULFILLMENT_STATUS_CONFIG.pending;
                      const clientName = f.destination_client_name || (f.branch_request as any)?.client_name;
                      const custody = CUSTODY_LABELS[f.status] || f.status;
                      const requestType = (f.branch_request as any)?.request_type;
                      const commExcCfg = f.commercial_exception_status
                        ? COMMERCIAL_EXCEPTION_STATUS_LABELS[f.commercial_exception_status]
                        : null;

                      return (
                        <div key={f.id} className="p-3 hover:bg-muted/20 transition-colors">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                {(f.branch_request as any)?.request_number && (
                                  <span className="font-mono text-xs text-muted-foreground">#{(f.branch_request as any).request_number}</span>
                                )}
                                {clientName && <span className="font-semibold text-sm truncate">{clientName}</span>}
                                {requestType && (
                                  <Badge variant="outline" className="text-[10px]">{REQUEST_TYPE_LABELS[requestType] || requestType}</Badge>
                                )}
                                {commExcCfg && (
                                  <Badge className={`text-[10px] ${commExcCfg.color}`}>
                                    {commExcCfg.label} · No bloqueante
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                                <span>{f.source_branch?.code} → {f.destination_branch?.code || "Cliente"}</span>
                                <span>{SHIPPING_METHOD_LABELS[f.shipping_method] || f.shipping_method}</span>
                                <span className="flex items-center gap-1">
                                  <User className="h-3 w-3" /> {custody}
                                </span>
                              </div>
                            </div>
                            <Badge className={`text-xs shrink-0 ${statusCfg.color}`}>{statusCfg.label}</Badge>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {!isLoading && total > 0 && (
        <Card className="glass-card">
          <PaginationBar
            page={page}
            pageSize={pageSize}
            total={total}
            totalPages={totalPages}
            from={from}
            to={to}
            onPageChange={setPage}
            isFetching={isFetching}
            itemLabel="fulfillments"
          />
        </Card>
      )}
    </motion.div>
  );
}
