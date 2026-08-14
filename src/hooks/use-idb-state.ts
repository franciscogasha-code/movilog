import { useEffect, useRef, useState } from "react";
import { idbGet, idbSet } from "@/lib/offline-store";

/**
 * Estado de React persistido en IndexedDB.
 * Se hidrata al montar y guarda cada cambio, para que nada se pierda
 * si la app se cierra, se refresca o se corta la batería.
 *
 * Importante: nunca escribe hasta terminar de leer lo guardado para ESA clave.
 * Si la clave cambia (por ejemplo cuando recién se resuelve la sesión), no
 * sobrescribe el valor guardado con el estado viejo.
 */
export function useIdbState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  /** Clave efectivamente hidratada; null mientras se está leyendo */
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);

  const initialRef = useRef(initial);

  useEffect(() => {
    let alive = true;
    setHydratedKey(null);
    idbGet<T>(key).then((stored) => {
      if (!alive) return;
      setValue(stored !== undefined ? stored : initialRef.current);
      setHydratedKey(key);
    });
    return () => {
      alive = false;
    };
  }, [key]);

  useEffect(() => {
    // Solo persistimos cuando el valor corresponde a la clave ya hidratada
    if (hydratedKey !== key) return;
    void idbSet(key, value);
  }, [value, hydratedKey, key]);

  const hydrated = hydratedKey === key;
  return [value, setValue, hydrated] as const;
}
