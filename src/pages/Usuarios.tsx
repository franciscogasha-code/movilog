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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { UserPlus, Users, Shield, Building2, Eye, Wrench, ChevronRight, Crown } from "lucide-react";
import { useBranches } from "@/hooks/use-branches";
import { useAuth } from "@/contexts/AuthContext";

/* ------------------------------------------------------------------ */
/*  Role definitions aligned to MoviLog operations                     */
/* ------------------------------------------------------------------ */

type RoleKey = "admin" | "supervisor" | "warehouse_operator" | "branch_operator";

type RoleDef = {
  key: RoleKey;
  label: string;
  shortLabel: string;
  description: string;
  capabilities: string[];
  allBranchesByDefault: boolean;
  /** Module keys this role gets access to */
  modules: string[];
};

const ROLES: RoleDef[] = [
  {
    key: "admin",
    label: "Administrador",
    shortLabel: "Admin",
    description: "Acceso total al sistema, configuración y gestión de usuarios.",
    capabilities: [
      "Configuración general del sistema",
      "Gestión de usuarios y roles",
      "Sincronización BIMS",
      "Acceso a todos los módulos",
      "Visibilidad de todas las sucursales",
    ],
    allBranchesByDefault: true,
    modules: [
      "dashboard", "alertas", "consultas", "solicitudes", "stock-comprometido",
      "cumplimiento", "recepcion", "incidencias", "documentos", "chofer",
      "etiquetas", "rendicion", "abastecimiento", "reposicion", "pedidos",
      "distribucion", "cobranzas", "flota", "ruteo", "usuarios", "sincronizacion-bims",
    ],
  },
  {
    key: "supervisor",
    label: "Jefe de Logística",
    shortLabel: "Jefe Log.",
    description: "Visión global, coordinación multi-origen, intervención transversal.",
    capabilities: [
      "Ver todas las sucursales",
      "Gestionar pedidos y consultas",
      "Coordinar operaciones multi-origen",
      "Intervenir transversalmente en la operación",
      "Ver incidencias y trazabilidad completa",
    ],
    allBranchesByDefault: true,
    modules: [
      "dashboard", "alertas", "consultas", "solicitudes", "stock-comprometido",
      "cumplimiento", "recepcion", "incidencias", "documentos", "chofer",
      "etiquetas", "rendicion", "abastecimiento", "reposicion", "pedidos",
      "distribucion", "cobranzas", "flota", "ruteo",
    ],
  },
  {
    key: "branch_operator",
    label: "Operador de Sucursal",
    shortLabel: "Op. Sucursal",
    description: "Trabajo operativo desde su sucursal, consultas y seguimiento.",
    capabilities: [
      "Consultar stock y disponibilidad",
      "Crear solicitudes y pedidos",
      "Hacer seguimiento de operaciones",
      "Registrar incidencias operativas",
      "Ver stock de todas las sucursales (solo lectura)",
    ],
    allBranchesByDefault: false,
    modules: [
      "dashboard", "alertas", "consultas", "solicitudes", "stock-comprometido",
      "cumplimiento", "recepcion", "incidencias", "documentos", "etiquetas",
      "abastecimiento", "reposicion", "pedidos",
    ],
  },
  {
    key: "warehouse_operator",
    label: "Depósito / Logística Operativa",
    shortLabel: "Depósito",
    description: "Preparación, despacho, recepción, traslado, cortes y consultas operativas.",
    capabilities: [
      "Preparar y despachar mercadería",
      "Recibir y trasladar entregas",
      "Registrar hitos operativos y cortes",
      "Responder consultas de stock, colores y disponibilidad",
      "Registrar incidencias operativas",
      "Ver stock de todas las sucursales (solo lectura)",
    ],
    allBranchesByDefault: false,
    modules: [
      "dashboard", "alertas", "consultas", "solicitudes", "stock-comprometido",
      "cumplimiento", "recepcion", "incidencias", "documentos", "chofer",
      "etiquetas", "rendicion", "abastecimiento", "reposicion",
    ],
  },
];

const getRoleDef = (key: string): RoleDef | undefined => ROLES.find((r) => r.key === key);

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Profile = {
  id: string;
  full_name: string;
  default_branch_id: string | null;
  is_active: boolean;
  all_branches_access: boolean;
  user_id: string;
};

type UserRole = {
  id: string;
  user_id: string;
  role: string;
};

type ProfileBranchAccess = {
  id: string;
  profile_id: string;
  branch_id: string;
};

