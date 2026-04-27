import { useEffect, useRef } from "react";

/**
 * Sincroniza el estado abierto de un overlay (Dialog, Sheet, Drawer, etc.)
 * con el history del navegador, de modo que el botón "atrás" nativo
 * (Android, gesto iOS, Alt+← en desktop) cierre el overlay en lugar de
 * abandonar la pantalla actual.
 *
 * Diseño actualizado (anti-regresión navegación mobile):
 *  - Al abrir, hacemos pushState con un marker. Si el usuario presiona back,
 *    el popstate cierra el overlay (sin volver a llamar history.back, porque
 *    el navegador ya consumió la entrada marker).
 *  - Al cerrarse el overlay desde la UI:
 *      * si nuestra entrada marker sigue siendo el TOP del history,
 *        la quitamos con un único history.back() y silenciamos ese popstate.
 *      * si entre medio ocurrió una navegación real (push/replace) — por
 *        ejemplo el usuario tocó un item del sidebar y React Router empujó
 *        una ruta encima de nuestro marker — NO tocamos history. Hacerlo
 *        revertía la navegación recién hecha (síntoma: tocar Pedidos vuelve
 *        a Dashboard). En ese caso el marker queda enterrado en el stack y
 *        se ignora.
 *
 * El marker incluye un id único por instancia para detectar exactamente
 * nuestra entrada y evitar interferencias entre overlays anidados.
 */

type BackMarker = { __overlay: true; id: number };

let markerCounter = 0;

function isOurMarkerOnTop(id: number): boolean {
  const s = window.history.state as BackMarker | null;
  return !!s && typeof s === "object" && (s as any).__overlay === true && (s as any).id === id;
}

export function useBackToClose(isOpen: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  const markerIdRef = useRef<number | null>(null);
  const ignoreNextPopRef = useRef(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const id = ++markerCounter;
    markerIdRef.current = id;
    const marker: BackMarker = { __overlay: true, id };

    try {
      window.history.pushState(marker, "");
    } catch {
      /* noop */
    }

    const handlePop = () => {
      if (ignoreNextPopRef.current) {
        ignoreNextPopRef.current = false;
        return;
      }
      // Back nativo: el navegador ya consumió el marker. Sólo cerramos UI.
      markerIdRef.current = null;
      onCloseRef.current();
    };

    window.addEventListener("popstate", handlePop);

    return () => {
      window.removeEventListener("popstate", handlePop);

      const id = markerIdRef.current;
      markerIdRef.current = null;
      if (id == null) return; // ya consumido por popstate

      // Sólo intentamos remover el marker si SIGUE siendo el top del stack.
      // Si hay una navegación real encima (ej. router.push), NO tocamos history.
      if (isOurMarkerOnTop(id)) {
        ignoreNextPopRef.current = true;
        try {
          window.history.back();
        } catch {
          ignoreNextPopRef.current = false;
        }
      }
    };
  }, [isOpen]);
}
