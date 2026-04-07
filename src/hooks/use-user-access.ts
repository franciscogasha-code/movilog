import { useAuth } from "@/contexts/AuthContext";
import { useMemo } from "react";

/**
 * Returns branch filtering helpers for data queries.
 * Components should use `filterByBranch(branchId)` to check visibility
 * and `branchFilter` to build Supabase .in() queries.
 */
export function useUserBranchFilter() {
  const { profile, allowedBranchIds } = useAuth();

  const isAllBranches = profile?.all_branches_access ?? false;

  const filterByBranch = useMemo(() => {
    if (isAllBranches) return (_id: string) => true;
    const set = new Set(allowedBranchIds);
    return (branchId: string) => set.has(branchId);
  }, [isAllBranches, allowedBranchIds]);

  return {
    isAllBranches,
    allowedBranchIds,
    filterByBranch,
    /** The default branch to pre-select in forms */
    defaultBranchId: profile?.default_branch_id ?? null,
  };
}
