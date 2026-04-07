import { useBranches } from "@/hooks/use-branches";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface BranchSelectorProps {
  value: string;
  onChange: (branchId: string) => void;
  label?: string;
  excludeIds?: string[];
  disabled?: boolean;
  className?: string;
}

export function BranchSelector({ value, onChange, label, excludeIds = [], disabled, className }: BranchSelectorProps) {
  const { data: branches } = useBranches();
  const filtered = branches?.filter(b => !excludeIds.includes(b.id)) || [];

  return (
    <div className={cn("space-y-2", className)}>
      {label && <Label>{label}</Label>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="">Seleccionar sucursal...</option>
        {filtered.map((b) => (
          <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
        ))}
      </select>
    </div>
  );
}

interface MultiBranchSelectorProps {
  selected: string[];
  onChange: (branchIds: string[]) => void;
  label?: string;
  excludeIds?: string[];
  className?: string;
}

export function MultiBranchSelector({ selected, onChange, label, excludeIds = [], className }: MultiBranchSelectorProps) {
  const { data: branches } = useBranches();
  const filtered = branches?.filter(b => !excludeIds.includes(b.id)) || [];

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter(b => b !== id) : [...selected, id]);
  };

  return (
    <div className={cn("space-y-2", className)}>
      {label && <Label>{label}</Label>}
      <div className="flex flex-wrap gap-2">
        {filtered.map((b) => (
          <Badge
            key={b.id}
            variant={selected.includes(b.id) ? "default" : "outline"}
            className="cursor-pointer transition-colors hover:bg-accent/20"
            onClick={() => toggle(b.id)}
          >
            {b.name} ({b.code})
          </Badge>
        ))}
      </div>
      {selected.length === 0 && (
        <p className="text-xs text-muted-foreground">Seleccionar al menos una sucursal</p>
      )}
    </div>
  );
}

/**
 * Auto-selects the user's default branch and locks it if no multi-branch access
 */
export function useAutoDetectBranch() {
  const { profile } = useAuth();
  return {
    defaultBranchId: profile?.default_branch_id ?? null,
    canChangeBranch: profile?.all_branches_access ?? false,
  };
}
