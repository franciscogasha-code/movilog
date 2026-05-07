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

const numberToWordsGs = (n: number): string => {
  // Conversor simple español PY (hasta millones).
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
 * PDF Pre-Venta / Cotización — formato comercial profesional.
 * Inspirado en plantilla BIMS: encabezado con N°, datos cliente,
 * tabla con subtotales, total destacado y monto en letras.
 *
 * No incluye canal ni datos logísticos internos.
 */
export async function generatePreSalePdf(data: PreSaleData): Promise<void> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210;
  const M = 14;

  // ── Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(80);
  doc.text(
    new Date(data.created_at).toLocaleString("es-PY", {
      day: "2-digit", month: "long", year: "numeric",
    }),
    W - M, 14, { align: "right" },
  );

  doc.setFontSize(20);
  doc.setTextColor(20);
  doc.text("PRE-VENTA / COTIZACIÓN", M, 22);

  doc.setFontSize(13);
  doc.setTextColor(60);
  doc.text(`N° ${data.request_number}`, W - M, 22, { align: "right" });

  doc.setDrawColor(220);
  doc.setLineWidth(0.3);
  doc.line(M, 26, W - M, 26);

  // ── Cliente
  let y = 34;
  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text("Cliente", M, y);
  doc.text("Teléfono", M + 105, y);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(20);
  doc.setFontSize(11);
  doc.text(data.client_name || "—", M, y + 5);
  doc.text(data.client_phone || "—", M + 105, y + 5);

  y += 11;
  if (data.client_email || data.client_address) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(80);
    if (data.client_email) {
      doc.text(`Email: ${data.client_email}`, M, y);
      y += 5;
    }
    if (data.client_address) {
      const lines = doc.splitTextToSize(`Dirección: ${data.client_address}`, W - M * 2);
      doc.text(lines, M, y);
      y += lines.length * 5;
    }
  }

  // ── Tabla productos
  const total = data.items.reduce(
    (acc, it) => acc + Number(it.product.sell_price ?? 0) * Number(it.quantity_requested),
    0,
  );

  autoTable(doc, {
    startY: y + 4,
    head: [["N°", "Código", "Descripción", "Cant.", "Precio Unit.", "Subtotal"]],
    body: data.items.map((it, i) => {
      const price = Number(it.product.sell_price ?? 0);
      const qty = Number(it.quantity_requested);
      return [
        String(i + 1),
        it.product.bims_code || it.product.sku || "—",
        it.product.name,
        formatNumberGs(qty),
        price ? formatNumberGs(price) : "—",
        price ? formatNumberGs(price * qty) : "—",
      ];
    }),
    styles: { fontSize: 9, cellPadding: 2.2, valign: "middle", textColor: 30 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold", halign: "center" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: 30 },
      2: { cellWidth: "auto" },
      3: { cellWidth: 16, halign: "right" },
      4: { cellWidth: 26, halign: "right" },
      5: { cellWidth: 28, halign: "right", fontStyle: "bold" },
    },
    margin: { left: M, right: M },
  });

  const finalY = (doc as any).lastAutoTable?.finalY ?? y + 60;

  // ── Total
  const totalY = finalY + 6;
  doc.setDrawColor(30, 41, 59);
  doc.setLineWidth(0.5);
  doc.line(W - M - 80, totalY, W - M, totalY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(20);
  doc.text("TOTAL ESTIMADO", W - M - 80, totalY + 7);
  doc.setFontSize(14);
  doc.text(`₲ ${formatNumberGs(total)}`, W - M, totalY + 7, { align: "right" });

  // Monto en letras
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.setTextColor(90);
  const letras = `Son guaraníes: ${numberToWordsGs(Math.round(total))}.-`;
  const lLines = doc.splitTextToSize(letras, W - M * 2);
  doc.text(lLines, M, totalY + 16);

  // Notas
  let bottomY = totalY + 16 + lLines.length * 5;
  if (data.notes) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(60);
    const ns = doc.splitTextToSize(`Notas: ${data.notes}`, W - M * 2);
    doc.text(ns, M, bottomY + 4);
    bottomY += 4 + ns.length * 5;
  }

  // Footer
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(140);
  doc.text(
    "Documento no fiscal — Pre-venta sujeta a confirmación de stock y facturación.",
    M, 287,
  );
  doc.text("Generado por MoviLog", W - M, 287, { align: "right" });

  doc.save(`pre-venta-${data.request_number}.pdf`);
}
