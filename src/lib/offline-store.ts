import { get, set, del, createStore } from "idb-keyval";
import type { Persister, PersistedClient } from "@tanstack/react-query-persist-client";

/** Store dedicado de MoviLog en IndexedDB */
export const movilogStore = createStore("movilog-offline", "kv");

export async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    return (await get(key, movilogStore)) as T | undefined;
  } catch {
    return undefined;
  }
}

export async function idbSet<T>(key: string, value: T): Promise<void> {
  try {
    await set(key, value, movilogStore);
  } catch (e) {
    console.warn("[offline] no se pudo guardar en IndexedDB", key, e);
  }
}

export async function idbDel(key: string): Promise<void> {
  try {
    await del(key, movilogStore);
  } catch {
    /* noop */
  }
}

const PERSIST_KEY = "react-query-cache";

/**
 * Persistor de React Query sobre IndexedDB.
 * Permite que el catálogo y los clientes ya consultados sigan disponibles sin señal.
 */
export function createIdbPersister(): Persister {
  return {
    persistClient: async (client: PersistedClient) => {
      await idbSet(PERSIST_KEY, client);
    },
    restoreClient: async () => idbGet<PersistedClient>(PERSIST_KEY),
    removeClient: async () => idbDel(PERSIST_KEY),
  };
}
