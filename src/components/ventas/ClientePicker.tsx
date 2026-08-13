import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Search, User } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import type { CartCustomer } from "@/hooks/use-sales-cart";

type CustomerRow = {
  id: string;
  bims_contact_id: string | null;
  name: string;
  ruc: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  price_list_id: string | null;
  is_active: boolean;
};

export function ClientePicker({
  value,
  onChange,
}: {
  value: CartCustomer;
  onChange: (customer: CartCustomer) => void;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [isManual, setIsManual] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const runLocalSearch = async (term: string) => {
    let q = supabase
      .from("sales_customers")
      .select("id, bims_contact_id, name, ruc, address, phone, email, price_list_id, is_active")
      .eq("is_active", true)
      .order("name", { ascending: true });
    if (term) {
      const like = `%${term}%`;
      q = q.or(`name.ilike.${like},ruc.ilike.${like}`);
    }
    const { data, error } = await q.limit(50);
    if (error) throw error;
    return (data ?? []) as CustomerRow[];
  };

  const { data: customers, isFetching } = useQuery<CustomerRow[]>({
    queryKey: ["sales_customers", debouncedSearch, user?.id],
    queryFn: async () => {
      const term = debouncedSearch.trim();
      const local = await runLocalSearch(term);
      if (local.length > 0 || term.length < 3) return local;

      // Fallback: buscar en vivo en BIMS y guardar el contacto localmente


      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bims-proxy?action=search-contacts&q=${encodeURIComponent(term)}&limit=20`;
      try {
        const res = await fetch(url, {
          headers: {
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
        });
        if (!res.ok) return local;
        const json = await res.json();
        if (!json?.count) return local;
      } catch {
        return local;
      }
      return await runLocalSearch(term);
    },
  });

  const handleSelect = (c: CustomerRow) => {
    onChange({
      id: c.id,
      name: c.name,
      phone: c.phone ?? "",
      email: c.email ?? "",
      address: c.address ?? "",
      ruc: c.ruc ?? "",
      priceListId: c.price_list_id,
    });
    setOpen(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <User className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">Cliente</span>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          {value.name ? "Cambiar" : "Seleccionar"}
        </Button>
      </div>

      {value.name ? (
        <Card className="bg-muted/40">
          <CardContent className="p-3 text-sm">
            <p className="font-semibold">{value.name}</p>
            {value.ruc && <p className="text-muted-foreground">RUC: {value.ruc}</p>}
            {value.phone && <p className="text-muted-foreground">Tel: {value.phone}</p>}
            {value.address && <p className="text-muted-foreground truncate">{value.address}</p>}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed">
          <CardContent className="p-3 text-sm text-muted-foreground text-center">
            Sin cliente seleccionado
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">Seleccionar cliente</DialogTitle>
          </DialogHeader>

          <div className="flex items-center gap-2 mt-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre, razón social o RUC..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button
              type="button"
              variant={isManual ? "default" : "outline"}
              size="icon"
              onClick={() => setIsManual(!isManual)}
              title="Cliente nuevo"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {isManual ? (
            <div className="space-y-3 mt-3">
              <Input
                placeholder="Nombre o razón social *"
                value={value.name}
                onChange={(e) => onChange({ ...value, name: e.target.value })}
              />
              <Input
                placeholder="RUC"
                value={value.ruc}
                onChange={(e) => onChange({ ...value, ruc: e.target.value })}
              />
              <Input
                placeholder="Teléfono"
                value={value.phone}
                onChange={(e) => onChange({ ...value, phone: e.target.value })}
              />
              <Input
                placeholder="Email"
                value={value.email}
                onChange={(e) => onChange({ ...value, email: e.target.value })}
              />
              <Input
                placeholder="Dirección"
                value={value.address}
                onChange={(e) => onChange({ ...value, address: e.target.value })}
              />
              <Button
                className="w-full"
                disabled={!value.name.trim()}
                onClick={() => {
                  setIsManual(false);
                  setOpen(false);
                }}
              >
                Usar cliente manual
              </Button>
            </div>
          ) : (
            <div className="space-y-2 mt-3">
              {isFetching && (
                <p className="text-sm text-muted-foreground text-center py-4">Buscando...</p>
              )}
              {!isFetching && (customers ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No se encontraron clientes
                </p>
              )}
              {(customers ?? []).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleSelect(c)}
                  className="w-full text-left p-3 rounded-lg border hover:bg-accent transition-colors"
                >
                  <p className="font-medium text-sm">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.ruc ? `RUC ${c.ruc}` : "Sin RUC"}
                    {c.phone ? ` · ${c.phone}` : ""}
                  </p>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
