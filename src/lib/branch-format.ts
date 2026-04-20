/**
 * Helpers de presentación para sucursales / depósitos.
 *
 * Criterio operativo unificado MoviLog:
 *  - El dato PRINCIPAL siempre es `branches.name` (legible para operación).
 *  - `branches.code` se usa SOLO si aporta lectura humana (ej: "LAM", "ENC").
 *  - Códigos puramente numéricos (ej: "5", "12") son IDs internos del ERP y
 *    NO deben mostrarse al usuario operativo. Se ocultan o quedan como tooltip.
 *  - Nunca se muestra el UUID de sucursal en UI.
 */

type BranchLike = {
  name?: string | null;
  code?: string | null;
} | null | undefined;

/** ¿El code es puramente numérico (ID interno del ERP, no humano)? */
export function isInternalCode(code?: string | null): boolean {
  if (!code) return true;
  return /^\d+$/.test(String(code).trim());
}

/**
 * Nombre operativo de una sucursal:
 *  - Si tiene `name` → usa `name`.
 *  - Si no, cae a `code` solo si es humano (no numérico).
 *  - Si nada sirve → "—".
 */
export function branchName(b: BranchLike, fallback = "—"): string {
  if (!b) return fallback;
  if (b.name && b.name.trim()) return b.name.trim();
  if (b.code && !isInternalCode(b.code)) return String(b.code).trim();
  return fallback;
}

/**
 * Etiqueta completa "Nombre · CODE" cuando el code aporta;
 * solo "Nombre" cuando el code es interno/numérico o ausente.
 * Útil para selects o cabeceras donde queremos ambas referencias.
 */
export function branchLabel(b: BranchLike, fallback = "—"): string {
  if (!b) return fallback;
  const name = branchName(b, fallback);
  if (b.code && !isInternalCode(b.code) && b.code !== name) {
    return `${name} · ${b.code}`;
  }
  return name;
}

/** Versión corta para badges / chips: prioriza code humano, sino name. */
export function branchShort(b: BranchLike, fallback = "—"): string {
  if (!b) return fallback;
  if (b.code && !isInternalCode(b.code)) return String(b.code).trim();
  if (b.name && b.name.trim()) return b.name.trim();
  return fallback;
}
