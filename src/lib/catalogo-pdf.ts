import jsPDF from "jspdf";
import { BRAND, BRAND_TAGLINE, BRAND_CONTACT } from "@/theme/branding";
import { FS, SPACING } from "@/theme/typography";
import { resolvePrice, getScales, ProductRow } from "@/lib/ventas";
import { proxyImageUrl } from "@/lib/image-utils";
import sanseiLogo from "@/assets/sansei-logo.jpg";

/** Productos por archivo PDF (cada parte) con fotos. */
export const CATALOG_PDF_PART_SIZE = 300;
/** Sin fotos el archivo es liviano: entran muchos más por parte. */
export const CATALOG_PDF_PART_SIZE_NO_IMG = 1000;
/** Tamaño de parte según el modo elegido. */
export function catalogPartSize(showImages: boolean): number {
  return showImages ? CATALOG_PDF_PART_SIZE : CATALOG_PDF_PART_SIZE_NO_IMG;
}
/** Descarga/compresión de fotos en paralelo. */
export const CATALOG_IMG_CONCURRENCY = 6;
/** Segundos estimados por producto (medido en preview). */
export const CATALOG_SEC_PER_ITEM_WITH_IMG = 0.35;
export const CATALOG_SEC_PER_ITEM_NO_IMG = 0.01;
/** A partir de acá conviene sugerir el modo sin fotos. */
export const CATALOG_SUGGEST_NO_IMG_FROM = 500;
/** A partir de acá pedimos confirmación explícita si hay fotos. */
export const CATALOG_CONFIRM_HEAVY_FROM = 2000;

const PAGE = { W: 210, H: 297, M: 16 } as const;
const FOOTER_RESERVED = SPACING.xl * 2 + SPACING.md; // ~34mm
const GRID_COLS = 3;
const GRID_GAP = SPACING.md;
const IMG_BOX = 44; // mm
const CARD_TEXT_H = 30; // mm reservados para textos
const CARD_H = IMG_BOX + CARD_TEXT_H;

export type CatalogSort = "category" | "name" | "price";

export interface CatalogCustomer {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  ruc?: string | null;
  priceListId?: string | null;
}

export interface CatalogPdfOptions {
  products: ProductRow[];
  customer?: CatalogCustomer | null;
  salespersonName?: string | null;
  showPrices: boolean;
  showScales: boolean;
  sortBy: CatalogSort;
  note?: string | null;
  /** Incluir fotos de producto (false = lista compacta, mucho más liviana) */
  showImages?: boolean;
  /** Ej.: "Parte 1 de 2" — se imprime en portada y pie */
  partLabel?: string | null;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  /** Identificador único por generación para evitar cachés viejas del PWA. */
  imageRequestId?: string;
}

