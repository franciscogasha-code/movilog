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

/**
 * Carga el logo como HTMLImageElement vía import directo de Vite.
 */
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
 * Render de "label valor" alineado a la derecha como un único string.
 * Elimina dependencia de getTextWidth + offsets manuales.
 */
function drawRightAlignedPair(
  doc: jsPDF,
  label: string,
  value: string,
  x: number,
  y: number,
  opts: { labelColor: [number, number, number]; valueColor: [number, number, number]; size: number },
): void {
  // Para mantener color distinto en label/valor con alineación derecha estable,
  // medimos solo el valor (siempre necesario) y posicionamos el label a su izquierda.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(opts.size);

  doc.setTextColor(...opts.valueColor);
  doc.text(value, x, y, { align: "right" });
  const valueW = doc.getTextWidth(value);

  doc.setTextColor(...opts.labelColor);
  doc.text(label, x - valueW - SPACING.sm, y, { align: "right" });
}

/**
 * PDF Pre-Venta / Cotización — branding SANSEI centralizado.
 * Tipografía y espaciado normalizados desde @/theme/typography.
 */
export async function generatePreSalePdf(data: PreSaleData): Promise<void> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210;
  const H = 297;
  const M = 16;

  // ════ HEADER ════
  const logoImg = await loadLogoImage();
  const logoH = 12;
  const logoW = logoH * (logoImg.width / logoImg.height);
  doc.addImage(logoImg, "JPEG", M, 14, logoW, logoH);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(FS.title);
  doc.setTextColor(...BRAND.primary);
  doc.text("PRE-VENTA / COTIZACIÓN", W - M, 20, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(FS.meta);
  doc.setTextColor(...BRAND.muted);
  const fecha = new Date(data.created_at).toLocaleDateString("es-PY", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
  doc.text(`N° ${data.request_number}    ·    Fecha: ${fecha}`, W - M, 26, { align: "right" });

  doc.setFillColor(...BRAND.primary);
  doc.rect(0, 32, W, 1.4, "F");
  doc.setFillColor(...BRAND.secondary);
  doc.rect(0, 33.4, W, 0.4, "F");

  // ════ CLIENTE ════
  let y = 32 + SPACING.lg;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(FS.label);
  doc.setTextColor(...BRAND.primary);
  doc.text("DATOS DEL CLIENTE", M, y);
  y += SPACING.sm;

  // Nombre cliente con jerarquía
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
    y += Math.max(SPACING.sm + 0.4, lines.length * (SPACING.sm + 0.4));
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
      cellPadding: { top: 2.1, right: 3, bottom: 2.1, left: 3 },
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
    margin: { left: M, right: M },
  });

  const finalY = (doc as any).lastAutoTable?.finalY ?? y + 60;

  // ════ TOTAL ════
  const totalY = finalY + SPACING.sm;
  const totalRight = W - M;

  // Línea roja firma
  doc.setDrawColor(...BRAND.primary);
  doc.setLineWidth(0.8);
  doc.line(W - M - 80, totalY, totalRight, totalY);

  const totalRowY = totalY + SPACING.md;

  drawRightAlignedPair(
    doc,
    "Total estimado:",
    `Gs. ${formatNumberGs(total)}`,
    totalRight,
    totalRowY,
    { labelColor: BRAND.muted, valueColor: BRAND.primary, size: FS.total },
  );

  // Son guaraníes — pegado al total
  doc.setFont("helvetica", "italic");
  doc.setFontSize(FS.small);
  doc.setTextColor(...BRAND.muted);
  const letras = `Son guaraníes: ${numberToWordsGs(Math.round(total))}.-`;
  const lLines = doc.splitTextToSize(letras, W - M * 2);
  doc.text(lLines, M, totalRowY + SPACING.sm + 1.5);

  let bottomY = totalRowY + SPACING.sm + 1.5 + lLines.length * 3.8;

  // ════ OBSERVACIONES ════
  if (data.notes && data.notes.trim()) {
    bottomY += SPACING.md;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(FS.subtitle);
    doc.setTextColor(...BRAND.primary);
    doc.text("Observaciones", M, bottomY);
    bottomY += SPACING.sm + 1;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(FS.obs);
    doc.setTextColor(...BRAND.text);
    const lineHeight = 4.4;
    const bulletIndent = 4;
    const lines = data.notes
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    for (const line of lines) {
      const isBullet = /^[-•*]\s?/.test(line);
      const text = isBullet ? line.replace(/^[-•*]\s?/, "") : line;
      doc.text("•", M, bottomY);
      const wrapped = doc.splitTextToSize(text, W - M * 2 - bulletIndent);
      doc.text(wrapped, M + bulletIndent, bottomY);
      bottomY += wrapped.length * lineHeight;
    }
  }

  // ════ FOOTER ════
  doc.setFillColor(...BRAND.primary);
  doc.rect(0, H - 20, W, 0.6, "F");

  doc.setFont("helvetica", "bolditalic");
  doc.setFontSize(FS.tagline);
  doc.setTextColor(...BRAND.primary);
  doc.text(BRAND_TAGLINE, M, H - 14);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(FS.small);
  doc.setTextColor(...BRAND.muted);
  doc.text(
    `${BRAND_CONTACT.web}  ·  ${BRAND_CONTACT.phone}  ·  ${BRAND_CONTACT.email}`,
    M, H - 9.5,
  );
  doc.text(BRAND_CONTACT.city, M, H - 5.5);

  doc.text(
    "Documento no fiscal — Pre-venta sujeta a confirmación de stock y facturación.",
    W - M, H - 9.5, { align: "right" },
  );
  doc.text("Generado por MoviLog", W - M, H - 5.5, { align: "right" });

  doc.save(`pre-venta-${data.request_number}.pdf`);
}
