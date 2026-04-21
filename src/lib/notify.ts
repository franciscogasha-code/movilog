/**
 * Sistema unificado de notificaciones (toasts) — MoviLog
 * Iconografía consistente, duraciones estándar y tonos semánticos.
 *
 * Uso:
 *   import { notify } from "@/lib/notify";
 *   notify.success("Pedido creado");
 *   notify.error("No se pudo guardar", { description: err.message });
 *   notify.warning("Stock bajo");
 *   notify.info("Sincronizando...");
 *   notify.loading("Procesando...");
 */
import { toast as sonnerToast, type ExternalToast } from "sonner";

const DURATION = {
  success: 3000,
  info: 3000,
  warning: 4500,
  error: 5500,
  loading: Infinity,
} as const;

type Opts = ExternalToast;

export const notify = {
  success: (message: string, opts?: Opts) =>
    sonnerToast.success(message, { duration: DURATION.success, ...opts }),
  error: (message: string, opts?: Opts) =>
    sonnerToast.error(message, { duration: DURATION.error, ...opts }),
  warning: (message: string, opts?: Opts) =>
    sonnerToast.warning(message, { duration: DURATION.warning, ...opts }),
  info: (message: string, opts?: Opts) =>
    sonnerToast.info(message, { duration: DURATION.info, ...opts }),
  loading: (message: string, opts?: Opts) =>
    sonnerToast.loading(message, { duration: DURATION.loading, ...opts }),
  dismiss: (id?: string | number) => sonnerToast.dismiss(id),
  /** Wrapper para promesas: muestra loading → success/error automático */
  promise: sonnerToast.promise,
};

export { sonnerToast as toast };
