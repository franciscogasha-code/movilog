import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Trash2, CloudOff, AlertCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { formatGs } from "@/lib/ventas";
import type { OutboxEntry } from "@/lib/sales-outbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function PendientesEnvio({
  entries,
  syncing,
  online,
  onRetry,
  onDiscard,
}: {
  entries: OutboxEntry[];
  syncing: boolean;
  online: boolean;
  onRetry: (entry: OutboxEntry) => void;
  onDiscard: (clientUuid: string) => void;
}) {
  if (entries.length === 0) return null;

  return (
    <div className="space-y-3 mb-4">
      <div className="flex items-center gap-2">
        <CloudOff className="h-4 w-4 text-amber-500" />
        <h2 className="text-sm font-semibold">Pendientes de envío ({entries.length})</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Estos pedidos están guardados en el dispositivo. Se envían solos cuando hay conexión y no se
        borran ante un error.
      </p>

      {entries.map((entry) => {
        const total = entry.payload.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        return (
          <div
            key={entry.clientUuid}
            className="border rounded-lg p-3 space-y-2 border-amber-500/40 bg-amber-500/5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-sm line-clamp-1">{entry.payload.customer.name}</p>
                <p className="text-xs text-muted-foreground">
                  {entry.payload.items.length} ítems · {formatGs(total)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Guardado{" "}
                  {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true, locale: es })}
                </p>
              </div>
              <Badge variant={entry.status === "error" ? "destructive" : "secondary"}>
                {entry.status === "error"
                  ? "Con error"
                  : entry.status === "sending"
                    ? "Enviando"
                    : "Pendiente"}
              </Badge>
            </div>

            {entry.lastError && (
              <div className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span className="line-clamp-2">{entry.lastError}</span>
              </div>
            )}

            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">Ver productos</summary>
              <ul className="mt-1 space-y-0.5">
                {entry.payload.items.map((i) => (
                  <li key={i.productId} className="flex justify-between gap-2">
                    <span className="line-clamp-1">
                      {i.quantity} × {i.name}
                    </span>
                    <span>{formatGs(i.quantity * i.unitPrice)}</span>
                  </li>
                ))}
              </ul>
            </details>

            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                disabled={syncing || !online}
                onClick={() => onRetry(entry)}
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncing ? "animate-spin" : ""}`} />
                Reintentar
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost" className="text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>¿Descartar este pedido?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Se borra del dispositivo y no se va a enviar. Esta acción no se puede deshacer.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onDiscard(entry.clientUuid)}>
                      Descartar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        );
      })}
    </div>
  );
}
