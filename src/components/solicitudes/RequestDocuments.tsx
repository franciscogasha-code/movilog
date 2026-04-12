import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { FileText, Plus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface RequestDocumentsProps {
  requestId: string;
  requestType: string;
  deliveryTarget: string;
  currentStatus: string;
  isOrigin: boolean;
  isAdmin: boolean;
}

export function RequestDocuments({
  requestId,
  requestType,
  deliveryTarget,
  currentStatus,
  isOrigin,
  isAdmin,
}: RequestDocumentsProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [docNumber, setDocNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const expectedType = requestType === "client" && deliveryTarget === "client" ? "invoice" : "transfer";
  const typeLabel = expectedType === "invoice" ? "Factura" : "Transferencia";

  const canEdit = (isOrigin || isAdmin) && ["pending", "in_preparation"].includes(currentStatus);

  const { data: documents } = useQuery({
    queryKey: ["request-bims-documents", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("request_bims_documents")
        .select("*")
        .eq("request_id", requestId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const handleAdd = async () => {
    if (!docNumber.trim() || !user) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from("request_bims_documents").insert({
        request_id: requestId,
        document_type: expectedType,
        document_number: docNumber.trim(),
        created_by: user.id,
      });
      if (error) throw error;
      toast.success(`${typeLabel} ${docNumber.trim()} vinculada`);
      setDocNumber("");
      setAdding(false);
      queryClient.invalidateQueries({ queryKey: ["request-bims-documents", requestId] });
    } catch (err: any) {
      toast.error(err.message || "Error al vincular documento");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (docId: string) => {
    try {
      const { error } = await supabase.from("request_bims_documents").delete().eq("id", docId);
      if (error) throw error;
      toast.success("Documento desvinculado");
      queryClient.invalidateQueries({ queryKey: ["request-bims-documents", requestId] });
    } catch (err: any) {
      toast.error(err.message || "Error al desvincular");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-display font-semibold">Documentos BIMS</h4>
        {canEdit && !adding && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Agregar {typeLabel}
          </Button>
        )}
      </div>

      {adding && (
        <Card className="mb-3 border-primary/30">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground mb-2">
              Tipo: <Badge variant="outline" className="ml-1">{typeLabel}</Badge>
            </p>
            <div className="flex gap-2">
              <Input
                placeholder={`Nro. de ${typeLabel.toLowerCase()}`}
                value={docNumber}
                onChange={(e) => setDocNumber(e.target.value)}
                className="flex-1"
              />
              <Button size="sm" disabled={!docNumber.trim() || submitting} onClick={handleAdd}>
                {submitting && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                Vincular
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setDocNumber(""); }}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!documents?.length ? (
        <p className="text-sm text-muted-foreground">Sin documentos vinculados</p>
      ) : (
        <div className="space-y-2">
          {documents.map((doc: any) => (
            <div key={doc.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/30 text-sm">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1">
                <span className="font-medium">{doc.document_number}</span>
                <Badge variant="outline" className="ml-2 text-xs">
                  {doc.document_type === "invoice" ? "Factura" : "Transferencia"}
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground">
                {new Date(doc.created_at).toLocaleString("es-PY")}
              </span>
              {canEdit && (
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleRemove(doc.id)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {currentStatus === "in_preparation" && !documents?.length && (
        <p className="text-xs text-warning mt-2 font-medium">
          ⚠️ Se requiere al menos un documento BIMS para avanzar a tránsito
        </p>
      )}
    </div>
  );
}
