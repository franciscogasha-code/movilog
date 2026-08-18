import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronRight, FileDown, Loader2, Search, X, ArrowRightLeft } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { RequestDetailRouter } from "@/components/solicitudes/RequestDetailRouter";
import { generatePreSalePdf } from "@/lib/pre-sale-pdf";
import { fetchRequestClientContact } from "@/lib/branch-requests-query";
import { useToast } from "@/hooks/use-toast";

const PRE_SALE_STATE: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  draft: { label: "Borrador", variant: "outline" },
  sent: { label: "Enviado al cliente", variant: "secondary" },
  confirmed: { label: "Confirmado", variant: "default" },
  converted: { label: "Convertido", variant: "default" },
};

const CHANNEL_LABELS: Record<string, string> = {
  web: "Web",
  whatsapp: "WhatsApp",
  local: "Local",
  online: "Online",
  phone: "Teléfono",
};

type PreSaleRow = {
  id: string;
  request_number: number;
  status: string;
  created_at: string;
  client_name: string | null;
  pre_sale_status: string | null;
  sales_channel: string | null;
  converted_to_request_id: string | null;
  requesting_branch: { name: string | null } | null;
  branch_request_items: { quantity_requested: number; product: { sell_price: number | null } | null }[] | null;
};

export function PreSalesList({
  userId,
  salespersonName,
}: {
  userId: string;
  salespersonName?: string | null;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const detailId = searchParams.get("detail");
  const [search, setSearch] = useState("");
  const [pdfLoadingId, setPdfLoadingId] = useState<string | null>(null);

  const { data: preSales = [], refetch } = useQuery({
    queryKey: ["sales_pre_sales", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_requests")
        .select(
          `id, request_number, status, created_at, client_name, pre_sale_status, sales_channel,
           converted_to_request_id,
           requesting_branch:branches!branch_requests_requesting_branch_id_fkey(name),
           branch_request_items(quantity_requested, product:products(sell_price))`
        )
        .eq("created_by", userId)
        .eq("is_pre_sale", true)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as PreSaleRow[];
    },
  });

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return preSales
      .map((o) => {
        const items = o.branch_request_items ?? [];
        const itemCount = items.length;
        const total = items.reduce(
          (acc, it) => acc + (it.quantity_requested ?? 0) * (it.product?.sell_price ?? 0),
          0
        );
        return { ...o, itemCount, total };
      })
      .filter((o) => {
        if (!term) return true;
        return (
          String(o.request_number).includes(term) ||
          (o.client_name ?? "").toLowerCase().includes(term)
        );
      });
  }, [preSales, search]);

  const openDetail = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("detail", id);
    setSearchParams(next, { replace: false });
  };

  const closeDetail = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("detail");
    setSearchParams(next, { replace: true });
    refetch();
    qc.invalidateQueries({ queryKey: ["sales_pre_sales", userId] });
  };

  async function downloadPdf(id: string) {
    setPdfLoadingId(id);
    try {
      const [{ data: request, error: rErr }, { data: items, error: iErr }] = await Promise.all([
        supabase
          .from("branch_requests")
          .select("request_number, client_name, client_address, notes, commercial_terms, created_at")
          .eq("id", id)
          .single(),
        supabase
          .from("branch_request_items")
          .select("*, product:products(name, sku, bims_code, image_url, sell_price)")
          .eq("request_id", id),
      ]);
      if (rErr) throw rErr;
      if (iErr) throw iErr;

      let contact: { client_phone: string | null; client_email: string | null } | null = null;
      try {
        contact = (await fetchRequestClientContact(id)) as any;
      } catch {
        contact = null;
      }

      await generatePreSalePdf({
        request_number: request!.request_number,
        client_name: request!.client_name,
        client_phone: contact?.client_phone ?? null,
        client_email: contact?.client_email ?? null,
        client_address: request!.client_address,
        notes: request!.notes,
        commercial_terms: (request as any).commercial_terms,
        salesperson_name: salespersonName ?? null,
        created_at: request!.created_at,
        items: (items ?? []) as any,
      });

      await supabase
        .from("branch_requests")
        .update({ pre_sale_pdf_generated_at: new Date().toISOString() } as any)
        .eq("id", id);
      toast({ title: "PDF generado" });
      refetch();
    } catch (e: any) {
      toast({ title: "Error generando PDF", description: e.message, variant: "destructive" });
    } finally {
      setPdfLoadingId(null);
    }
  }

  return (
    <>
      {preSales.length > 0 && (
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por número o cliente"
            className="pl-9 pr-9"
          />
          {search && (
            <button
              type="button"
              aria-label="Limpiar búsqueda"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      <div className="space-y-3">
        {preSales.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            Aún no tenés pre-ventas registradas
          </p>
        )}
        {preSales.length > 0 && rows.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            No hay pre-ventas que coincidan con “{search}”
          </p>
        )}

        {rows.map((order) => {
          const state = PRE_SALE_STATE[order.pre_sale_status ?? "draft"] ?? PRE_SALE_STATE.draft;
          const channel = order.sales_channel ? CHANNEL_LABELS[order.sales_channel] ?? order.sales_channel : null;
          const canConvert = (order.pre_sale_status ?? "draft") === "confirmed" && !order.converted_to_request_id;
          return (
            <div
              key={order.id}
              role="button"
              tabIndex={0}
              onClick={() => openDetail(order.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openDetail(order.id);
                }
              }}
              className="border rounded-lg p-3 cursor-pointer transition-colors hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">Pedido #{order.request_number}</span>
                    <Badge variant={state.variant} className="text-[10px]">
                      {state.label}
                    </Badge>
                    {channel && (
                      <Badge variant="outline" className="text-[10px]">
                        {channel}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground truncate">
                    {order.client_name || "Sin cliente"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {order.itemCount} ítem{order.itemCount === 1 ? "" : "s"}
                    {order.total > 0 && <> · ₲ {order.total.toLocaleString("de-DE")} estimado</>}
                    {order.requesting_branch?.name && <> · {order.requesting_branch.name}</>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(order.created_at), { addSuffix: true, locale: es })}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
              </div>

              <div className="flex gap-2 mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={pdfLoadingId === order.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    downloadPdf(order.id);
                  }}
                >
                  {pdfLoadingId === order.id ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <FileDown className="h-3.5 w-3.5 mr-1" />
                  )}
                  Ver PDF
                </Button>
                {canConvert && (
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      openDetail(order.id);
                    }}
                  >
                    <ArrowRightLeft className="h-3.5 w-3.5 mr-1" />
                    Convertir
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={!!detailId} onOpenChange={(open) => !open && closeDetail()}>
        <DialogContent
          className="
            p-0 gap-0 overflow-hidden
            w-screen h-[100dvh] max-h-[100dvh] max-w-none rounded-none border-0
            sm:w-[calc(100vw-2rem)] sm:max-w-3xl sm:h-auto sm:max-h-[90vh]
            sm:rounded-lg sm:border
            flex flex-col
          "
        >
          <DialogHeader className="px-4 py-3 sm:px-6 sm:py-4 border-b bg-background sticky top-0 z-20 shrink-0 pr-14 sm:pr-12 pt-[calc(env(safe-area-inset-top)+0.75rem)] sm:pt-4">
            <DialogTitle className="text-base sm:text-lg">Detalle del Pedido</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-6 sm:py-5 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            {detailId && <RequestDetailRouter requestId={detailId} onUpdate={() => refetch()} />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
