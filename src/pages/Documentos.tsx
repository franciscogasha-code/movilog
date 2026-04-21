import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { DOCUMENT_STATUS_CONFIG } from "@/lib/constants";
import { FileText, Archive } from "lucide-react";
import { branchName } from "@/lib/branch-format";
import { SkeletonList } from "@/components/ui/skeletons";

const DOC_TYPE_LABELS: Record<string, string> = {
  invoice: "Factura",
  remission: "Remito",
  signed_invoice: "Factura firmada",
  delivery_note: "Nota de entrega",
};

export default function Documentos() {
  const { data: docs, isLoading } = useQuery({
    queryKey: ["tracked-documents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tracked_documents")
        .select(`
          *,
          location_branch:branches!tracked_documents_current_location_branch_id_fkey(name, code)
        `)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const activeCount = docs?.filter((d) => !["archived"].includes(d.status)).length || 0;

  return (
    <motion.div className="space-y-4 sm:space-y-5" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div>
        <h1 className="font-display text-xl sm:text-2xl font-bold text-foreground">Trazabilidad Documental</h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">Seguimiento de facturas, remitos y documentos</p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <div className="op-card p-3 flex items-center gap-3">
          <div className="bg-primary/10 p-2 rounded-lg"><FileText className="h-4 w-4 text-primary" /></div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Activos</p>
            <p className="text-xl font-display font-bold">{activeCount}</p>
          </div>
        </div>
        <div className="op-card p-3 flex items-center gap-3">
          <div className="bg-muted p-2 rounded-lg"><Archive className="h-4 w-4 text-muted-foreground" /></div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</p>
            <p className="text-xl font-display font-bold">{docs?.length || 0}</p>
          </div>
        </div>
      </div>

      <Card className="glass-card overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <SkeletonList rows={6} />
          ) : !docs?.length ? (
            <div className="empty-state p-10 text-center">
              <FileText className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm font-semibold text-foreground">Aún no hay documentos en seguimiento</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                Los documentos (facturas, remitos, notas de entrega) aparecerán acá automáticamente cuando se generen desde los pedidos.
              </p>
            </div>
          ) : (
            <>
              {/* MOBILE: cards */}
              <div className="md:hidden divide-y divide-border/50">
                {docs.map((d: any) => (
                  <div key={d.id} className="p-3">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="font-mono font-semibold text-sm">{d.document_number}</span>
                      <StatusBadge status={d.status} config={DOCUMENT_STATUS_CONFIG} />
                    </div>
                    <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-2">
                      <span>{DOC_TYPE_LABELS[d.document_type] || d.document_type}</span>
                      <span>·</span>
                      <span>{branchName(d.location_branch)}</span>
                      {d.issued_at && (
                        <>
                          <span>·</span>
                          <span>{new Date(d.issued_at).toLocaleDateString("es-PY", { day: "2-digit", month: "short" })}</span>
                        </>
                      )}
                    </div>
                    {d.expected_next_event && (
                      <p className="text-[10px] text-muted-foreground mt-1">Próx: {d.expected_next_event}</p>
                    )}
                  </div>
                ))}
              </div>

              {/* DESKTOP: tabla */}
              <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left p-3 font-medium text-muted-foreground">Número</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Tipo</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Ubicación</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Estado</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Próx. evento</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Emitido</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d: any) => (
                    <tr key={d.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="p-3 font-mono font-semibold">{d.document_number}</td>
                      <td className="p-3">
                        <span className="text-xs">{DOC_TYPE_LABELS[d.document_type] || d.document_type}</span>
                      </td>
                      <td className="p-3">{branchName(d.location_branch)}</td>
                      <td className="p-3">
                        <StatusBadge status={d.status} config={DOCUMENT_STATUS_CONFIG} />
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">{d.expected_next_event || "—"}</td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {d.issued_at ? new Date(d.issued_at).toLocaleDateString("es-PY", { day: "2-digit", month: "short" }) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
