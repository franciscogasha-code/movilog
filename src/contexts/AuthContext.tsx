import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

type Profile = {
  id: string;
  full_name: string;
  default_branch_id: string | null;
  all_branches_access: boolean;
  is_active: boolean;
};

type ModuleAccess = {
  module_key: string;
  is_enabled: boolean;
};

type BranchAccess = {
  branch_id: string;
};

type UserRole = {
  user_id: string;
  role: string;
};

type AuthState = {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  modules: ModuleAccess[];
  branchAccess: BranchAccess[];
  roles: UserRole[];
  loading: boolean;
  signOut: () => Promise<void>;
  /** Returns true if the current user has access to the given module key */
  hasModule: (key: string) => boolean;
  /** Returns true if current user can see data for a given branch id */
  hasBranch: (branchId: string) => boolean;
  /** Returns the list of branch IDs the user can access (empty = all) */
  allowedBranchIds: string[];
  /** Returns true if the current user has the 'owner' role */
  isOwner: boolean;
  /** Returns true if the user has a specific role */
  hasRole: (role: string) => boolean;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [modules, setModules] = useState<ModuleAccess[]>([]);
  const [branchAccess, setBranchAccess] = useState<BranchAccess[]>([]);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId: string) => {
    // Find profile by user_id
    const { data: profileData } = await supabase
      .from("profiles")
      .select("id, full_name, default_branch_id, all_branches_access, is_active")
      .eq("user_id", userId)
      .maybeSingle();

    if (profileData) {
      setProfile(profileData as Profile);

      // Load modules, branch access, and roles in parallel
      const [modRes, branchRes, rolesRes] = await Promise.all([
        supabase
          .from("user_module_access")
          .select("module_key, is_enabled")
          .eq("profile_id", profileData.id),
        supabase
          .from("profile_branch_access")
          .select("branch_id")
          .eq("profile_id", profileData.id),
        supabase
          .from("user_roles")
          .select("user_id, role")
          .eq("user_id", userId),
      ]);

      setModules((modRes.data as ModuleAccess[]) || []);
      setBranchAccess((branchRes.data as BranchAccess[]) || []);
      setRoles((rolesRes.data as UserRole[]) || []);
    } else {
      setProfile(null);
      setModules([]);
      setBranchAccess([]);
      setRoles([]);
    }
  }, []);

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);

        if (newSession?.user) {
          // Defer profile load to avoid deadlock with Supabase client
          setTimeout(() => loadProfile(newSession.user.id), 0);
        } else {
          setProfile(null);
          setModules([]);
          setBranchAccess([]);
          setRoles([]);
        }
        setLoading(false);
      }
    );

    // THEN check existing session
    supabase.auth.getSession().then(({ data: { session: existing } }) => {
      setSession(existing);
      setUser(existing?.user ?? null);
      if (existing?.user) {
        loadProfile(existing.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [loadProfile]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setModules([]);
    setBranchAccess([]);
    setRoles([]);
  };

  const hasModule = useCallback(
    (key: string) => {
      if (!profile) return false;
      const mod = modules.find((m) => m.module_key === key);
      // Default to enabled if no record exists
      return mod ? mod.is_enabled : true;
    },
    [profile, modules]
  );

  const hasBranch = useCallback(
    (branchId: string) => {
      if (!profile) return false;
      if (profile.all_branches_access) return true;
      return branchAccess.some((ba) => ba.branch_id === branchId);
    },
    [profile, branchAccess]
  );

  const allowedBranchIds = profile?.all_branches_access
    ? []
    : branchAccess.map((ba) => ba.branch_id);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        modules,
        branchAccess,
        loading,
        signOut,
        hasModule,
        hasBranch,
        allowedBranchIds,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