export class CatalogAbortError extends Error {
  constructor() {
    super("cancelado");
    this.name = "CatalogAbortError";
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CatalogAbortError();
}

/* ───────────────── imágenes ───────────────── */

const IMG_MAX_PX = 320;
const imgCache = new Map<string, string>();

export type CatalogImageFailureStage = "fetch" | "http" | "mime" | "signature" | "decode" | "canvas";
export interface CatalogImageFailure {
  productId: string;
  code: string;
  stage: CatalogImageFailureStage;
  detail: string;
}
export interface CatalogImageReport {
  ready: number;
  missingSource: number;
  failed: CatalogImageFailure[];
}

let lastImageReport: CatalogImageReport = { ready: 0, missingSource: 0, failed: [] };

function placeholderDataUrl(label: string): string {
  const c = document.createElement("canvas");
  c.width = IMG_MAX_PX;
  c.height = IMG_MAX_PX;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#f3f4f6";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#9ca3af";
  ctx.font = "24px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText((label || "—").slice(0, 14), c.width / 2, c.height / 2);
  return c.toDataURL("image/jpeg", 0.7);
}

export function getCatalogImageFailures(): number {
  return lastImageReport.failed.length;
}
export function getCatalogImageReport(): CatalogImageReport {
  return {
    ready: lastImageReport.ready,
    missingSource: lastImageReport.missingSource,
    failed: [...lastImageReport.failed],
  };
}
export function resetCatalogImageFailures(): void {
  lastImageReport = { ready: 0, missingSource: 0, failed: [] };
}

function drawToJpeg(img: CanvasImageSource & { width: number; height: number }, quality: number): string {
  const ratio = Math.min(IMG_MAX_PX / img.width, IMG_MAX_PX / img.height, 1);
  const w = Math.max(1, Math.round(img.width * ratio));
  const h = Math.max(1, Math.round(img.height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  try {
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    throw new CatalogImagePipelineError("canvas", "canvas-export");
  }
}

class CatalogImagePipelineError extends Error {
  constructor(public readonly stage: CatalogImageFailureStage, detail: string) {
    super(detail);
    this.name = "CatalogImagePipelineError";
  }
}

export class CatalogImageQualityError extends Error {
  constructor(public readonly report: CatalogImageReport) {
    super(`${report.failed.length} fotos no pudieron prepararse`);
    this.name = "CatalogImageQualityError";
  }
}

async function hasImageSignature(blob: Blob): Promise<boolean> {
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const gif = bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46;
  const webp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  return jpeg || png || gif || webp;
}

function decodeBlobFallback(blob: Blob): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => {
      try {
        // Dibujamos antes de revocar: Safari puede liberar los bytes al revocar.
        const data = drawToJpeg(el, 0.72);
        URL.revokeObjectURL(objectUrl);
        const decoded = new Image();
        decoded.onload = () => resolve(decoded);
        decoded.onerror = () => reject(new CatalogImagePipelineError("decode", "data-url-decode"));
        decoded.src = data;
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        reject(error);
      }
    };
    el.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new CatalogImagePipelineError("decode", "blob-decode"));
    };
    el.src = objectUrl;
  });
}

/**
 * Descarga la foto por fetch (CORS explícito) y la decodifica desde un blob local.
 * Evita el canvas "contaminado" y las respuestas opacas cacheadas por el service worker.
 */
async function loadImage(url: string, quality: number, timeoutMs: number): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // cache: "reload" obliga a revalidar y evita respuestas opacas que hayan
    // quedado en instalaciones anteriores del PWA con la misma URL.
    let res: Response;
    try {
      res = await fetch(url, {
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      signal: ctrl.signal,
      });
    } catch (error) {
      throw new CatalogImagePipelineError("fetch", error instanceof Error ? error.name : "network");
    }
    if (!res.ok) throw new CatalogImagePipelineError("http", String(res.status));
    const blob = await res.blob();
    if (!blob.size) throw new CatalogImagePipelineError("mime", "empty");
    if (!blob.type.toLowerCase().startsWith("image/")) {
      throw new CatalogImagePipelineError("mime", blob.type || "unknown");
    }
    if (!(await hasImageSignature(blob))) {
      throw new CatalogImagePipelineError("signature", "unsupported-or-invalid");
    }
    if (typeof createImageBitmap === "function") {
      try {
        const bitmap = await createImageBitmap(blob);
        const data = drawToJpeg(bitmap, quality);
        bitmap.close();
        return data;
      } catch (error) {
        if (error instanceof CatalogImagePipelineError) throw error;
        throw new CatalogImagePipelineError("decode", "image-bitmap");
      }
    }
    const img = await decodeBlobFallback(blob);
    return drawToJpeg(img, quality);
  } finally {
    clearTimeout(t);
  }
}

