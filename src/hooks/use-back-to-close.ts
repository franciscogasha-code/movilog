import { useEffect, useRef } from "react";

/**
 * Sincroniza el estado abierto de un overlay (Dialog, Sheet, Drawer, etc.)
 * con el history del navegador, de modo que el botón "atrás" nativo
 * (Android, gesto iOS, Alt+← en desktop) cierre el overlay en lugar de
 * abandonar la pantalla actual.
 *
 * Uso:
 *   const [open, setOpen] = useState(false);
 *   useBackToClose(open, () => setOpen(false));
 *
 * Implementación: cuando el overlay se abre, hacemos pushState con un marker.
 * Al disparar popstate, si el overlay sigue abierto lo cerramos. Cuando el
 * overlay se cierra desde la UI, removemos la entrada del history.
 */
export function useBackToClose(isOpen: boolean, onClose: () => void) {
  const pushedRef = useRef(false);
  const onCloseRef = useRef(onClose);

  // Mantener referencia fresca sin re-disparar el efecto
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    // Push de una entrada "marker" al abrir
    const marker = { __overlay: true, ts: Date.now() };
    window.history.pushState(marker, "");
    pushedRef.current = true;

    const handlePop = () => {
      // El usuario presionó back: cerrar el overlay
      pushedRef.current = false;
      onCloseRef.current();
    };

    window.addEventListener("popstate", handlePop);

    return () => {
      window.removeEventListener("popstate", handlePop);
      // Si el overlay se cerró desde la UI (no por back), limpiar la entrada
      if (pushedRef.current) {
        pushedRef.current = false;
        // Evita romper la pila si el usuario ya navegó
        try {
          window.history.back();
        } catch {
          /* noop */
        }
      }
    };
  }, [isOpen]);
}
