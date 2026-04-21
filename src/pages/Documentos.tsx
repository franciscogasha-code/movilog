import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { DOCUMENT_STATUS_CONFIG } from "@/lib/constants";
import { FileText, Archive } from "lucide-react";
import { branchName } from "@/lib/branch-format";

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
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Trazabilidad Documental</h1>
        <p className="text-muted-foreground mt-1">Seguimiento de facturas, remitos y documentos en ciclo logístico</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="glass-card">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="bg-primary/10 p-3 rounded-xl"><FileText className="h-5 w-5 text-primary" /></div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Activos</p>
              <p className="text-2xl font-display font-bold">{activeCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="bg-muted p-3 rounded-xl"><Archive className="h-5 w-5 text-muted-foreground" /></div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Total</p>
              <p className="text-2xl font-display font-bold">{docs?.length || 0}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-card">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Cargando...</div>
          ) : !docs?.length ? (
            <div className="p-8 text-center text-muted-foreground">No hay documentos registrados</div>
          ) : (
            <div className="overflow-x-auto">
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
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