async function getImage(
  url: string | null | undefined,
  label: string,
  imageRequestId?: string,
  failureContext?: { productId: string; code: string },
): Promise<string> {
  if (!url) return placeholderDataUrl(label);
  // Los catálogos deben pedir una copia fresca por generación. Esto evita que
  // instalaciones antiguas del PWA entreguen respuestas opacas ya cacheadas.
  const src = proxyImageUrl(url, imageRequestId, "pdf");
  const hit = imgCache.get(src);
  if (hit) return hit;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await loadImage(src, 0.7, 10000);
      imgCache.set(src, data); // solo cacheamos éxitos
      return data;
    } catch (error) {
      if (attempt === 1 && failureContext) {
        const pipelineError = error instanceof CatalogImagePipelineError
          ? error
          : new CatalogImagePipelineError("fetch", "unknown");
        lastImageReport.failed.push({
          ...failureContext,
          stage: pipelineError.stage,
          detail: pipelineError.message,
        });
      }
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  return placeholderDataUrl(label);
}


/**
 * Precarga las fotos en paralelo (workers) llenando el cache.
 * Reporta progreso y respeta cancelación.
 */
export async function prefetchCatalogImages(
  products: ProductRow[],
  opts: {
    concurrency?: number;
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
    imageRequestId?: string;
  } = {}
): Promise<CatalogImageReport> {
  const mobileConcurrency = typeof navigator !== "undefined" && /Android|iPhone|iPad/i.test(navigator.userAgent) ? 3 : CATALOG_IMG_CONCURRENCY;
  const { concurrency = mobileConcurrency, signal, onProgress, imageRequestId } = opts;
  const total = products.length;
  let next = 0;
  let done = 0;
  lastImageReport = {
    ready: 0,
    missingSource: products.filter((product) => !product.image_url).length,
    failed: [],
  };

  const worker = async () => {
    while (next < total) {
      if (signal?.aborted) return;
      const p = products[next++];
      if (p.image_url) {
        await getImage(p.image_url, p.bims_code ?? "", imageRequestId, {
          productId: p.id,
          code: p.bims_code ?? "",
        });
        if (!lastImageReport.failed.some((failure) => failure.productId === p.id)) {
          lastImageReport.ready++;
        }
      }
      done++;
      onProgress?.(done, total);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, total)) }, worker)
  );
  throwIfAborted(signal);
  return getCatalogImageReport();
}

/* ───────────────── helpers de dibujo ───────────────── */

function fmtGs(n: number): string {
  return `Gs. ${Math.round(n).toLocaleString("de-DE")}`;
}

function drawFooter(doc: jsPDF, partLabel?: string | null): void {
  const pages = doc.getNumberOfPages();
  const lineH = SPACING.sm;
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    const footerTop = PAGE.H - (SPACING.xl * 2 + SPACING.sm);
    doc.setFillColor(...BRAND.primary);
    doc.rect(0, footerTop, PAGE.W, 0.6, "F");

    let yL = footerTop + SPACING.md;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(FS.small);
    doc.setTextColor(...BRAND.ink);
    doc.text(BRAND_CONTACT.phone, PAGE.M, yL);
    yL += lineH;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...BRAND.text);
    doc.text(BRAND_CONTACT.email, PAGE.M, yL);
    yL += lineH;
    doc.text(BRAND_CONTACT.web, PAGE.M, yL);

    let yR = footerTop + SPACING.md;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(FS.tagline);
    doc.setTextColor(...BRAND.muted);
    doc.text(BRAND_TAGLINE, PAGE.W - PAGE.M, yR, { align: "right" });
    yR += lineH;
    doc.setFont("helvetica", "normal");
    doc.text(BRAND_CONTACT.city, PAGE.W - PAGE.M, yR, { align: "right" });

    const yLegal = PAGE.H - SPACING.md;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(FS.small - 1);
    doc.setTextColor(...BRAND.muted);
    doc.text("Documento no fiscal. Precios y disponibilidad sujetos a cambio.", PAGE.M, yLegal);
    const pageTxt = partLabel ? `${partLabel} · Página ${p} de ${pages}` : `Página ${p} de ${pages}`;
    doc.text(pageTxt, PAGE.W - PAGE.M, yLegal, { align: "right" });
  }
}

function loadLogo(): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = sanseiLogo;
  });
}

