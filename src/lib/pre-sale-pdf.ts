import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatNumberGs } from "@/lib/format-currency";
import { BRAND, BRAND_TAGLINE, BRAND_CONTACT } from "@/theme/branding";
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

const FS = {
  brandTitle: 16,
  meta: 9,
  label: 8.5,
  body: 10,
  clientName: 11.5,
  table: 9,
  tableHead: 9,
  total: 13,
  totalLabel: 10.5,
  small: 8,
  obs: 8.5,
  tagline: 8.5,
};

const numberToWordsGs = (n: number): string => {
  if (n === 0) return "CERO";
  const u = ["", "UN", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE"];
  const e = ["DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISÉIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE"];
  const d = ["", "", "VEINTI", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
  const c = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];
  const sub1000 = (x: number): string => {
    if (x === 0) return "";
    if (x === 100) return "CIEN";
    const cen = Math.floor(x / 100);
    const r = x % 100;
    let s = cen ? c[cen] : "";
    if (r) {
      if (s) s += " ";
      if (r < 10) s += u[r];
      else if (r < 20) s += e[r - 10];
      else {
        const dd = Math.floor(r / 10);
        const uu = r % 10;
        if (dd === 2) s += uu ? `VEINTI${u[uu].toLowerCase()}`.toUpperCase() : "VEINTE";
        else s += uu ? `${d[dd]} Y ${u[uu]}` : d[dd];
      }
    }
    return s;
  };
  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  let out = "";
  if (millones) out += millones === 1 ? "UN MILLÓN" : `${sub1000(millones)} MILLONES`;
  if (miles) out += `${out ? " " : ""}${miles === 1 ? "MIL" : `${sub1000(miles)} MIL`}`;
  if (resto) out += `${out ? " " : ""}${sub1000(resto)}`;
  return out.trim();
};

/**
 * Carga el logo como HTMLImageElement vía import directo de Vite.
 * Sin fetch, sin FileReader: el bundler resuelve y cachea el asset.
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
 * PDF Pre-Venta / Cotización — branding SANSEI centralizado (src/theme/branding.ts).
 *
 * Ajustes finos vs versión previa:
 * - Espaciado vertical compactado (cliente→tabla, tabla→total).
 * - Bloque TOTAL alineado a la derecha con label y valor en mismo eje, valor en rojo.
 * - "Son guaraníes" pegado al bloque total.
 * - Nombre de cliente jerárquicamente destacado.
 * - Tabla con padding reducido.
 * - Sección "Observaciones" (condiciones comerciales) renderizada como lista neutra.
 * - Logo importado directamente (sin fetch runtime).
 * - "₲" no se renderiza en Helvetica nativa → "Gs." en PDF.
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
  doc.setFontSize(FS.brandTitle);
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

  // ════ CLIENTE (compacto, nombre destacado) ════
  let y = 40;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(FS.label);
  doc.setTextColor(...BRAND.primary);
  doc.text("DATOS DEL CLIENTE", M, y);
  y += 4.5;

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
  y += 5.2;

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
    y += Math.max(4.4, lines.length * 4.4);
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
    startY: y + 2,
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

  // ════ TOTAL (alineado, label+valor mismo eje) ════
  const totalY = finalY + 4;
  const totalRight = W - M;
  const totalValueStr = `Gs. ${formatNumberGs(total)}`;
  const totalLabelStr = "Total estimado:";

  // Línea roja firma
  doc.setDrawColor(...BRAND.primary);
  doc.setLineWidth(0.8);
  doc.line(W - M - 80, totalY, totalRight, totalY);

  const totalRowY = totalY + 6;

  // Valor (rojo, bold) — anclado a la derecha
  doc.setFont("helvetica", "bold");
  doc.setFontSize(FS.total);
  doc.setTextColor(...BRAND.primary);
  doc.text(totalValueStr, totalRight, totalRowY, { align: "right" });
  const valueW = doc.getTextWidth(totalValueStr);

  // Label (muted) — pegado al valor, ambos en mismo eje vertical
  doc.setFont("helvetica", "bold");
  doc.setFontSize(FS.totalLabel);
  doc.setTextColor(...BRAND.muted);
  doc.text(totalLabelStr, totalRight - valueW - 4, totalRowY, { align: "right" });

  // Son guaraníes — pegado al total
  doc.setFont("helvetica", "italic");
  doc.setFontSize(FS.small);
  doc.setTextColor(...BRAND.muted);
  const letras = `Son guaraníes: ${numberToWordsGs(Math.round(total))}.-`;
  const lLines = doc.splitTextToSize(letras, W - M * 2);
  doc.text(lLines, M, totalRowY + 5.5);

  let bottomY = totalRowY + 5.5 + lLines.length * 3.8;

  // ════ OBSERVACIONES / CONDICIONES COMERCIALES ════
  // Reusa el campo `notes` (no se crea campo nuevo). Renderizado como lista neutra.
  if (data.notes && data.notes.trim()) {
    bottomY += 4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(FS.label);
    doc.setTextColor(...BRAND.muted);
    doc.text("OBSERVACIONES", M, bottomY);
    bottomY += 4;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(FS.obs);
    doc.setTextColor(...BRAND.text);
    const lines = data.notes
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    for (const line of lines) {
      const isBullet = /^[-•*]\s?/.test(line);
      const text = isBullet ? line.replace(/^[-•*]\s?/, "") : line;
      const wrapped = doc.splitTextToSize(`•  ${text}`, W - M * 2 - 2);
      doc.text(wrapped, M, bottomY);
      bottomY += wrapped.length * 4;
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
