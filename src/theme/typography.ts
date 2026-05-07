/**
 * Sistema tipográfico — fuente única de verdad para tamaños de fuente en PDFs.
 * NO usar en UI web (la UI web usa tokens de Tailwind).
 */
export const FS = {
  title: 14,
  subtitle: 12,
  body: 10,
  small: 9,
  table: 9,
  tableHead: 10,
  total: 12,
  totalLabel: 10,
  label: 9,
  clientName: 12,
  tagline: 9,
  obs: 9,
  meta: 9,
} as const;

/**
 * Tokens de espaciado vertical/horizontal en mm para layout PDF.
 */
export const SPACING = {
  xs: 2,
  sm: 4,
  md: 6,
  lg: 10,
  xl: 14,
} as const;