export function sortCatalogProducts(products: ProductRow[], sortBy: CatalogSort, priceListId?: string | null) {
  const arr = [...products];
  if (sortBy === "name") {
    arr.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "es"));
  } else if (sortBy === "price") {
    arr.sort((a, b) => resolvePrice(a, priceListId, 1) - resolvePrice(b, priceListId, 1));
  } else {
    arr.sort((a, b) => {
      const ka = `${a.category ?? "zzz"}|${a.brand ?? ""}|${a.name ?? ""}`;
      const kb = `${b.category ?? "zzz"}|${b.brand ?? ""}|${b.name ?? ""}`;
      return ka.localeCompare(kb, "es");
    });
  }
  return arr;
}

/* ───────────────── generador ───────────────── */

export async function buildCatalogPdf(opts: CatalogPdfOptions): Promise<Blob> {
  const {
    showPrices,
    showScales,
    customer,
    salespersonName,
    note,
    partLabel,
    onProgress,
    signal,
  } = opts;
  const showImages = opts.showImages !== false;
  const priceListId = customer?.priceListId ?? null;
  const products = sortCatalogProducts(opts.products, opts.sortBy, priceListId).slice(
    0,
    catalogPartSize(showImages)
  );

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const { W, M } = PAGE;
  const cellW = (W - M * 2 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS;

  // ═══ Header primera página ═══
  try {
    const logo = await loadLogo();
    const logoH = SPACING.xl - SPACING.xs;
    const logoW = logoH * (logo.width / logo.height);
    doc.addImage(logo, "JPEG", M, M - SPACING.xs, logoW, logoH);
  } catch {
    /* sin logo */
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(FS.title);
  doc.setTextColor(...BRAND.primary);
  doc.text("CATÁLOGO DE PRODUCTOS", W - M, M + SPACING.xs, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(FS.meta);
  doc.setTextColor(...BRAND.muted);
  const fecha = new Date().toLocaleDateString("es-PY", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const headerMeta = [
    `${products.length} productos`,
    partLabel || null,
    fecha,
  ]
    .filter(Boolean)
    .join("    ·    ");
  doc.text(headerMeta, W - M, M + SPACING.md + SPACING.xs, {
    align: "right",
  });

  doc.setFillColor(...BRAND.primary);
  doc.rect(0, 32, W, 1.4, "F");
  doc.setFillColor(...BRAND.secondary);
  doc.rect(0, 33.4, W, 0.4, "F");

  let y = 32 + SPACING.lg;

  if (customer?.name?.trim()) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(FS.label);
    doc.setTextColor(...BRAND.muted);
    doc.text("Preparado para: ", M, y);
    const lblW = doc.getTextWidth("Preparado para: ");
    doc.setFontSize(FS.clientName);
    doc.setTextColor(...BRAND.ink);
    doc.text(customer.name.trim(), M + lblW, y);
    y += SPACING.md;
    const extra = [customer.ruc && `RUC: ${customer.ruc}`, customer.phone, customer.address]
      .filter(Boolean)
      .join("  ·  ");
    if (extra) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(FS.small);
      doc.setTextColor(...BRAND.text);
      doc.text(extra, M, y);
      y += SPACING.md;
    }
  }

  if (salespersonName?.trim()) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(FS.small);
    doc.setTextColor(...BRAND.muted);
    doc.text(`Asesor de ventas: ${salespersonName.trim()}`, M, y);
    y += SPACING.md;
  }

  if (note?.trim()) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(FS.small);
    doc.setTextColor(...BRAND.text);
    const lines = doc.splitTextToSize(note.trim(), W - M * 2);
    doc.text(lines, M, y);
    y += lines.length * (SPACING.sm + 0.4) + SPACING.xs;
  }

  y += SPACING.xs;

  // ═══ Lista compacta (sin fotos) ═══
  if (!showImages) {
    const ROW_H = SPACING.md + SPACING.xs;
    for (let i = 0; i < products.length; i++) {
      throwIfAborted(signal);
      const p = products[i];
      onProgress?.(i + 1, products.length);

      if (y + ROW_H > PAGE.H - FOOTER_RESERVED) {
        doc.addPage();
        y = M;
      }

      if (i % 2 === 1) {
        doc.setFillColor(246, 247, 249);
        doc.rect(M, y - SPACING.xs, W - M * 2, ROW_H, "F");
      }

      const priceTxt = showPrices ? fmtGs(resolvePrice(p, priceListId, 1)) : "";
      doc.setFont("helvetica", "bold");
      doc.setFontSize(FS.small);
      const priceW = priceTxt ? doc.getTextWidth(priceTxt) + SPACING.sm : 0;

      doc.setTextColor(...BRAND.ink);
      const nameTxt =
        doc.splitTextToSize(p.name ?? "", W - M * 2 - priceW - 2)[0] ?? "";
      doc.text(nameTxt, M, y + SPACING.xs);

      if (priceTxt) {
        doc.setTextColor(...BRAND.primary);
        doc.text(priceTxt, W - M, y + SPACING.xs, { align: "right" });
      }

      doc.setFont("helvetica", "normal");
      doc.setFontSize(FS.small - 2);
      doc.setTextColor(...BRAND.muted);
      const scales =
        showPrices && showScales
          ? getScales(p)
              .filter((s) => s.min_quantity > 1)
              .slice(0, 2)
              .map((s) => `${s.min_quantity}+ ${fmtGs(s.price)}`)
              .join("   ")
          : "";
      const sub = [
        `Cód. ${p.bims_code ?? "—"}`,
        [p.brand, p.category].filter(Boolean).join(" · ") || null,
        scales || null,
      ]
        .filter(Boolean)
        .join("  ·  ");
      doc.text(
        doc.splitTextToSize(sub, W - M * 2)[0] ?? "",
        M,
        y + SPACING.xs + SPACING.sm - 1
      );

      doc.setDrawColor(...BRAND.line);
      doc.setLineWidth(0.1);
      doc.line(M, y + ROW_H - SPACING.xs, W - M, y + ROW_H - SPACING.xs);

      y += ROW_H;
    }

    drawFooter(doc, partLabel);
    return doc.output("blob");
  }

  // ═══ Grilla de productos ═══
  let col = 0;

  for (let i = 0; i < products.length; i++) {
    throwIfAborted(signal);
    const p = products[i];
    const img = await getImage(p.image_url, p.bims_code ?? "", opts.imageRequestId);
    onProgress?.(i + 1, products.length);

    if (col === 0 && y + CARD_H > PAGE.H - FOOTER_RESERVED) {
      doc.addPage();
      y = M;
    }

    const x = M + col * (cellW + GRID_GAP);

    // marco
    doc.setDrawColor(...BRAND.line);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, y, cellW, CARD_H, 1.5, 1.5, "S");

    // imagen centrada dentro del box
    try {
      const props = doc.getImageProperties(img);
      const boxW = cellW - SPACING.sm;
      const boxH = IMG_BOX - SPACING.sm;
      const ratio = Math.min(boxW / props.width, boxH / props.height);
      const w = props.width * ratio;
      const h = props.height * ratio;
      doc.addImage(
        img,
        "JPEG",
        x + (cellW - w) / 2,
        y + SPACING.xs + (boxH - h) / 2,
        w,
        h
      );
    } catch {
      /* imagen inválida: se omite */
    }

    let ty = y + IMG_BOX + SPACING.xs;

    // marca / categoría
    doc.setFont("helvetica", "normal");
    doc.setFontSize(FS.small - 2);
    doc.setTextColor(...BRAND.muted);
    const meta = [p.brand, p.category].filter(Boolean).join(" · ") || " ";
    doc.text(doc.splitTextToSize(meta, cellW - SPACING.sm)[0] ?? " ", x + SPACING.xs, ty);
    ty += SPACING.sm - 0.5;

    // nombre (máx 2 líneas)
    doc.setFont("helvetica", "bold");
    doc.setFontSize(FS.small);
    doc.setTextColor(...BRAND.ink);
    const nameLines = doc.splitTextToSize(p.name ?? "", cellW - SPACING.sm).slice(0, 2);
    doc.text(nameLines, x + SPACING.xs, ty);
    ty += nameLines.length * (SPACING.sm - 0.5) + 0.5;

    // código
    doc.setFont("helvetica", "normal");
    doc.setFontSize(FS.small - 2);
    doc.setTextColor(...BRAND.muted);
    doc.text(`Cód. ${p.bims_code ?? "—"}${p.unit ? ` · ${p.unit}` : ""}`, x + SPACING.xs, ty);
    ty += SPACING.sm - 0.5;

    if (showPrices) {
      const price = resolvePrice(p, priceListId, 1);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(FS.body);
      doc.setTextColor(...BRAND.primary);
      doc.text(fmtGs(price), x + SPACING.xs, ty);
      ty += SPACING.sm;

      if (showScales) {
        const scales = getScales(p).filter((s) => s.min_quantity > 1).slice(0, 2);
        if (scales.length) {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(FS.small - 2);
          doc.setTextColor(...BRAND.text);
          const txt = scales.map((s) => `${s.min_quantity}+ ${fmtGs(s.price)}`).join("   ");
          doc.text(doc.splitTextToSize(txt, cellW - SPACING.sm)[0] ?? "", x + SPACING.xs, ty);
        }
      }
    }

    col++;
    if (col === GRID_COLS) {
      col = 0;
      y += CARD_H + GRID_GAP;
    }
  }

  drawFooter(doc, partLabel);
  return doc.output("blob");
}

