import { useEffect, useMemo, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  UserPlus, Users, Shield, Building2, Eye, Wrench, ChevronRight, Crown,
  Search, Filter, Package, AlertTriangle, KeyRound, Save,
} from "lucide-react";
import { useBranches } from "@/hooks/use-branches";
import { useAuth } from "@/contexts/AuthContext";

/* ------------------------------------------------------------------ */
/*  Role definitions                                                   */
/* ------------------------------------------------------------------ */

type RoleKey = "admin" | "supervisor" | "branch_operator" | "warehouse_operator" | "viewer";

type RoleDef = {
  key: RoleKey;
  label: string;
  shortLabel: string;
  description: string;
  capabilities: string[];
  allBranchesByDefault: boolean;
  modules: string[];
};

const ROLES: RoleDef[] = [
  {
    key: "admin",
    label: "Administrador",
    shortLabel: "Admin",
    description: "Acceso global al sistema, configuración y gestión de usuarios.",
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
    label: "Supervisor",
    shortLabel: "Supervisor",
    description: "Visión global, coordinación multi-origen y supervisión operativa completa.",
    capabilities: [
      "Ver todas las sucursales",
      "Gestionar pedidos y consultas",
      "Coordinar logística y transporte",
      "Supervisar recepción e incidencias",
      "Acceso a KPIs y trazabilidad completa",
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
    description: "Operación de sucursal: consultas, pedidos, stock y seguimiento.",
    capabilities: [
      "Consultar stock y disponibilidad",
      "Crear solicitudes y pedidos",
      "Gestionar recepción en su sucursal",
      "Registrar incidencias operativas",
      "Ver stock comprometido",
    ],
    allBranchesByDefault: false,
    modules: [
      "dashboard", "alertas", "consultas", "solicitudes", "stock-comprometido",
      "recepcion", "incidencias", "documentos", "etiquetas",
      "abastecimiento", "reposicion", "pedidos",
    ],
  },
  {
    key: "warehouse_operator",
    label: "Operador Logístico",
    shortLabel: "Op. Logístico",
    description: "Preparación, despacho, transporte, recepción, entrega y rendición.",
    capabilities: [
      "Preparar y despachar mercadería",
      "Retirar y transportar cargas",
      "Entregar a sucursales y clientes",
      "Recepcionar y registrar incidencias",
      "Rendición de cobranzas y viáticos",
    ],
    allBranchesByDefault: false,
    modules: [
      "dashboard", "alertas", "consultas", "solicitudes", "stock-comprometido",
      "cumplimiento", "recepcion", "incidencias", "documentos", "chofer",
      "etiquetas", "rendicion", "abastecimiento", "reposicion",
    ],
  },
  {
    key: "viewer",
    label: "Auditor",
    shortLabel: "Auditor",
    description: "Acceso de solo lectura: dashboards, consultas, KPIs y seguimiento.",
    capabilities: [
      "Ver dashboard y métricas",
      "Consultar estado de pedidos y consultas",
      "Acceso a KPIs y cumplimiento",
      "Seguimiento de operaciones (solo lectura)",
      "No puede ejecutar acciones operativas",
    ],
    allBranchesByDefault: false,
    modules: [
      "dashboard", "alertas", "consultas", "solicitudes", "cumplimiento",
      "documentos",
    ],
  },
];

const getRoleDef = (key: string): RoleDef | undefined => ROLES.find((r) => r.key === key);

const MODULE_LABELS: Record<string, string> = {
  dashboard: "Panel Operativo",
  alertas: "Alertas",
  consultas: "Consultas",
  solicitudes: "Solicitudes / Pedidos",
  "stock-comprometido": "Stock Comprometido",
  cumplimiento: "Cumplimiento",
  recepcion: "Recepción",
  incidencias: "Incidencias",
  documentos: "Documentos",
  chofer: "Chofer",
  etiquetas: "Etiquetas",
  rendicion: "Rendición",
  abastecimiento: "Abastecimiento",
  reposicion: "Reposición",
  pedidos: "Pedidos",
  distribucion: "Distribución",
  cobranzas: "Cobranzas",
  flota: "Flota",
  ruteo: "Ruteo",
  usuarios: "Usuarios",
  "sincronizacion-bims": "Sincronización BIMS",
};

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

type UserRole = { id: string; user_id: string; role: string };
type ProfileBranchAccess = { id: string; profile_id: string; branch_id: string };

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
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

function ModuleList({ modules }: { modules: string[] }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Package className="h-4 w-4 text-muted-foreground" />
        <Label className="text-sm font-medium">Módulos habilitados</Label>
        <Badge variant="secondary" className="text-[10px]">{modules.length}</Badge>
      </div>
      <p className="text-[11px] text-muted-foreground italic">
        Los módulos son definidos por el rol. Para cambiar permisos, cambie el rol del usuario.
      </p>
      <div className="grid grid-cols-2 gap-1 max-h-48 overflow-auto">
        {modules.map((mod) => (
          <div key={mod} className="flex items-center gap-1.5 rounded px-2 py-1 bg-muted/40 text-xs text-foreground">
            <div className="h-1.5 w-1.5 rounded-full bg-primary/60 shrink-0" />
            {MODULE_LABELS[mod] ?? mod}
          </div>
        ))}
      </div>
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

  /* --- Filter state --- */
  const [searchTerm, setSearchTerm] = useState("");
  const [filterRole, setFilterRole] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterBranch, setFilterBranch] = useState<string>("all");

  /* --- Detail state --- */
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [editDefaultBranch, setEditDefaultBranch] = useState("");
  const [editAllBranches, setEditAllBranches] = useState(false);
  const [editBranchIds, setEditBranchIds] = useState<string[]>([]);
  const [editRole, setEditRole] = useState<RoleKey | "">("");

  /* --- Confirmation dialogs --- */
  const [confirmRoleChange, setConfirmRoleChange] = useState<{ newRole: RoleKey } | null>(null);
  const [confirmToggleActive, setConfirmToggleActive] = useState<{ profileId: string; newActive: boolean } | null>(null);
  const [confirmResetPassword, setConfirmResetPassword] = useState(false);
  const [resetResult, setResetResult] = useState<string | null>(null);
  const [resettingPassword, setResettingPassword] = useState(false);

  /* --- Dirty tracking --- */
  const [originalState, setOriginalState] = useState<{
    role: string; defaultBranch: string; branchIds: string[]; allBranches: boolean;
  } | null>(null);

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
      const { data, error } = await supabase.from("user_roles").select("id, user_id, role");
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
  const getUserRole = useCallback(
    (userId: string): string | null => userRoles.find((ur) => ur.user_id === userId)?.role ?? null,
    [userRoles]
  );

  const isUserOwner = useCallback(
    (userId: string): boolean => userRoles.some((ur) => ur.user_id === userId && ur.role === "owner"),
    [userRoles]
  );

  const getBranchName = useCallback(
    (branchId: string | null) => {
      if (!branchId) return "—";
      return branches.find((b) => b.id === branchId)?.name ?? "—";
    },
    [branches]
  );

  const getUserBranchCount = useCallback(
    (profile: Profile) => {
      if (profile.all_branches_access) return branches.length;
      return profileBranchAccess.filter((r) => r.profile_id === profile.id).length;
    },
    [profileBranchAccess, branches]
  );

  /* --- Filtered profiles --- */
  const filteredProfiles = useMemo(() => {
    return profiles.filter((p) => {
      const role = getUserRole(p.user_id);
      const term = searchTerm.toLowerCase();
      if (term && !p.full_name.toLowerCase().includes(term)) return false;
      if (filterRole !== "all" && role !== filterRole && !(filterRole === "owner" && isUserOwner(p.user_id))) return false;
      if (filterStatus === "active" && !p.is_active) return false;
      if (filterStatus === "inactive" && p.is_active) return false;
      if (filterBranch !== "all") {
        if (p.all_branches_access) return true;
        const hasBranch = p.default_branch_id === filterBranch ||
          profileBranchAccess.some((r) => r.profile_id === p.id && r.branch_id === filterBranch);
        if (!hasBranch) return false;
      }
      return true;
    });
  }, [profiles, searchTerm, filterRole, filterStatus, filterBranch, getUserRole, isUserOwner, profileBranchAccess]);

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.id === selectedUser),
    [profiles, selectedUser]
  );

  const selectedRoleDef = useMemo(() => editRole ? getRoleDef(editRole) : undefined, [editRole]);

  const newRoleDef = useMemo(() => newRole ? getRoleDef(newRole) : undefined, [newRole]);

  /* --- Dirty check --- */
  const isDirty = useMemo(() => {
    if (!originalState || !selectedProfile) return false;
    const currentBranches = [...editBranchIds].sort().join(",");
    const origBranches = [...originalState.branchIds].sort().join(",");
    return (
      editRole !== originalState.role ||
      editDefaultBranch !== originalState.defaultBranch ||
      currentBranches !== origBranches ||
      editAllBranches !== originalState.allBranches
    );
  }, [originalState, editRole, editDefaultBranch, editBranchIds, editAllBranches, selectedProfile]);

  /* Sync detail form when selection changes */
  useEffect(() => {
    if (!selectedProfile) {
      setOriginalState(null);
      return;
    }

    const assignedBranches = profileBranchAccess
      .filter((row) => row.profile_id === selectedProfile.id)
      .map((row) => row.branch_id);

    const merged = Array.from(
      new Set([
        ...(selectedProfile.default_branch_id ? [selectedProfile.default_branch_id] : []),
        ...assignedBranches,
      ])
    );

    const allBr = Boolean(selectedProfile.all_branches_access);
    const defBr = selectedProfile.default_branch_id ?? "";
    const currentRole = getUserRole(selectedProfile.user_id) ?? "";

    setEditAllBranches(allBr);
    setEditDefaultBranch(defBr);
    setEditBranchIds(merged);
    setEditRole(currentRole as RoleKey);

    setOriginalState({
      role: currentRole,
      defaultBranch: defBr,
      branchIds: merged,
      allBranches: allBr,
    });
  }, [selectedProfile, profileBranchAccess, userRoles, getUserRole]);

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
      setNewName(""); setNewEmail(""); setNewPassword("Movilog2026!");
      setNewBranch(""); setNewRole(""); setNewAdditionalBranches([]);
      toast.success("Usuario creado correctamente", {
        description: `Contraseña temporal: ${usedPassword} — Comunicala al usuario.`,
      });
    },
    onError: (error: Error) => toast.error(error.message || "Error al crear usuario"),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ profileId, active }: { profileId: string; active: boolean }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ is_active: active })
        .eq("id", profileId);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      toast.success(vars.active ? "Usuario reactivado" : "Usuario desactivado");
      setConfirmToggleActive(null);
    },
    onError: () => {
      toast.error("Error al cambiar el estado");
      setConfirmToggleActive(null);
    },
  });

  const saveProfile = useMutation({
    mutationFn: async ({
      profileId, userId, defaultBranchId, allBranches, branchIds, role,
    }: {
      profileId: string; userId: string; defaultBranchId: string | null;
      allBranches: boolean; branchIds: string[]; role: RoleKey;
    }) => {
      if (!role) throw new Error("Debés seleccionar un rol");
      const roleDef = getRoleDef(role)!;

      if (!allBranches && (!defaultBranchId || branchIds.length === 0)) {
        throw new Error("Debés asignar al menos una sucursal");
      }

      if (!allBranches && defaultBranchId && !branchIds.includes(defaultBranchId)) {
        throw new Error("La sucursal por defecto debe estar entre las sucursales asignadas");
      }

      await supabase
        .from("profiles")
        .update({ default_branch_id: defaultBranchId, all_branches_access: allBranches })
        .eq("id", profileId);

      await supabase.from("user_roles").delete().eq("user_id", userId);
      await supabase.from("user_roles").insert({ user_id: userId, role });

      await supabase.from("profile_branch_access").delete().eq("profile_id", profileId);
      if (!allBranches) {
        const uniqueIds = Array.from(new Set(branchIds));
        if (uniqueIds.length > 0) {
          await supabase
            .from("profile_branch_access")
            .insert(uniqueIds.map((bid) => ({ profile_id: profileId, branch_id: bid })));
        }
      }

      // Always sync modules to role defaults
      await supabase.from("user_module_access").delete().eq("profile_id", profileId);
      const accessRows = roleDef.modules.map((key) => ({
        profile_id: profileId, module_key: key, is_enabled: true,
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
      toast.success("Perfil actualizado correctamente");
    },
    onError: (error: Error) => toast.error(error.message || "Error al guardar"),
  });

  /* --- Event handlers --- */
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

  const handleRoleChange = (newRoleKey: RoleKey) => {
    if (originalState && originalState.role && originalState.role !== newRoleKey) {
      setConfirmRoleChange({ newRole: newRoleKey });
    } else {
      applyRoleChange(newRoleKey);
    }
  };

  const applyRoleChange = (role: RoleKey) => {
    setEditRole(role);
    const def = getRoleDef(role);
    if (def?.allBranchesByDefault) {
      setEditAllBranches(true);
    } else {
      setEditAllBranches(false);
    }
    setConfirmRoleChange(null);
  };
  const handleResetPassword = async () => {
    if (!selectedProfile) return;
    setResettingPassword(true);
    setConfirmResetPassword(false);
    try {
      const res = await supabase.functions.invoke("reset-user-password", {
        body: { target_user_id: selectedProfile.user_id },
      });
      if (res.error) throw new Error(res.error.message || "Error al restablecer");
      const result = res.data as { success?: boolean; temp_password?: string; error?: string };
      if (result.error) throw new Error(result.error);
      if (!result.temp_password) throw new Error("No se recibió contraseña temporal");
      setResetResult(result.temp_password);
      toast.success("Contraseña restablecida correctamente");
    } catch (err: any) {
      toast.error(err.message || "Error al restablecer contraseña");
    } finally {
      setResettingPassword(false);
    }
  };

  const handleSave = () => {
    if (!selectedProfile || !editRole) return;
    const roleDef = getRoleDef(editRole);
    saveProfile.mutate({
      profileId: selectedProfile.id,
      userId: selectedProfile.user_id,
      defaultBranchId: roleDef?.allBranchesByDefault ? null : editDefaultBranch || null,
      allBranches: roleDef?.allBranchesByDefault ?? editAllBranches,
      branchIds: roleDef?.allBranchesByDefault
        ? []
        : Array.from(new Set([editDefaultBranch, ...editBranchIds].filter(Boolean) as string[])),
      role: editRole as RoleKey,
    });
  };

  const getRoleBadgeVariant = (role: string | null): "default" | "secondary" | "outline" => {
    if (role === "owner" || role === "admin") return "default";
    if (role === "supervisor") return "secondary";
    return "outline";
  };

  const getRoleLabel = (role: string | null): string => {
    if (!role) return "Sin rol";
    if (role === "owner") return "Propietario";
    if (role === "driver") return "Op. Logístico"; // legacy mapping
    return getRoleDef(role)?.shortLabel ?? role;
  };

  const canSave =
    !!editRole &&
    (selectedRoleDef?.allBranchesByDefault || (!!editDefaultBranch && editBranchIds.length > 0));

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
            <Button><UserPlus className="h-4 w-4 mr-2" />Nuevo usuario</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Crear usuario</DialogTitle>
              <DialogDescription>Complete los datos del nuevo usuario.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Nombre completo</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nombre y apellido" />
              </div>
              <div className="space-y-2">
                <Label>Correo electrónico</Label>
                <Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="usuario@empresa.com" />
              </div>
              <div className="space-y-2">
                <Label>Contraseña temporal</Label>
                <Input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Mínimo 6 caracteres" />
                <p className="text-[11px] text-muted-foreground">
                  El usuario podrá cambiarla después de iniciar sesión.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Rol</Label>
                <Select value={newRole} onValueChange={(v) => setNewRole(v as RoleKey)}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar rol" /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {newRoleDef && <RoleCapabilities role={newRoleDef} />}
              {newRoleDef && !newRoleDef.allBranchesByDefault && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <Label>Sucursal principal</Label>
                    <Select value={newBranch} onValueChange={setNewBranch}>
                      <SelectTrigger><SelectValue placeholder="Seleccionar sucursal" /></SelectTrigger>
                      <SelectContent>
                        {branches.map((b) => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {branches.length > 1 && (
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Alcance operativo adicional</Label>
                      <div className="max-h-40 overflow-auto space-y-2">
                        {branches.filter((b) => b.id !== newBranch).map((branch) => (
                          <label key={branch.id} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={newAdditionalBranches.includes(branch.id)}
                              onCheckedChange={(checked) => toggleNewAdditionalBranch(branch.id, checked === true)}
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
              {newRoleDef && (
                <>
                  <Separator />
                  <ModuleList modules={newRoleDef.modules} />
                </>
              )}
              <Button
                className="w-full"
                disabled={
                  !newName.trim() || !newEmail.trim() || !newPassword || newPassword.length < 6 ||
                  !newRole || (!newRoleDef?.allBranchesByDefault && !newBranch) || createUser.isPending
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
          <CardHeader className="pb-3 space-y-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4" />
              Usuarios ({filteredProfiles.length}/{profiles.length})
            </CardTitle>
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre..."
                className="pl-8 h-9 text-sm"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            {/* Filters */}
            <div className="flex flex-wrap gap-2">
              <Select value={filterRole} onValueChange={setFilterRole}>
                <SelectTrigger className="h-8 text-xs w-[130px]">
                  <Filter className="h-3 w-3 mr-1" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los roles</SelectItem>
                  <SelectItem value="owner">Propietario</SelectItem>
                  {ROLES.map((r) => (
                    <SelectItem key={r.key} value={r.key}>{r.shortLabel}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-8 text-xs w-[110px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="active">Activos</SelectItem>
                  <SelectItem value="inactive">Inactivos</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterBranch} onValueChange={setFilterBranch}>
                <SelectTrigger className="h-8 text-xs w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las suc.</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <p className="p-4 text-sm text-muted-foreground">Cargando...</p>
            ) : (
              <div className="divide-y divide-border max-h-[520px] overflow-auto">
                {filteredProfiles.map((profile) => {
                  const role = getUserRole(profile.user_id);
                  const profileIsOwner = isUserOwner(profile.user_id);
                  const isProtected = profileIsOwner && !currentUserIsOwner;
                  const branchCount = getUserBranchCount(profile);
                  return (
                    <button
                      key={profile.id}
                      onClick={() => !isProtected && setSelectedUser(profile.id)}
                      className={`w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors ${
                        selectedUser === profile.id ? "bg-muted" : ""
                      } ${isProtected ? "opacity-60 cursor-not-allowed" : ""}`}
                      disabled={isProtected}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate flex items-center gap-1.5">
                            {profileIsOwner && <Crown className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                            {profile.full_name}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            {profileIsOwner ? (
                              <Badge className="text-[10px] px-1.5 py-0 bg-amber-500/15 text-amber-700 border-amber-300">
                                Propietario
                              </Badge>
                            ) : (
                              <Badge variant={getRoleBadgeVariant(role)} className="text-[10px] px-1.5 py-0">
                                {getRoleLabel(role)}
                              </Badge>
                            )}
                            <span className="text-[10px] text-muted-foreground">
                              {profile.all_branches_access
                                ? "Todas las suc."
                                : getBranchName(profile.default_branch_id)}
                            </span>
                            {!profile.all_branches_access && branchCount > 1 && (
                              <Badge variant="outline" className="text-[9px] px-1 py-0">
                                +{branchCount - 1} suc.
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          {!profile.is_active && (
                            <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Inactivo</Badge>
                          )}
                          {profile.is_active && (
                            <div className="h-2 w-2 rounded-full bg-emerald-500" title="Activo" />
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
                {filteredProfiles.length === 0 && profiles.length > 0 && (
                  <p className="p-4 text-sm text-muted-foreground text-center">
                    Sin resultados para los filtros aplicados.
                  </p>
                )}
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
              {isDirty && (
                <Badge variant="outline" className="text-[10px] gap-1 text-amber-600 border-amber-300">
                  <AlertTriangle className="h-3 w-3" />
                  Cambios sin guardar
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {selectedProfile && isUserOwner(selectedProfile.user_id) ? (
              <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
                <Crown className="h-8 w-8 text-amber-500" />
                <p className="text-sm font-medium">Cuenta de Propietario</p>
                <p className="text-xs text-center max-w-sm">
                  Este usuario es propietario del sistema. Su configuración está protegida y no puede ser modificada por otros usuarios.
                </p>
              </div>
            ) : selectedProfile ? (
              <div className="space-y-5">
                {/* Section: General info */}
                <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Datos generales</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <div>
                      <p className="text-[11px] text-muted-foreground">Nombre</p>
                      <p className="text-sm font-medium">{selectedProfile.full_name}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">Estado</p>
                      <div className="flex items-center gap-2">
                        {selectedProfile.is_active ? (
                          <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-700 border-emerald-300">
                            Activo
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="text-[10px]">Inactivo</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section: Role */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Rol</p>
                  <Select
                    value={editRole}
                    onValueChange={(v) => handleRoleChange(v as RoleKey)}
                  >
                    <SelectTrigger><SelectValue placeholder="Seleccionar rol" /></SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedRoleDef && <RoleCapabilities role={selectedRoleDef} />}
                </div>

                <Separator />

                {/* Section: Branch scope */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Alcance operativo</p>
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
                          <SelectTrigger><SelectValue placeholder="Seleccionar sucursal" /></SelectTrigger>
                          <SelectContent>
                            {branches.map((b) => (
                              <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
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

                <Separator />

                {/* Section: Modules (read-only) */}
                {selectedRoleDef && <ModuleList modules={selectedRoleDef.modules} />}

                <Separator />

                {/* Section: Actions */}
                <div className="space-y-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Acciones</p>
                  <div className="flex flex-wrap gap-2">
                    {/* Toggle active */}
                    <Button
                      variant={selectedProfile.is_active ? "outline" : "default"}
                      size="sm"
                      onClick={() =>
                        setConfirmToggleActive({
                          profileId: selectedProfile.id,
                          newActive: !selectedProfile.is_active,
                        })
                      }
                    >
                      {selectedProfile.is_active ? "Desactivar usuario" : "Reactivar usuario"}
                    </Button>
                    {/* Password reset */}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={resettingPassword}
                      onClick={() => setConfirmResetPassword(true)}
                    >
                      <KeyRound className="h-3.5 w-3.5 mr-1" />
                      {resettingPassword ? "Restableciendo..." : "Restablecer acceso"}
                    </Button>
                  </div>
                </div>

                <Separator />

                {/* Save */}
                <div className="flex items-center justify-between pt-1">
                  {isDirty && (
                    <p className="text-xs text-amber-600 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Hay cambios pendientes de guardar
                    </p>
                  )}
                  <div className="ml-auto">
                    <Button
                      onClick={handleSave}
                      disabled={saveProfile.isPending || !canSave || !isDirty}
                    >
                      <Save className="h-4 w-4 mr-1" />
                      {saveProfile.isPending ? "Guardando..." : "Guardar cambios"}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
                <Users className="h-8 w-8 opacity-30" />
                <p className="text-sm">Seleccioná un usuario de la lista para gestionar su rol y alcance</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Confirm role change */}
      <AlertDialog
        open={!!confirmRoleChange}
        onOpenChange={(open) => !open && setConfirmRoleChange(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cambiar rol del usuario</AlertDialogTitle>
            <AlertDialogDescription>
              Al cambiar el rol, se reemplazarán todos los módulos actuales por los definidos en el nuevo rol
              ({confirmRoleChange ? getRoleDef(confirmRoleChange.newRole)?.label : ""}).
              Esta acción no se puede deshacer parcialmente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmRoleChange && applyRoleChange(confirmRoleChange.newRole)}
            >
              Confirmar cambio
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm toggle active */}
      <AlertDialog
        open={!!confirmToggleActive}
        onOpenChange={(open) => !open && setConfirmToggleActive(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmToggleActive?.newActive ? "Reactivar usuario" : "Desactivar usuario"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmToggleActive?.newActive
                ? "El usuario podrá volver a acceder al sistema con sus permisos actuales."
                : "El usuario no podrá acceder al sistema hasta que sea reactivado. Sus datos y configuración se mantendrán intactos."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                confirmToggleActive &&
                toggleActive.mutate({
                  profileId: confirmToggleActive.profileId,
                  active: confirmToggleActive.newActive,
                })
              }
            >
              {confirmToggleActive?.newActive ? "Reactivar" : "Desactivar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
