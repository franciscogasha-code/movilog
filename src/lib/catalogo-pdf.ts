import jsPDF from "jspdf";
import { BRAND, BRAND_TAGLINE, BRAND_CONTACT } from "@/theme/branding";
import { FS, SPACING } from "@/theme/typography";
import { resolvePrice, getScales, ProductRow } from "@/lib/ventas";
import { proxyImageUrl } from "@/lib/image-utils";
import sanseiLogo from "@/assets/sansei-logo.jpg";

/** Máximo de productos por catálogo (tope de seguridad). */
export const CATALOG_PDF_MAX_ITEMS = 300;

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
  onProgress?: (done: number, total: number) => void;
}

/* ───────────────── imágenes ───────────────── */

const IMG_MAX_PX = 320;
const imgCache = new Map<string, string>();

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

function loadImage(url: string, quality: number, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const t = setTimeout(() => {
      img.src = "";
      reject(new Error("timeout"));
    }, timeoutMs);
    img.onload = () => {
      clearTimeout(t);
      try {
        const ratio = Math.min(IMG_MAX_PX / img.width, IMG_MAX_PX / img.height, 1);
        const w = Math.max(1, Math.round(img.width * ratio));
        const h = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => {
      clearTimeout(t);
      reject(new Error("load-error"));
    };
    img.src = url;
  });
}

async function getImage(url: string | null | undefined, label: string): Promise<string> {
  if (!url) return placeholderDataUrl(label);
  const src = proxyImageUrl(url);
  const hit = imgCache.get(src);
  if (hit) return hit;
  try {
    const data = await loadImage(src, 0.7, 5000);
    imgCache.set(src, data);
    return data;
  } catch {
    const ph = placeholderDataUrl(label);
    imgCache.set(src, ph);
    return ph;
  }
}

/* ───────────────── helpers de dibujo ───────────────── */

function fmtGs(n: number): string {
  return `Gs. ${Math.round(n).toLocaleString("de-DE")}`;
}

function drawFooter(doc: jsPDF): void {
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
    doc.text(`Página ${p} de ${pages}`, PAGE.W - PAGE.M, yLegal, { align: "right" });
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

function sortProducts(products: ProductRow[], sortBy: CatalogSort, priceListId?: string | null) {
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
  const { showPrices, showScales, customer, salespersonName, note, onProgress } = opts;
  const priceListId = customer?.priceListId ?? null;
  const products = sortProducts(opts.products, opts.sortBy, priceListId).slice(
    0,
    CATALOG_PDF_MAX_ITEMS
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
  doc.text(`${products.length} productos    ·    ${fecha}`, W - M, M + SPACING.md + SPACING.xs, {
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

  // ═══ Grilla de productos ═══
  let col = 0;

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const img = await getImage(p.image_url, p.bims_code ?? "");
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

  drawFooter(doc);
  return doc.output("blob");
}

export function catalogFileName(customerName?: string | null): string {
  const slug = (customerName ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  const date = new Date().toISOString().slice(0, 10);
  return `catalogo-sansei${slug ? `-${slug}` : ""}-${date}.pdf`;
}
