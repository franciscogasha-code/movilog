import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
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
  all_branches_access: boolean;
};

type ModuleAccess = {
  id: string;
  profile_id: string;
  module_key: string;
  is_enabled: boolean;
};

type ProfileBranchAccess = {
  id: string;
  profile_id: string;
  branch_id: string;
};

export default function Usuarios() {
  const queryClient = useQueryClient();
  const { data: branches = [] } = useBranches();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [newAllBranches, setNewAllBranches] = useState(false);
  const [newAdditionalBranches, setNewAdditionalBranches] = useState<string[]>([]);

  const [editDefaultBranch, setEditDefaultBranch] = useState("");
  const [editAllBranches, setEditAllBranches] = useState(false);
  const [editBranchIds, setEditBranchIds] = useState<string[]>([]);

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, default_branch_id, is_active, all_branches_access")
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

  const { data: profileBranchAccess = [] } = useQuery({
    queryKey: ["profile_branch_access"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profile_branch_access")
        .select("id, profile_id, branch_id");
      if (error) throw error;
      return data as ProfileBranchAccess[];
    },
  });

  const createUser = useMutation({
    mutationFn: async () => {
      const defaultBranchId = newBranch || null;
      if (!newAllBranches && !defaultBranchId) {
        throw new Error("Debés seleccionar una sucursal principal");
      }

      // Create profile with a placeholder user_id since it's required
      const placeholderId = crypto.randomUUID();
      const { data, error } = await supabase
        .from("profiles")
        .insert({
          full_name: newName,
          default_branch_id: defaultBranchId,
          all_branches_access: newAllBranches,
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

      if (!newAllBranches) {
        const branchIds = Array.from(
          new Set([defaultBranchId, ...newAdditionalBranches].filter(Boolean) as string[])
        );

        if (branchIds.length > 0) {
          const rows = branchIds.map((branchId) => ({
            profile_id: data.id,
            branch_id: branchId,
          }));
          const { error: branchAccessError } = await supabase
            .from("profile_branch_access")
            .insert(rows);
          if (branchAccessError) throw branchAccessError;
        }
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      queryClient.invalidateQueries({ queryKey: ["user_module_access"] });
      queryClient.invalidateQueries({ queryKey: ["profile_branch_access"] });
      setCreateOpen(false);
      setNewName("");
      setNewBranch("");
      setNewAllBranches(false);
      setNewAdditionalBranches([]);
      toast({ title: "Usuario creado correctamente" });
    },
    onError: (error: Error) => toast({ title: error.message || "Error al crear usuario", variant: "destructive" }),
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

  const saveBranchAccess = useMutation({
    mutationFn: async ({
      profileId,
      defaultBranchId,
      allBranches,
      branchIds,
    }: {
      profileId: string;
      defaultBranchId: string | null;
      allBranches: boolean;
      branchIds: string[];
    }) => {
      if (!allBranches && (!defaultBranchId || branchIds.length === 0)) {
        throw new Error("Debés asignar al menos una sucursal");
      }

      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          default_branch_id: defaultBranchId,
          all_branches_access: allBranches,
        })
        .eq("id", profileId);
      if (profileError) throw profileError;

      const { error: deleteError } = await supabase
        .from("profile_branch_access")
        .delete()
        .eq("profile_id", profileId);
      if (deleteError) throw deleteError;

      if (!allBranches) {
        const uniqueBranchIds = Array.from(new Set(branchIds));
        if (uniqueBranchIds.length > 0) {
          const rows = uniqueBranchIds.map((branchId) => ({
            profile_id: profileId,
            branch_id: branchId,
          }));

          const { error: insertError } = await supabase
            .from("profile_branch_access")
            .insert(rows);
          if (insertError) throw insertError;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      queryClient.invalidateQueries({ queryKey: ["profile_branch_access"] });
      toast({ title: "Sucursales actualizadas" });
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Error al guardar sucursales", variant: "destructive" });
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

  const getBranchSummary = (profile: Profile) => {
    if (profile.all_branches_access) return "Todas las sucursales";
    return getBranchName(profile.default_branch_id);
  };

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.id === selectedUser),
    [profiles, selectedUser]
  );

  useEffect(() => {
    if (!selectedProfile) return;

    const assignedBranches = profileBranchAccess
      .filter((row) => row.profile_id === selectedProfile.id)
      .map((row) => row.branch_id);

    const merged = Array.from(
      new Set([
        ...(selectedProfile.default_branch_id ? [selectedProfile.default_branch_id] : []),
        ...assignedBranches,
      ])
    );

    setEditAllBranches(Boolean(selectedProfile.all_branches_access));
    setEditDefaultBranch(selectedProfile.default_branch_id ?? "");
    setEditBranchIds(merged);
  }, [selectedProfile, profileBranchAccess]);

  const toggleNewAdditionalBranch = (branchId: string, checked: boolean) => {
    setNewAdditionalBranches((prev) => {
      if (checked) return Array.from(new Set([...prev, branchId]));
      return prev.filter((id) => id !== branchId);
    });
  };

  const toggleEditBranch = (branchId: string, checked: boolean) => {
    setEditBranchIds((prev) => {
      if (checked) return Array.from(new Set([...prev, branchId]));
      return prev.filter((id) => id !== branchId);
    });

    setEditDefaultBranch((currentDefault) =>
      !checked && currentDefault === branchId ? "" : currentDefault
    );
  };

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
                {branches.length === 0 && (
                  <p className="text-xs text-destructive">
                    No hay sucursales disponibles todavía. Sincronizá sucursales desde BIMS.
                  </p>
                )}
              </div>

              <div className="rounded-md border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Acceso a todas las sucursales</Label>
                  <Switch checked={newAllBranches} onCheckedChange={setNewAllBranches} />
                </div>

                {!newAllBranches && branches.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Sucursales adicionales habilitadas</Label>
                    <div className="max-h-40 overflow-auto space-y-2">
                      {branches
                        .filter((branch) => branch.id !== newBranch)
                        .map((branch) => (
                          <label key={branch.id} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={newAdditionalBranches.includes(branch.id)}
                              onCheckedChange={(checked) =>
                                toggleNewAdditionalBranch(branch.id, checked === true)
                              }
                            />
                            {branch.name}
                          </label>
                        ))}
                    </div>
                  </div>
                )}
              </div>

              <Button
                className="w-full"
                disabled={!newName.trim() || (!newAllBranches && !newBranch) || createUser.isPending}
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
                          {getBranchSummary(profile)}
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
              <div className="space-y-4">
                <div className="rounded-lg border border-border p-4 space-y-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                    <div className="space-y-2 w-full md:max-w-xs">
                      <Label>Sucursal principal</Label>
                      <Select
                        value={editDefaultBranch}
                        onValueChange={(value) => {
                          setEditDefaultBranch(value);
                          setEditBranchIds((prev) =>
                            prev.includes(value) ? prev : [...prev, value]
                          );
                        }}
                      >
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

                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground">Acceso a todas</Label>
                      <Switch
                        checked={editAllBranches}
                        onCheckedChange={(checked) => {
                          setEditAllBranches(checked);
                          if (!checked && branches[0] && !editDefaultBranch) {
                            setEditDefaultBranch(branches[0].id);
                            setEditBranchIds((prev) =>
                              prev.length > 0 ? prev : [branches[0].id]
                            );
                          }
                        }}
                      />
                    </div>
                  </div>

                  {!editAllBranches && (
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Sucursales habilitadas</Label>
                      {branches.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No hay sucursales sincronizadas todavía.</p>
                      ) : (
                        <div className="max-h-40 overflow-auto space-y-2">
                          {branches.map((branch) => (
                            <label key={branch.id} className="flex items-center gap-2 text-sm">
                              <Checkbox
                                checked={editBranchIds.includes(branch.id)}
                                onCheckedChange={(checked) =>
                                  toggleEditBranch(branch.id, checked === true)
                                }
                              />
                              {branch.name}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={() =>
                        saveBranchAccess.mutate({
                          profileId: selectedProfile.id,
                          defaultBranchId: editDefaultBranch || null,
                          allBranches: editAllBranches,
                          branchIds: editAllBranches ? [] : Array.from(new Set([editDefaultBranch, ...editBranchIds].filter(Boolean) as string[])),
                        })
                      }
                      disabled={
                        saveBranchAccess.isPending ||
                        (!editAllBranches && (!editDefaultBranch || editBranchIds.length === 0))
                      }
                    >
                      {saveBranchAccess.isPending ? "Guardando..." : "Guardar sucursales"}
                    </Button>
                  </div>
                </div>

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
              </div>
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
