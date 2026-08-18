import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Bookmark, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Draft = {
  id: string;
  name: string;
  product_ids: string[] | null;
  updated_at: string;
};

/**
 * Selecciones de catálogo guardadas en el servidor.
 * Permite recuperar una selección en cualquier momento (no solo cuando está vacía)
 * y guardar la selección actual con un nombre.
 */
export function SeleccionesGuardadas({
  userId,
  currentIds,
  onReplace,
  onMerge,
}: {
  userId: string;
  currentIds: string[];
  onReplace: (ids: string[]) => void;
  onMerge: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: drafts = [], isLoading } = useQuery({
    queryKey: ["sales_catalog_drafts", userId],
    enabled: open && !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_catalog_drafts")
        .select("id, name, product_ids, updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Draft[];
    },
  });

  const saveCurrent = async () => {
    const finalName = name.trim();
    if (!finalName || currentIds.length === 0) return;
    setSaving(true);
    const { error } = await supabase.from("sales_catalog_drafts").insert({
      user_id: userId,
      name: finalName,
      product_ids: currentIds,
      customer: {} as never,
    });
    setSaving(false);
    if (error) {
      toast({ title: "No se pudo guardar", description: error.message, variant: "destructive" });
      return;
    }
    setName("");
    void qc.invalidateQueries({ queryKey: ["sales_catalog_drafts", userId] });
    toast({ title: "Selección guardada", description: finalName });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Bookmark className="h-4 w-4 mr-1.5" />
          Selecciones guardadas
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Selecciones guardadas</DialogTitle>
          <DialogDescription>
            Recuperá una selección anterior o guardá la actual para no perderla.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Input
            placeholder="Nombre de la selección actual"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            type="button"
            onClick={saveCurrent}
            disabled={saving || !name.trim() || currentIds.length === 0}
          >
            <Save className="h-4 w-4 mr-1.5" />
            Guardar {currentIds.length > 0 ? `(${currentIds.length.toLocaleString("de-DE")})` : ""}
          </Button>
        </div>

        <div className="space-y-2 max-h-80 overflow-y-auto">
          {isLoading && <p className="text-sm text-muted-foreground">Cargando...</p>}
          {!isLoading && drafts.length === 0 && (
            <p className="text-sm text-muted-foreground">Todavía no hay selecciones guardadas.</p>
          )}
          {drafts.map((d) => {
            const ids = (d.product_ids ?? []) as string[];
            return (
              <div
                key={d.id}
                className="flex items-center justify-between gap-2 rounded-md border p-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{d.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {ids.length.toLocaleString("de-DE")} productos ·{" "}
                    {new Date(d.updated_at).toLocaleString("de-DE")}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      onMerge(ids);
                      setOpen(false);
                      toast({ title: "Selección agregada", description: d.name });
                    }}
                  >
                    Agregar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      onReplace(ids);
                      setOpen(false);
                      toast({ title: "Selección recuperada", description: d.name });
                    }}
                  >
                    Usar
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
