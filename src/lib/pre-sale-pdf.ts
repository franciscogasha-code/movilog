import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatNumberGs } from "@/lib/format-currency";
import { numberToWordsGs } from "@/lib/number-to-words";
import { BRAND, BRAND_TAGLINE, BRAND_CONTACT } from "@/theme/branding";
import { FS, SPACING } from "@/theme/typography";
import sanseiLogo from "@/assets/sansei-logo.jpg";

interface PreSaleItem {
  product: { name: string; bims_code?: string | null; sku?: string | null; sell_price?: number | null };
  quantity_requested: number;
}

interface PreSaleData {
  request_number: number;
  client_name: string;
  client_phone?: string | null;
  client_email?: string | null;
  client_address?: string | null;
  notes?: string | null;
  created_at: string;
  items: PreSaleItem[];
}

// Layout constants — derivados de SPACING/FS, sin magic numbers visuales.
const PAGE = { W: 210, H: 297, M: 16 } as const;
const HEADER_BAND_Y = 32;
const HEADER_BAND_H_PRIMARY = 1.4;
const HEADER_BAND_H_SECONDARY = 0.4;
const FOOTER_RESERVED = SPACING.xl * 2 + SPACING.md; // ~34mm reservado para footer
const LINE_HEIGHT_BODY = SPACING.sm + 0.4; // interlineado consistente
const TOTAL_LINE_W = 80;
const TOTAL_LINE_THICKNESS = 0.8;

function loadLogoImage(): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = sanseiLogo;
  });
}

/**
 * Render "label valor" alineado a la derecha con baseline común.
 * Sin offsets mágicos: la separación es exclusivamente SPACING.sm.
 */
function drawRightAlignedPair(
  doc: jsPDF,
  label: string,
  value: string,
  x: number,
  y: number,
  opts: { labelColor: [number, number, number]; valueColor: [number, number, number]; size: number },
): void {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(opts.size);

  doc.setTextColor(...opts.valueColor);
  doc.text(value, x, y, { align: "right", baseline: "alphabetic" });
  const valueW = doc.getTextWidth(value);

  doc.setTextColor(...opts.labelColor);
  doc.text(label, x - valueW - SPACING.sm, y, { align: "right", baseline: "alphabetic" });
}

/**
 * Garantiza espacio vertical o agrega página nueva.
 */
function ensureSpace(doc: jsPDF, currentY: number, needed: number): number {
  if (currentY + needed > PAGE.H - FOOTER_RESERVED) {
    doc.addPage();
    return PAGE.M + SPACING.md;
  }
  return currentY;
}

/**
 * Footer institucional aplicado a todas las páginas.
 */
function drawFooter(doc: jsPDF): void {
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFillColor(...BRAND.primary);
    doc.rect(0, PAGE.H - SPACING.xl - SPACING.md, PAGE.W, 0.6, "F");

    doc.setFont("helvetica", "bolditalic");
    doc.setFontSize(FS.tagline);
    doc.setTextColor(...BRAND.muted);
    doc.text(BRAND_TAGLINE, PAGE.M, PAGE.H - SPACING.xl);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(FS.small);
    doc.setTextColor(...BRAND.muted);
    doc.text(
      `${BRAND_CONTACT.web}  ·  ${BRAND_CONTACT.phone}  ·  ${BRAND_CONTACT.email}`,
      PAGE.M,
      PAGE.H - SPACING.lg,
    );
    doc.text(BRAND_CONTACT.city, PAGE.M, PAGE.H - SPACING.md);

    doc.text(
      "Documento no fiscal — Pre-venta sujeta a confirmación de stock y facturación.",
      PAGE.W - PAGE.M,
      PAGE.H - SPACING.lg,
      { align: "right" },
    );
    doc.text(`Página ${p} de ${pages}  ·  Generado por MoviLog`, PAGE.W - PAGE.M, PAGE.H - SPACING.md, {
      align: "right",
    });
  }
}

