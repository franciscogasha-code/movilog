import { useCallback, useEffect, useState } from "react";
import {
  getOutbox,
  subscribeOutbox,
  processOutbox,
  processEntry,
  removeEntry,
  isUnsent,
  type OutboxEntry,
} from "@/lib/sales-outbox";
import { useOnlineStatus } from "@/hooks/use-online-status";

const BACKOFF_MS = [5_000, 30_000, 120_000, 600_000, 1_800_000];

/** Cola de pre-ventas pendientes de envío, con reintento automático. */
export function useSalesOutbox() {
  const online = useOnlineStatus();
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    getOutbox().then(setEntries);
    return subscribeOutbox(setEntries);
  }, []);

  const flush = useCallback(async () => {
    if (!navigator.onLine) return { sent: 0, failed: 0 };
    setSyncing(true);
    try {
      return await processOutbox();
    } finally {
      setSyncing(false);
    }
  }, []);

  // Al montar y cada vez que vuelve la conexión
  useEffect(() => {
    if (online) void flush();
  }, [online, flush]);

  // Reintento con backoff exponencial mientras haya pendientes
  const pending = entries.filter(isUnsent);
  const maxAttempts = pending.reduce((m, e) => Math.max(m, e.attempts), 0);
  useEffect(() => {
    if (!online || pending.length === 0) return;
    const delay = BACKOFF_MS[Math.min(maxAttempts, BACKOFF_MS.length - 1)];
    const t = setTimeout(() => void flush(), delay);
    return () => clearTimeout(t);
  }, [online, pending.length, maxAttempts, flush]);

  const retryOne = useCallback(async (entry: OutboxEntry) => {
    setSyncing(true);
    try {
      return await processEntry(entry);
    } finally {
      setSyncing(false);
    }
  }, []);

  return {
    entries,
    pending,
    online,
    syncing,
    flush,
    retryOne,
    discard: removeEntry,
  };
}
