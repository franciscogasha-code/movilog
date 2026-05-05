import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { fetchProductImagesForPdf } from "@/lib/pdf-image";
import { proxyImageUrl } from "@/lib/image-utils";

interface PreSaleItem {
  product: { name: string; bims_code?: string | null; sku?: string | null; image_url?: string | null; sell_price?: number | null };
  quantity_requested: number;
}

interface PreSaleData {
  request_number: number;
  client_name: string;
  client_phone?: string | null;
  client_email?: string | null;
  client_address?: string | null;
  sales_channel?: string | null;
  shipping_method?: string | null;
  notes?: string | null;
  created_at: string;
  items: PreSaleItem[];
}

const fmt = (n: number) => Math.round(n).toLocaleString("de-DE");

/**
 * Genera un PDF de cotización Pre Venta Online y lo descarga.
 * Imágenes con timeout 3s + fallback progresivo (lib/pdf-image).
 */
export async function generatePreSalePdf(data: PreSaleData): Promise<void> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  // Header
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Pre-Venta MoviLog", 14, 18);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`#${data.request_number}`, 196, 18, { align: "right" });
  doc.text(new Date(data.created_at).toLocaleString("es-PY"), 196, 24, { align: "right" });

  // Cliente
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Cliente", 14, 32);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  let y = 38;
  doc.text(`Nombre: ${data.client_name}`, 14, y); y += 5;
  if (data.client_phone) { doc.text(`Tel: ${data.client_phone}`, 14, y); y += 5; }
  if (data.client_email) { doc.text(`Email: ${data.client_email}`, 14, y); y += 5; }
  if (data.client_address) {
    const lines = doc.splitTextToSize(`Dirección: ${data.client_address}`, 180);
    doc.text(lines, 14, y); y += lines.length * 5;
  }
  if (data.shipping_method) { doc.text(`Envío: ${data.shipping_method}`, 14, y); y += 5; }
  if (data.sales_channel) { doc.text(`Canal: ${data.sales_channel}`, 14, y); y += 5; }

  // Imágenes en paralelo
  const images = await fetchProductImagesForPdf(
    data.items.map((it) => ({
      url: it.product.image_url ? proxyImageUrl(it.product.image_url) : null,
      label: it.product.bims_code || it.product.sku || "—",
    })),
  );

  // Tabla
  const total = data.items.reduce(
    (acc, it) => acc + (Number(it.product.sell_price ?? 0) * it.quantity_requested),
    0,
  );

  autoTable(doc, {
    startY: y + 4,
    head: [["", "Producto", "Código", "Cant.", "P. Unit.", "Subtotal"]],
    body: data.items.map((it) => [
      "",
      it.product.name,
      it.product.bims_code || it.product.sku || "—",
      String(it.quantity_requested),
      it.product.sell_price ? `₲ ${fmt(Number(it.product.sell_price))}` : "—",
      it.product.sell_price ? `₲ ${fmt(Number(it.product.sell_price) * it.quantity_requested)}` : "—",
    ]),
    styles: { fontSize: 9, cellPadding: 2, valign: "middle", minCellHeight: 16 },
    headStyles: { fillColor: [30, 41, 59] },
    columnStyles: { 0: { cellWidth: 16 }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
    didDrawCell: (cellData) => {
      if (cellData.section === "body" && cellData.column.index === 0) {
        const img = images[cellData.row.index];
        if (img) {
          try {
            doc.addImage(img, "JPEG", cellData.cell.x + 1, cellData.cell.y + 1, 14, 14);
          } catch {/* noop */}
        }
      }
    },
  });

  const finalY = (doc as any).lastAutoTable?.finalY ?? y + 60;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(`Total estimado: ₲ ${fmt(total)}`, 196, finalY + 8, { align: "right" });

  if (data.notes) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const ns = doc.splitTextToSize(`Notas: ${data.notes}`, 180);
    doc.text(ns, 14, finalY + 16);
  }

  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text("Documento no fiscal — Pre-venta sujeta a confirmación de stock y facturación.", 14, 285);

  doc.save(`pre-venta-${data.request_number}.pdf`);
}
