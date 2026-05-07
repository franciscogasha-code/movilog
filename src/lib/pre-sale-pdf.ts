import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatNumberGs } from "@/lib/format-currency";

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

/* ──────────────────────────────────────────────────────────────
 * Sistema tipográfico único (en pt — jsPDF usa pt internamente)
 * Equivalencias aprox. al spec en px:
 *   14px ≈ 11pt  · 12px ≈ 9pt  · 11px ≈ 8.5pt  · 13px ≈ 10pt
 * ────────────────────────────────────────────────────────────── */
const FS = {
  title: 14,      // PRE-VENTA / COTIZACIÓN
  meta: 10,       // N°, Fecha
  label: 9,       // "Cliente:", "Teléfono:" ...
  body: 10,       // valores cliente
  table: 9,       // cuerpo tabla
  tableHead: 9,   // encabezado tabla
  total: 11,      // total bold
  small: 8,       // notas / footer
};

const COLOR = {
  text: 25,
  muted: 100,
  line: 200,
  headBg: [30, 41, 59] as [number, number, number],
  rowAlt: [248, 250, 252] as [number, number, number],
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
 * PDF Pre-Venta / Cotización — diseño comercial profesional.
 * Layout compacto, alineado a la izquierda, jerarquía tipográfica única.
 */
export async function generatePreSalePdf(data: PreSaleData): Promise<void> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210;
  const M = 16;

  // ── 1. HEADER (bloque compacto, todo a la izquierda)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(FS.title);
  doc.setTextColor(COLOR.text);
  doc.text("PRE-VENTA / COTIZACIÓN", M, 20);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(FS.meta);
  doc.setTextColor(COLOR.muted);
  doc.text(`N° ${data.request_number}`, M, 26);
  const fecha = new Date(data.created_at).toLocaleDateString("es-PY", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
  doc.text(`Fecha: ${fecha}`, M, 31);

  // separador sutil
  doc.setDrawColor(COLOR.line);
  doc.setLineWidth(0.2);
  doc.line(M, 35, W - M, 35);

  // ── 2. CLIENTE (vertical, una sola columna)
  let y = 42;
  const drawField = (label: string, value: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(FS.label);
    doc.setTextColor(COLOR.muted);
    const lbl = `${label}: `;
    doc.text(lbl, M, y);
    const lblW = doc.getTextWidth(lbl);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(FS.body);
    doc.setTextColor(COLOR.text);
    const lines = doc.splitTextToSize(value || "—", W - M * 2 - lblW);
    doc.text(lines, M + lblW, y);
    y += Math.max(5, lines.length * 4.5);
  };

  drawField("Cliente", data.client_name);
  drawField("Teléfono", data.client_phone || "—");
  if (data.client_email) drawField("Email", data.client_email);
  if (data.client_address) drawField("Dirección", data.client_address);

  // ── 3. TABLA PRODUCTOS
  const total = data.items.reduce(
    (acc, it) => acc + Number(it.product.sell_price ?? 0) * Number(it.quantity_requested),
    0,
  );

  autoTable(doc, {
    startY: y + 4,
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
      cellPadding: { top: 2.5, right: 3, bottom: 2.5, left: 3 },
      valign: "middle",
      textColor: COLOR.text,
      lineColor: COLOR.line,
      lineWidth: 0.1,
    },
    headStyles: {
      fillColor: COLOR.headBg,
      textColor: 255,
      fontStyle: "bold",
      fontSize: FS.tableHead,
      halign: "left",
    },
    alternateRowStyles: { fillColor: COLOR.rowAlt },
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

  // ── 4. TOTAL (alineado a la derecha, label + valor en el mismo eje)
  // NOTA: el símbolo "₲" (U+20B2) NO existe en la codificación WinAnsi de
  // Helvetica nativa de jsPDF y se renderiza como un glifo corrupto (parece
  // un "2"). Usamos "Gs." que es estándar comercial PY y 100% soportado.
  const totalY = finalY + 6;
  const totalRight = W - M;
  const totalValueStr = `Gs. ${formatNumberGs(total)}`;
  const totalLabelStr = "Total estimado:";

  doc.setFont("helvetica", "bold");
  doc.setFontSize(FS.total);
  const valueW = doc.getTextWidth(totalValueStr);
  const labelW = doc.getTextWidth(totalLabelStr);
  const blockLeft = totalRight - valueW - 6 - labelW;

  doc.setDrawColor(60);
  doc.setLineWidth(0.4);
  doc.line(blockLeft, totalY, totalRight, totalY);

  doc.setTextColor(COLOR.text);
  doc.text(totalLabelStr, blockLeft, totalY + 6);
  doc.text(totalValueStr, totalRight, totalY + 6, { align: "right" });

  // Monto en letras
  doc.setFont("helvetica", "italic");
  doc.setFontSize(FS.small);
  doc.setTextColor(COLOR.muted);
  const letras = `Son guaraníes: ${numberToWordsGs(Math.round(total))}.-`;
  const lLines = doc.splitTextToSize(letras, W - M * 2);
  doc.text(lLines, M, totalY + 14);

  let bottomY = totalY + 14 + lLines.length * 4;

  // Notas
  if (data.notes) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(FS.small);
    doc.setTextColor(COLOR.muted);
    const ns = doc.splitTextToSize(`Notas: ${data.notes}`, W - M * 2);
    doc.text(ns, M, bottomY + 4);
    bottomY += 4 + ns.length * 4;
  }

  // ── Footer
  doc.setFont("helvetica", "normal");
  doc.setFontSize(FS.small);
  doc.setTextColor(150);
  doc.text(
    "Documento no fiscal — Pre-venta sujeta a confirmación de stock y facturación.",
    M, 287,
  );
  doc.text("Generado por MoviLog", W - M, 287, { align: "right" });

  doc.save(`pre-venta-${data.request_number}.pdf`);
}
