import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { UserPlus, Users, Settings2 } from "lucide-react";
import { useBranches } from "@/hooks/use-branches";

const MODULES = [
  { key: "dashboard", label: "Dashboard" },
  { key: "alertas", label: "Alertas" },
  { key: "consultas", label: "Consultas" },
  { key: "solicitudes", label: "Pedidos" },
  { key: "stock-comprometido", label: "Stock Comprometido" },
  { key: "cumplimiento", label: "Ejecución Física" },
  { key: "recepcion", label: "Recepción" },
  { key: "incidencias", label: "Incidencias" },
  { key: "documentos", label: "Documentos" },
  { key: "chofer", label: "Panel Chofer" },
  { key: "etiquetas", label: "Etiquetas" },
  { key: "rendicion", label: "Rendición" },
  { key: "abastecimiento", label: "Abastecimiento" },
  { key: "reposicion", label: "Reposición" },
  { key: "pedidos", label: "Pedidos Online" },
  { key: "distribucion", label: "Distribución" },
  { key: "cobranzas", label: "Cobranzas" },
  { key: "flota", label: "Flota" },
  { key: "ruteo", label: "Ruteo" },
];

type Profile = {
  id: string;
  full_name: string;
  default_branch_id: string | null;
  is_active: boolean;
};

type ModuleAccess = {
  id: string;
  profile_id: string;
  module_key: string;
  is_enabled: boolean;
};

export default function Usuarios() {
  const queryClient = useQueryClient();
  const { data: branches = [] } = useBranches();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newBranch, setNewBranch] = useState("");

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, default_branch_id, is_active")
        .order("full_name");
      if (error) throw error;
      return data as Profile[];
    },
  });

  const { data: moduleAccess = [] } = useQuery({
    queryKey: ["user_module_access"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_module_access")
        .select("*");
      if (error) throw error;
      return data as ModuleAccess[];
    },
  });

  const createUser = useMutation({
    mutationFn: async () => {
      // Create profile with a placeholder user_id since it's required
      const placeholderId = crypto.randomUUID();
      const { data, error } = await supabase
        .from("profiles")
        .insert({
          full_name: newName,
          default_branch_id: newBranch || null,
          user_id: placeholderId,
        })
        .select()
        .single();
      if (error) throw error;

      // Create default module access (all enabled)
      const accessRows = MODULES.map((m) => ({
        profile_id: data.id,
        module_key: m.key,
        is_enabled: true,
      }));
      const { error: accessError } = await supabase
        .from("user_module_access")
        .insert(accessRows);
      if (accessError) throw accessError;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      queryClient.invalidateQueries({ queryKey: ["user_module_access"] });
      setCreateOpen(false);
      setNewName("");
      setNewBranch("");
      toast({ title: "Usuario creado correctamente" });
    },
    onError: () => toast({ title: "Error al crear usuario", variant: "destructive" }),
  });

  const toggleModule = useMutation({
    mutationFn: async ({ profileId, moduleKey, enabled }: { profileId: string; moduleKey: string; enabled: boolean }) => {
      // Check if record exists
      const existing = moduleAccess.find(
        (ma) => ma.profile_id === profileId && ma.module_key === moduleKey
      );
      if (existing) {
        const { error } = await supabase
          .from("user_module_access")
          .update({ is_enabled: enabled })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("user_module_access")
          .insert({ profile_id: profileId, module_key: moduleKey, is_enabled: enabled });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user_module_access"] });
    },
    onError: () => toast({ title: "Error al actualizar permiso", variant: "destructive" }),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ profileId, active }: { profileId: string; active: boolean }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ is_active: active })
        .eq("id", profileId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      toast({ title: "Estado actualizado" });
    },
  });

  const isModuleEnabled = (profileId: string, moduleKey: string) => {
    const access = moduleAccess.find(
      (ma) => ma.profile_id === profileId && ma.module_key === moduleKey
    );
    return access ? access.is_enabled : true; // default enabled if no record
  };

  const getBranchName = (branchId: string | null) => {
    if (!branchId) return "—";
    const branch = branches.find((b) => b.id === branchId);
    return branch ? branch.name : "—";
  };

  const selectedProfile = profiles.find((p) => p.id === selectedUser);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Usuarios</h1>
          <p className="text-sm text-muted-foreground">Gestión de perfiles y accesos por módulo</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <UserPlus className="h-4 w-4 mr-2" />
              Nuevo usuario
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Crear usuario</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Nombre completo</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nombre y apellido" />
              </div>
              <div className="space-y-2">
                <Label>Sucursal</Label>
                <Select value={newBranch} onValueChange={setNewBranch}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar sucursal" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                className="w-full"
                disabled={!newName.trim() || createUser.isPending}
                onClick={() => createUser.mutate()}
              >
                {createUser.isPending ? "Creando..." : "Crear usuario"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Users list */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4" />
              Usuarios ({profiles.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <p className="p-4 text-sm text-muted-foreground">Cargando...</p>
            ) : (
              <div className="divide-y divide-border max-h-[600px] overflow-auto">
                {profiles.map((profile) => (
                  <button
                    key={profile.id}
                    onClick={() => setSelectedUser(profile.id)}
                    className={`w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors ${
                      selectedUser === profile.id ? "bg-muted" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{profile.full_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {getBranchName(profile.default_branch_id)}
                        </p>
                      </div>
                      <Badge variant={profile.is_active ? "default" : "secondary"}>
                        {profile.is_active ? "Activo" : "Inactivo"}
                      </Badge>
                    </div>
                  </button>
                ))}
                {profiles.length === 0 && (
                  <p className="p-4 text-sm text-muted-foreground text-center">
                    No hay usuarios. Creá uno nuevo.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Module access toggles */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Settings2 className="h-4 w-4" />
                {selectedProfile
                  ? `Módulos habilitados — ${selectedProfile.full_name}`
                  : "Seleccioná un usuario"}
              </CardTitle>
              {selectedProfile && (
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Activo</Label>
                  <Switch
                    checked={selectedProfile.is_active ?? true}
                    onCheckedChange={(checked) =>
                      toggleActive.mutate({ profileId: selectedProfile.id, active: checked })
                    }
                  />
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {selectedProfile ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Módulo</TableHead>
                    <TableHead className="w-[100px] text-center">Habilitado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {MODULES.map((mod) => (
                    <TableRow key={mod.key}>
                      <TableCell className="text-sm">{mod.label}</TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={isModuleEnabled(selectedProfile.id, mod.key)}
                          onCheckedChange={(checked) =>
                            toggleModule.mutate({
                              profileId: selectedProfile.id,
                              moduleKey: mod.key,
                              enabled: checked,
                            })
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
                Seleccioná un usuario de la lista para gestionar sus accesos
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