export interface CatalogPart {
  blob: Blob;
  fileName: string;
  partIndex: number;
  partCount: number;
  count: number;
}

/** Divide la selección en archivos de hasta CATALOG_PDF_PART_SIZE productos (sin tope global). */
export async function buildCatalogPdfParts(
  opts: Omit<CatalogPdfOptions, "partLabel"> & {
    /** Se llama apenas cada archivo está listo (entrega incremental). */
    onPart?: (part: CatalogPart) => void | Promise<void>;
  }
): Promise<CatalogPart[]> {
  const priceListId = opts.customer?.priceListId ?? null;
  const showImages = opts.showImages !== false;
  const all = sortCatalogProducts(opts.products, opts.sortBy, priceListId);
  const partSize = catalogPartSize(showImages);
  const chunks: ProductRow[][] = [];
  for (let i = 0; i < all.length; i += partSize) {
    chunks.push(all.slice(i, i + partSize));
  }
  const total = all.length;
  const partCount = Math.max(1, chunks.length);
  const parts: CatalogPart[] = [];
  let done = 0;
  const imageRequestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  for (let i = 0; i < chunks.length; i++) {
    throwIfAborted(opts.signal);
    const partIndex = i + 1;
    const label = partCount > 1 ? `Parte ${partIndex} de ${partCount}` : null;
    const base = done;

    if (showImages) {
      // Fotos en paralelo: llena el cache antes de dibujar.
      await prefetchCatalogImages(chunks[i], {
        signal: opts.signal,
        imageRequestId,
        onProgress: (d) => opts.onProgress?.(base + d, total),
      });
    }

    const blob = await buildCatalogPdf({
      ...opts,
      products: chunks[i],
      partLabel: label,
      imageRequestId,
      onProgress: showImages ? undefined : (d) => opts.onProgress?.(base + d, total),
    });
    done += chunks[i].length;
    opts.onProgress?.(done, total);
    const part: CatalogPart = {
      blob,
      fileName: catalogFileName(opts.customer?.name, partCount > 1 ? partIndex : undefined),
      partIndex,
      partCount,
      count: chunks[i].length,
    };
    parts.push(part);
    await opts.onPart?.(part);
  }
  return parts;
}

export function catalogFileName(customerName?: string | null, part?: number): string {
  const slug = (customerName ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  const date = new Date().toISOString().slice(0, 10);
  const suffix = part ? `-parte${part}` : "";
  return `catalogo-sansei${slug ? `-${slug}` : ""}-${date}${suffix}.pdf`;
}