export async function generatePreSalePdf(data: PreSaleData): Promise<void> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const { W, M } = PAGE;

  // ════ HEADER ════
  const logoImg = await loadLogoImage();
  const logoH = SPACING.xl - SPACING.xs; // 12mm
  const logoW = logoH * (logoImg.width / logoImg.height);
  doc.addImage(logoImg, "JPEG", M, M - SPACING.xs, logoW, logoH);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(FS.title);
  doc.setTextColor(...BRAND.primary);
  doc.text("PRE-VENTA / COTIZACIÓN", W - M, M + SPACING.xs, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(FS.meta);
  doc.setTextColor(...BRAND.muted);
  const fecha = new Date(data.created_at).toLocaleDateString("es-PY", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  doc.text(`N° ${data.request_number}    ·    Fecha: ${fecha}`, W - M, M + SPACING.md + SPACING.xs, {
    align: "right",
  });

  doc.setFillColor(...BRAND.primary);
  doc.rect(0, HEADER_BAND_Y, W, HEADER_BAND_H_PRIMARY, "F");
  doc.setFillColor(...BRAND.secondary);
  doc.rect(0, HEADER_BAND_Y + HEADER_BAND_H_PRIMARY, W, HEADER_BAND_H_SECONDARY, "F");

  // ════ CLIENTE ════
  let y = HEADER_BAND_Y + SPACING.lg;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(FS.label);
  doc.setTextColor(...BRAND.primary);
  doc.text("DATOS DEL CLIENTE", M, y);
  y += SPACING.sm;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(FS.label);
  doc.setTextColor(...BRAND.muted);
  const lblCli = "Cliente: ";
  doc.text(lblCli, M, y);
  const lblCliW = doc.getTextWidth(lblCli);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(FS.clientName);
  doc.setTextColor(...BRAND.ink);
  doc.text(data.client_name || "—", M + lblCliW, y);
  y += SPACING.md;

  const drawField = (label: string, value: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(FS.label);
    doc.setTextColor(...BRAND.muted);
    const lbl = `${label}: `;
    doc.text(lbl, M, y);
    const lblW = doc.getTextWidth(lbl);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(FS.body);
    doc.setTextColor(...BRAND.text);
    const lines = doc.splitTextToSize(value || "—", W - M * 2 - lblW);
    doc.text(lines, M + lblW, y);
    y += Math.max(LINE_HEIGHT_BODY, lines.length * LINE_HEIGHT_BODY);
  };

  drawField("Teléfono", data.client_phone || "—");
  if (data.client_email) drawField("Email", data.client_email);
  if (data.client_address) drawField("Dirección", data.client_address);

  // ════ TABLA ════
  const total = data.items.reduce(
    (acc, it) => acc + Number(it.product.sell_price ?? 0) * Number(it.quantity_requested),
    0,
  );

  autoTable(doc, {
    startY: y + SPACING.xs,
    head: [["N°", "Código", "Producto", "Cant.", "Precio Unit.", "Subtotal"]],
    body: data.items.map((it, idx) => {
      const price = Number(it.product.sell_price ?? 0);
      const qty = Number(it.quantity_requested);
      return [
        String(idx + 1),
        it.product.bims_code || it.product.sku || "—",
        it.product.name,
        formatNumberGs(qty),
        price ? `Gs. ${formatNumberGs(price)}` : "—",
        price ? `Gs. ${formatNumberGs(price * qty)}` : "—",
      ];
    }),
    styles: {
      fontSize: FS.table,
      cellPadding: { top: SPACING.xs, right: SPACING.sm - 1, bottom: SPACING.xs, left: SPACING.sm - 1 },
      valign: "middle",
      textColor: BRAND.text,
      lineColor: BRAND.line,
      lineWidth: 0.1,
    },
    headStyles: {
      fillColor: BRAND.primary,
      textColor: BRAND.white,
      fontStyle: "bold",
      fontSize: FS.tableHead,
      halign: "left",
      lineWidth: 0,
    },
    alternateRowStyles: { fillColor: BRAND.rowAlt },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: 22, halign: "left" },
      2: { cellWidth: "auto", halign: "left" },
      3: { cellWidth: 16, halign: "right" },
      4: { cellWidth: 28, halign: "right" },
      5: { cellWidth: 30, halign: "right", fontStyle: "bold" },
    },
    margin: { left: M, right: M, bottom: FOOTER_RESERVED },
  });

  const finalY = (doc as any).lastAutoTable?.finalY ?? y + SPACING.xl * 4;

  // ════ TOTAL ════
  let totalY = ensureSpace(doc, finalY + SPACING.sm, SPACING.lg + SPACING.md);
  const totalRight = W - M;

  doc.setDrawColor(...BRAND.primary);
  doc.setLineWidth(TOTAL_LINE_THICKNESS);
  doc.line(W - M - TOTAL_LINE_W, totalY, totalRight, totalY);

  const totalRowY = totalY + SPACING.md;

  drawRightAlignedPair(doc, "Total estimado:", `Gs. ${formatNumberGs(total)}`, totalRight, totalRowY, {
    labelColor: BRAND.muted,
    valueColor: BRAND.primary,
    size: FS.total,
  });

  // "Son guaraníes" — espaciado normalizado
  let bottomY = totalRowY + SPACING.md;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(FS.small);
  doc.setTextColor(...BRAND.muted);
  const letras = `Son guaraníes: ${numberToWordsGs(Math.round(total))}.-`;
  const lLines = doc.splitTextToSize(letras, W - M * 2);
  bottomY = ensureSpace(doc, bottomY, lLines.length * LINE_HEIGHT_BODY);
  doc.text(lLines, M, bottomY);
  bottomY += lLines.length * LINE_HEIGHT_BODY;

  // ════ OBSERVACIONES ════
  if (data.notes && data.notes.trim()) {
    bottomY = ensureSpace(doc, bottomY + SPACING.md, SPACING.lg);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(FS.subtitle);
    doc.setTextColor(...BRAND.primary);
    doc.text("Observaciones", M, bottomY);
    bottomY += SPACING.sm + 1;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(FS.body);
    doc.setTextColor(...BRAND.text);
    const bulletIndent = SPACING.sm;
    const lines = data.notes
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    for (const line of lines) {
      const isBullet = /^[-•*]\s?/.test(line);
      const text = isBullet ? line.replace(/^[-•*]\s?/, "") : line;
      const wrapped = doc.splitTextToSize(text, W - M * 2 - bulletIndent);
      bottomY = ensureSpace(doc, bottomY, wrapped.length * LINE_HEIGHT_BODY);
      // Bullet único garantizado: nunca renderiza doble
      doc.text("•", M, bottomY);
      doc.text(wrapped, M + bulletIndent, bottomY);
      bottomY += wrapped.length * LINE_HEIGHT_BODY;
    }
  }

  // ════ FOOTER (todas las páginas) ════
  drawFooter(doc);

  doc.save(`pre-venta-${data.request_number}.pdf`);
}
