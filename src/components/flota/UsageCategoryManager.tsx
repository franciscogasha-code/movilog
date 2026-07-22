import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";

export function UsageCategoryManager() {
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");

  const { data: cats } = useQuery({
    queryKey: ["vehicle-usage-categories-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicle_usage_categories")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async (name: string) => {
      const n = name.trim();
      if (!n) throw new Error("Nombre requerido");
      const { error } = await supabase.from("vehicle_usage_categories").insert({ name: n });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewName("");
      qc.invalidateQueries({ queryKey: ["vehicle-usage-categories-all"] });
      qc.invalidateQueries({ queryKey: ["vehicle-usage-categories"] });
      toast.success("Categoría creada");
    },
    onError: (e: any) => toast.error(e.message || "Error"),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("vehicle_usage_categories").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vehicle-usage-categories-all"] }),
    onError: (e: any) => toast.error(e.message || "Error"),
  });

  const update = useMutation({
    mutationFn: async ({ id, name, description }: { id: string; name: string; description: string }) => {
      const n = name.trim();
      if (!n) throw new Error("Nombre requerido");
      const { error } = await supabase
        .from("vehicle_usage_categories")
        .update({ name: n, description: description.trim() || null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ["vehicle-usage-categories-all"] });
      qc.invalidateQueries({ queryKey: ["vehicle-usage-categories"] });
      toast.success("Categoría actualizada");
    },
    onError: (e: any) => toast.error(e.message || "Error"),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("vehicle_usage_categories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vehicle-usage-categories-all"] });
      toast.success("Categoría eliminada");
    },
    onError: () => toast.error("No se puede eliminar si tiene usos vinculados"),
  });

  const startEdit = (c: any) => {
    setEditingId(c.id);
    setEditName(c.name);
    setEditDescription(c.description || "");
  };

  return (
    <Card className="glass-card">
      <CardContent className="p-4 space-y-4">
        <div>
          <p className="text-sm font-semibold mb-2">Categorías de uso</p>
          <div className="flex gap-2">
            <Input placeholder="Nueva categoría..." value={newName} onChange={(e) => setNewName(e.target.value)} />
            <Button onClick={() => create.mutate(newName)} disabled={create.isPending} className="gap-1">
              <Plus className="h-4 w-4" /> Agregar
            </Button>
          </div>
        </div>

        <div className="divide-y divide-border/50">
          {cats?.map((c: any) => {
            const isEditing = editingId === c.id;
            return (
              <div key={c.id} className="flex items-center justify-between py-2 gap-3">
                {isEditing ? (
                  <div className="flex-1 space-y-2">
                    <Input
                      placeholder="Nombre"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                    <Input
                      placeholder="Descripción (opcional)"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                    />
                  </div>
                ) : (
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{c.name}</p>
                    {c.description && <p className="text-xs text-muted-foreground">{c.description}</p>}
                  </div>
                )}
                <div className="flex items-center gap-3 shrink-0">
                  {isEditing ? (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => update.mutate({ id: c.id, name: editName, description: editDescription })}
                        disabled={update.isPending}
                      >
                        <Check className="h-4 w-4 text-primary" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setEditingId(null)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={c.is_active}
                          onCheckedChange={(v) => toggle.mutate({ id: c.id, is_active: v })}
                        />
                        <span className="text-xs text-muted-foreground">{c.is_active ? "Activa" : "Inactiva"}</span>
                      </div>
                      <Button size="icon" variant="ghost" onClick={() => startEdit(c)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => del.mutate(c.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {!cats?.length && <p className="text-sm text-muted-foreground py-4 text-center">Sin categorías</p>}
        </div>
      </CardContent>
    </Card>
  );
}
