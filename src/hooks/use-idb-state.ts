import { useEffect, useRef, useState } from "react";
import { idbGet, idbSet } from "@/lib/offline-store";

/**
 * Estado de React persistido en IndexedDB.
 * Se hidrata al montar y guarda cada cambio, para que nada se pierda
 * si la app se cierra, se refresca o se corta la batería.
 */
export function useIdbState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [hydrated, setHydrated] = useState(false);
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    let alive = true;
    setHydrated(false);
    idbGet<T>(key).then((stored) => {
      if (!alive) return;
      if (stored !== undefined) setValue(stored);
      setHydrated(true);
    });
    return () => {
      alive = false;
    };
  }, [key]);

  useEffect(() => {
    if (!hydrated) return;
    void idbSet(keyRef.current, value);
  }, [value, hydrated]);

  return [value, setValue, hydrated] as const;
}
