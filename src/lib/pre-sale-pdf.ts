import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatNumberGs } from "@/lib/format-currency";
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

/* ──────────────────────────────────────────────────────────────
 * SISTEMA VISUAL SANSEI (branding oficial)
 * Rojo corporativo dominante + paleta extendida (uso sutil).
 * Logo: src/assets/sansei-logo.jpg
 * Tagline: "más que un bazar, un paseo de compras"
 * ────────────────────────────────────────────────────────────── */
const BRAND = {
  red: [227, 6, 19] as [number, number, number],          // #E30613 — primario
  redDark: [176, 0, 14] as [number, number, number],      // hover/acento
  teal: [0, 160, 184] as [number, number, number],
  orange: [243, 146, 0] as [number, number, number],
  ink: [26, 43, 58] as [number, number, number],          // azul muy oscuro casi negro
  text: [33, 37, 41] as [number, number, number],
  muted: [110, 118, 125] as [number, number, number],
  line: [225, 228, 232] as [number, number, number],
  rowAlt: [250, 250, 250] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
};

const FS = {
  brandTitle: 16,  // PRE-VENTA / COTIZACIÓN
  meta: 9,
  label: 8.5,
  body: 10,
  table: 9,
  tableHead: 9,
  total: 12,
  totalLabel: 10,
  small: 8,
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

// Carga el logo importado por Vite y lo convierte a dataURL para jsPDF.
async function loadLogoDataUrl(): Promise<string> {
  const res = await fetch(sanseiLogo);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/**
 * PDF Pre-Venta / Cotización — branding SANSEI integrado como sistema visual.
 *
 * Decisiones de diseño:
 * - Header: logo SANSEI a la izquierda + bloque "PRE-VENTA / COTIZACIÓN" a la
 *   derecha en rojo corporativo. Banda inferior roja fina (firma de marca).
 * - Cuerpo: fondo blanco predominante. Acentos rojos sólo en jerarquías clave
 *   (título header, encabezado tabla, línea total) — uso sutil, no satura.
 * - Tabla: head rojo SANSEI, texto blanco, tipografía consistente.
 * - Total: línea roja gruesa + label/valor alineados a la derecha, valor en
 *   rojo SANSEI bold para anclar la mirada.
 * - Footer: tagline oficial "más que un bazar, un paseo de compras" en rojo +
 *   datos de contacto SANSEI + disclaimer no fiscal.
 * - "₲" no se renderiza en Helvetica nativa (WinAnsi) → usamos "Gs." estándar.
 */
export async function generatePreSalePdf(data: PreSaleData): Promise<void> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210;
  const H = 297;
  const M = 16;

  // ════════════════════════════════════════════════════════════
  // 1. HEADER BRANDED (logo + título)
  // ════════════════════════════════════════════════════════════
  const logoData = await loadLogoDataUrl();
  // Logo original 762×184 → ratio ~4.14. Altura objetivo 12mm → ancho ~50mm.
  const logoH = 12;
  const logoW = logoH * (762 / 184);
  doc.addImage(logoData, "JPEG", M, 14, logoW, logoH);

  // Bloque título a la derecha
  doc.setFont("helvetica", "bold");
  doc.setFontSize(FS.brandTitle);
  doc.setTextColor(...BRAND.red);
  doc.text("PRE-VENTA / COTIZACIÓN", W - M, 20, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(FS.meta);
  doc.setTextColor(...BRAND.muted);
  const fecha = new Date(data.created_at).toLocaleDateString("es-PY", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
  doc.text(`N° ${data.request_number}    ·    Fecha: ${fecha}`, W - M, 26, { align: "right" });

  // Banda roja firma de marca
  doc.setFillColor(...BRAND.red);
  doc.rect(0, 32, W, 1.4, "F");
  // Sub-banda fina secundaria (teal) para guiño a paleta extendida
  doc.setFillColor(...BRAND.teal);
  doc.rect(0, 33.4, W, 0.4, "F");

  // ════════════════════════════════════════════════════════════
  // 2. CLIENTE
  // ════════════════════════════════════════════════════════════
  let y = 42;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(FS.label);
  doc.setTextColor(...BRAND.red);
  doc.text("DATOS DEL CLIENTE", M, y);
  y += 5;

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
    y += Math.max(5, lines.length * 4.6);
  };

  drawField("Cliente", data.client_name);
  drawField("Teléfono", data.client_phone || "—");
  if (data.client_email) drawField("Email", data.client_email);
  if (data.client_address) drawField("Dirección", data.client_address);

  // ════════════════════════════════════════════════════════════
  // 3. TABLA PRODUCTOS
  // ════════════════════════════════════════════════════════════
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
      cellPadding: { top: 2.8, right: 3, bottom: 2.8, left: 3 },
      valign: "middle",
      textColor: BRAND.text,
      lineColor: BRAND.line,
      lineWidth: 0.1,
    },
    headStyles: {
      fillColor: BRAND.red,
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

  // ════════════════════════════════════════════════════════════
  // 4. TOTAL (acento rojo SANSEI)
  // ════════════════════════════════════════════════════════════
  const totalY = finalY + 7;
  const totalRight = W - M;
  const totalValueStr = `Gs. ${formatNumberGs(total)}`;
  const totalLabelStr = "Total estimado:";

  doc.setFont("helvetica", "bold");
  doc.setFontSize(FS.total);
  const valueW = doc.getTextWidth(totalValueStr);
  doc.setFontSize(FS.totalLabel);
  const labelW = doc.getTextWidth(totalLabelStr);
  const blockLeft = totalRight - valueW - 8 - labelW;

  // Línea roja gruesa (firma de marca)
  doc.setDrawColor(...BRAND.red);
  doc.setLineWidth(0.8);
  doc.line(blockLeft, totalY, totalRight, totalY);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(FS.totalLabel);
  doc.setTextColor(...BRAND.muted);
  doc.text(totalLabelStr, blockLeft, totalY + 6.5);

  doc.setFontSize(FS.total);
  doc.setTextColor(...BRAND.red);
  doc.text(totalValueStr, totalRight, totalY + 6.5, { align: "right" });

  // Monto en letras
  doc.setFont("helvetica", "italic");
  doc.setFontSize(FS.small);
  doc.setTextColor(...BRAND.muted);
  const letras = `Son guaraníes: ${numberToWordsGs(Math.round(total))}.-`;
  const lLines = doc.splitTextToSize(letras, W - M * 2);
  doc.text(lLines, M, totalY + 15);

  let bottomY = totalY + 15 + lLines.length * 4;

  // Notas
  if (data.notes) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(FS.small);
    doc.setTextColor(...BRAND.muted);
    const ns = doc.splitTextToSize(`Notas: ${data.notes}`, W - M * 2);
    doc.text(ns, M, bottomY + 4);
    bottomY += 4 + ns.length * 4;
  }

  // ════════════════════════════════════════════════════════════
  // 5. FOOTER BRANDED (tagline + contacto)
  // ════════════════════════════════════════════════════════════
  // Banda fina roja de cierre
  doc.setFillColor(...BRAND.red);
  doc.rect(0, H - 20, W, 0.6, "F");

  // Tagline oficial
  doc.setFont("helvetica", "bolditalic");
  doc.setFontSize(FS.tagline);
  doc.setTextColor(...BRAND.red);
  doc.text("más que un bazar, un paseo de compras", M, H - 14);

  // Datos de contacto SANSEI (de branding oficial)
  doc.setFont("helvetica", "normal");
  doc.setFontSize(FS.small);
  doc.setTextColor(...BRAND.muted);
  doc.text("sansei.com.py  ·  0986 364 000  ·  sansei.py@gmail.com", M, H - 9.5);
  doc.text("Encarnación, Paraguay", M, H - 5.5);

  // Disclaimer derecha
  doc.text(
    "Documento no fiscal — Pre-venta sujeta a confirmación de stock y facturación.",
    W - M, H - 9.5, { align: "right" },
  );
  doc.text("Generado por MoviLog", W - M, H - 5.5, { align: "right" });

  doc.save(`pre-venta-${data.request_number}.pdf`);
}
