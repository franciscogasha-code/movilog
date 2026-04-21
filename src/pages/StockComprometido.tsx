import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Lock, Unlock, Clock, AlertTriangle } from "lucide-react";
import { branchName } from "@/lib/branch-format";

export default function StockComprometido() {
  const { data: reserves, isLoading } = useQuery({
    queryKey: ["committed-stock"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("committed_stock")
        .select(`
          *,
          product:products(name, sku),
          branch:branches!committed_stock_branch_id_fkey(name, code)
        `)
        .is("released_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const softCount = reserves?.filter((r) => r.reserve_type === "soft").length || 0;
  const hardCount = reserves?.filter((r) => r.reserve_type === "hard").length || 0;
  const expiredCount = reserves?.filter((r) => r.is_expired).length || 0;

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Stock Comprometido</h1>
        <p className="text-muted-foreground mt-1">Reservas activas de inventario por solicitudes y cumplimientos</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="glass-card">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="bg-info/10 p-3 rounded-xl"><Unlock className="h-5 w-5 text-info" /></div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Soft Reserves</p>
              <p className="text-2xl font-display font-bold">{softCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="bg-primary/10 p-3 rounded-xl"><Lock className="h-5 w-5 text-primary" /></div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Hard Reserves</p>
              <p className="text-2xl font-display font-bold">{hardCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="bg-destructive/10 p-3 rounded-xl"><AlertTriangle className="h-5 w-5 text-destructive" /></div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Expiradas</p>
              <p className="text-2xl font-display font-bold">{expiredCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* List */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-lg">Reservas activas</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Cargando...</div>
          ) : !reserves?.length ? (
            <div className="p-8 text-center text-muted-foreground">No hay reservas activas</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left p-3 font-medium text-muted-foreground">Producto</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Sucursal</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Cantidad</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Tipo</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Razón</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Expira</th>
                  </tr>
                </thead>
                <tbody>
                  {reserves.map((r: any) => (
                    <tr key={r.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="p-3">
                        <p className="font-medium">{r.product?.name}</p>
                        <p className="text-xs text-muted-foreground">{r.product?.sku}</p>
                      </td>
                      <td className="p-3">{branchName(r.branch)}</td>
                      <td className="p-3 font-mono font-semibold">{Number(r.quantity)}</td>
                      <td className="p-3">
                        <Badge variant={r.reserve_type === "hard" ? "default" : "secondary"} className="text-xs">
                          {r.reserve_type === "hard" ? "Hard" : "Soft"}
                        </Badge>
                      </td>
                      <td className="p-3 text-muted-foreground text-xs capitalize">{r.reserve_reason?.replace(/_/g, " ")}</td>
                      <td className="p-3 text-xs">
                        {r.expires_at ? (
                          <span className={r.is_expired ? "text-destructive font-semibold" : "text-muted-foreground"}>
                            {r.is_expired ? "Expirada" : new Date(r.expires_at).toLocaleString("es-PY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
