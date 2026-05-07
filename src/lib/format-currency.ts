/**
 * Formato único de moneda PYG para todo MoviLog.
 * - Separador de miles "de-DE" (1.234.567)
 * - Sin decimales
 * - Prefijo ₲
 *
 * USAR EN: listado, detalle, PDF, dashboards comerciales.
 */
export function formatCurrencyGs(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "₲ 0";
  return `₲ ${Math.round(n).toLocaleString("de-DE")}`;
}

/** Versión sin prefijo (para tablas donde el ₲ va en encabezado). */
export function formatNumberGs(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("de-DE");
}