/* ------------------------------------------------------------------ */
/*  Role capability badge                                              */
/* ------------------------------------------------------------------ */

function RoleCapabilities({ role }: { role: RoleDef }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Shield className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">{role.label}</span>
      </div>
      <p className="text-xs text-muted-foreground">{role.description}</p>
      <ul className="space-y-1">
        {role.capabilities.map((cap) => (
          <li key={cap} className="text-xs text-muted-foreground flex items-start gap-1.5">
            <ChevronRight className="h-3 w-3 mt-0.5 shrink-0 text-primary/60" />
            {cap}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function Usuarios() {
  const queryClient = useQueryClient();
  const { data: branches = [] } = useBranches();
  const { isOwner: currentUserIsOwner } = useAuth();
  /* --- Create dialog state --- */
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("Movilog2026!");
  const [newBranch, setNewBranch] = useState("");
  const [newRole, setNewRole] = useState<RoleKey | "">("");
  const [newAdditionalBranches, setNewAdditionalBranches] = useState<string[]>([]);

  /* --- Detail state --- */
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [editDefaultBranch, setEditDefaultBranch] = useState("");
  const [editAllBranches, setEditAllBranches] = useState(false);
  const [editBranchIds, setEditBranchIds] = useState<string[]>([]);
  const [editRole, setEditRole] = useState<RoleKey | "">("");

  /* --- Queries --- */
  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, default_branch_id, is_active, all_branches_access, user_id")
        .order("full_name");
      if (error) throw error;
      return data as Profile[];
    },
  });

  const { data: userRoles = [] } = useQuery({
    queryKey: ["user_roles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("id, user_id, role");
      if (error) throw error;
      return data as UserRole[];
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

  /* --- Helpers --- */
  const getUserRole = (userId: string): string | null => {
    const r = userRoles.find((ur) => ur.user_id === userId);
    return r?.role ?? null;
  };

  const isUserOwner = (userId: string): boolean => {
    return userRoles.some((ur) => ur.user_id === userId && ur.role === "owner");
  };

  const getBranchName = (branchId: string | null) => {
    if (!branchId) return "—";
    return branches.find((b) => b.id === branchId)?.name ?? "—";
  };

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.id === selectedUser),
    [profiles, selectedUser]
  );

  const selectedRoleDef = useMemo(() => {
    if (!editRole) return undefined;
    return getRoleDef(editRole);
  }, [editRole]);

  const newRoleDef = useMemo(() => {
    if (!newRole) return undefined;
    return getRoleDef(newRole);
  }, [newRole]);

  /* Sync detail form when selection changes */
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

    const currentRole = getUserRole(selectedProfile.user_id);
    setEditRole((currentRole as RoleKey) || "");
  }, [selectedProfile, profileBranchAccess, userRoles]);

  /* --- Mutations --- */
  const createUser = useMutation({
    mutationFn: async () => {
      if (!newName.trim()) throw new Error("El nombre es obligatorio");
      if (!newEmail.trim()) throw new Error("El correo electrónico es obligatorio");
      if (!newPassword || newPassword.length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres");
      if (!newRole) throw new Error("Debés seleccionar un rol");
      const roleDef = getRoleDef(newRole)!;
      const allBranches = roleDef.allBranchesByDefault;
      const defaultBranchId = newBranch || null;

      if (!allBranches && !defaultBranchId) {
        throw new Error("Debés seleccionar una sucursal principal");
      }

      const { data, error } = await supabase.functions.invoke("create-user", {
        body: {
          email: newEmail.trim(),
          password: newPassword,
          full_name: newName.trim(),
          role: newRole,
          default_branch_id: allBranches ? null : defaultBranchId,
          all_branches_access: allBranches,
          additional_branch_ids: newAdditionalBranches,
          modules: roleDef.modules,
        },
      });

      if (error) throw new Error(error.message || "Error al crear usuario");
      if (data?.error) throw new Error(data.error);

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      queryClient.invalidateQueries({ queryKey: ["user_roles"] });
      queryClient.invalidateQueries({ queryKey: ["user_module_access"] });
      queryClient.invalidateQueries({ queryKey: ["profile_branch_access"] });
      setCreateOpen(false);
      const usedPassword = newPassword;
      setNewName("");
      setNewEmail("");
      setNewPassword("Movilog2026!");
      setNewBranch("");
      setNewRole("");
      setNewAdditionalBranches([]);
      toast({
        title: "Usuario creado correctamente",
        description: `Contraseña temporal: ${usedPassword} — Comunicala al usuario.`,
      });
    },
    onError: (error: Error) =>
      toast({ title: error.message || "Error al crear usuario", variant: "destructive" }),
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

  const saveProfile = useMutation({
    mutationFn: async ({
      profileId,
      userId,
      defaultBranchId,
      allBranches,
      branchIds,
      role,
    }: {
      profileId: string;
      userId: string;
      defaultBranchId: string | null;
      allBranches: boolean;
      branchIds: string[];
      role: RoleKey;
    }) => {
      if (!role) throw new Error("Debés seleccionar un rol");
      const roleDef = getRoleDef(role)!;

      if (!allBranches && (!defaultBranchId || branchIds.length === 0)) {
        throw new Error("Debés asignar al menos una sucursal");
      }

      // Update profile
      await supabase
        .from("profiles")
        .update({ default_branch_id: defaultBranchId, all_branches_access: allBranches })
        .eq("id", profileId);

      // Update role: delete existing, insert new
      await supabase.from("user_roles").delete().eq("user_id", userId);
      await supabase.from("user_roles").insert({ user_id: userId, role });

      // Update branch access
      await supabase.from("profile_branch_access").delete().eq("profile_id", profileId);
      if (!allBranches) {
        const uniqueIds = Array.from(new Set(branchIds));
        if (uniqueIds.length > 0) {
          await supabase
            .from("profile_branch_access")
            .insert(uniqueIds.map((bid) => ({ profile_id: profileId, branch_id: bid })));
        }
      }

      // Update module access: reset to role defaults
      await supabase.from("user_module_access").delete().eq("profile_id", profileId);
      const accessRows = roleDef.modules.map((key) => ({
        profile_id: profileId,
        module_key: key,
        is_enabled: true,
      }));
      if (accessRows.length > 0) {
        await supabase.from("user_module_access").insert(accessRows);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      queryClient.invalidateQueries({ queryKey: ["user_roles"] });
      queryClient.invalidateQueries({ queryKey: ["user_module_access"] });
      queryClient.invalidateQueries({ queryKey: ["profile_branch_access"] });
      toast({ title: "Perfil actualizado correctamente" });
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Error al guardar", variant: "destructive" });
    },
  });

  /* --- Render helpers --- */
  const toggleNewAdditionalBranch = (branchId: string, checked: boolean) => {
    setNewAdditionalBranches((prev) =>
      checked ? Array.from(new Set([...prev, branchId])) : prev.filter((id) => id !== branchId)
    );
  };

  const toggleEditBranch = (branchId: string, checked: boolean) => {
    setEditBranchIds((prev) =>
      checked ? Array.from(new Set([...prev, branchId])) : prev.filter((id) => id !== branchId)
    );
    setEditDefaultBranch((cur) => (!checked && cur === branchId ? "" : cur));
  };

  const getRoleBadgeVariant = (role: string | null): "default" | "secondary" | "outline" => {
    if (role === "admin") return "default";
    if (role === "supervisor") return "secondary";
    return "outline";
  };

  const getRoleLabel = (role: string | null): string => {
    if (!role) return "Sin rol";
    return getRoleDef(role)?.shortLabel ?? role;
  };

  /* ------------------------------------------------------------------ */
  /*  JSX                                                                */
  /* ------------------------------------------------------------------ */

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Usuarios</h1>
          <p className="text-sm text-muted-foreground">
            Gestión de roles, alcance operativo y accesos
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <UserPlus className="h-4 w-4 mr-2" />
              Nuevo usuario
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Crear usuario</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              {/* Basic data */}
              <div className="space-y-2">
                <Label>Nombre completo</Label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Nombre y apellido"
                />
              </div>

              <div className="space-y-2">
                <Label>Correo electrónico</Label>
                <Input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="usuario@empresa.com"
                />
              </div>

              <div className="space-y-2">
                <Label>Contraseña temporal</Label>
                <Input
                  type="text"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                />
                <p className="text-[11px] text-muted-foreground">
                  El usuario podrá cambiarla después de iniciar sesión.
                </p>
              </div>

              {/* Role */}
              <div className="space-y-2">
                <Label>Rol</Label>
                <Select value={newRole} onValueChange={(v) => setNewRole(v as RoleKey)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar rol" />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r.key} value={r.key}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {newRoleDef && <RoleCapabilities role={newRoleDef} />}

              {/* Branch (only for non-global roles) */}
              {newRoleDef && !newRoleDef.allBranchesByDefault && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <Label>Sucursal principal</Label>
                    <Select value={newBranch} onValueChange={setNewBranch}>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccionar sucursal" />
                      </SelectTrigger>
                      <SelectContent>
                        {branches.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {branches.length > 1 && (
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">
                        Alcance operativo adicional
                      </Label>
                      <div className="max-h-40 overflow-auto space-y-2">
                        {branches
                          .filter((b) => b.id !== newBranch)
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
                </>
              )}

              {newRoleDef?.allBranchesByDefault && (
                <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
                  <Eye className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    Este rol tiene visibilidad global de todas las sucursales.
                  </span>
                </div>
              )}

              <Button
                className="w-full"
                disabled={
                  !newName.trim() ||
                  !newEmail.trim() ||
                  !newPassword || newPassword.length < 6 ||
                  !newRole ||
                  (!newRoleDef?.allBranchesByDefault && !newBranch) ||
                  createUser.isPending
                }
                onClick={() => createUser.mutate()}
              >
                {createUser.isPending ? "Creando..." : "Crear usuario"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Content */}
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
                {profiles.map((profile) => {
                  const role = getUserRole(profile.user_id);
                  return (
                    <button
                      key={profile.id}
                      onClick={() => setSelectedUser(profile.id)}
                      className={`w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors ${
                        selectedUser === profile.id ? "bg-muted" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{profile.full_name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <Badge variant={getRoleBadgeVariant(role)} className="text-[10px] px-1.5 py-0">
                              {getRoleLabel(role)}
                            </Badge>
                            <span className="text-[11px] text-muted-foreground truncate">
                              {profile.all_branches_access
                                ? "Todas"
                                : getBranchName(profile.default_branch_id)}
                            </span>
                          </div>
                        </div>
                        {!profile.is_active && (
                          <Badge variant="secondary" className="shrink-0 text-[10px]">
                            Inactivo
                          </Badge>
                        )}
                      </div>
                    </button>
                  );
                })}
                {profiles.length === 0 && (
                  <p className="p-4 text-sm text-muted-foreground text-center">
                    No hay usuarios. Creá uno nuevo.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Detail panel */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Wrench className="h-4 w-4" />
                {selectedProfile
                  ? `Configuración — ${selectedProfile.full_name}`
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
              <div className="space-y-5">
                {/* Role selection */}
                <div className="space-y-2">
                  <Label>Rol</Label>
                  <Select
                    value={editRole}
                    onValueChange={(v) => {
                      const role = v as RoleKey;
                      setEditRole(role);
                      const def = getRoleDef(role);
                      if (def?.allBranchesByDefault) {
                        setEditAllBranches(true);
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar rol" />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r.key} value={r.key}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedRoleDef && <RoleCapabilities role={selectedRoleDef} />}

                <Separator />

                {/* Branch scope */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <Label className="text-sm font-medium">Alcance operativo</Label>
                  </div>

                  {selectedRoleDef?.allBranchesByDefault ? (
                    <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
                      <Eye className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        Este rol tiene visibilidad y acceso global a todas las sucursales.
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Sucursal principal</Label>
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
                              <SelectItem key={b.id} value={b.id}>
                                {b.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {branches.length > 0 && (
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">
                            Sucursales adicionales habilitadas
                          </Label>
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
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Save */}
                <div className="flex justify-end pt-2">
                  <Button
                    onClick={() =>
                      saveProfile.mutate({
                        profileId: selectedProfile.id,
                        userId: selectedProfile.user_id,
                        defaultBranchId: selectedRoleDef?.allBranchesByDefault
                          ? null
                          : editDefaultBranch || null,
                        allBranches: selectedRoleDef?.allBranchesByDefault ?? editAllBranches,
                        branchIds: selectedRoleDef?.allBranchesByDefault
                          ? []
                          : Array.from(
                              new Set(
                                [editDefaultBranch, ...editBranchIds].filter(Boolean) as string[]
                              )
                            ),
                        role: editRole as RoleKey,
                      })
                    }
                    disabled={
                      saveProfile.isPending ||
                      !editRole ||
                      (!selectedRoleDef?.allBranchesByDefault &&
                        (!editDefaultBranch || editBranchIds.length === 0))
                    }
                  >
                    {saveProfile.isPending ? "Guardando..." : "Guardar cambios"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
                Seleccioná un usuario de la lista para gestionar su rol y alcance
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
