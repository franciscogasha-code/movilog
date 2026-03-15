import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { toast } from "sonner";

interface LabelData {
  packageNumber: number;
  totalPackages: number;
  recipientName: string;
  destination: string;
  contactPhone: string;
  sendingBranchCode: string;
  transferReference: string;
  invoiceReference: string;
}

function generateLabelHTML(labels: LabelData[]): string {
  const labelCards = labels.map((l, idx) => `
    <div style="page-break-inside: avoid; border: 2px solid #000; padding: 16px; margin-bottom: 12px; font-family: Arial, sans-serif; width: 100%; max-width: 400px;">
      <div style="text-align: center; font-size: 11px; color: #666; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 2px;">SANSEI Logística</div>
      <div style="border-bottom: 1px solid #ccc; padding-bottom: 8px; margin-bottom: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 13px; font-weight: bold;">Origen: ${l.sendingBranchCode}</span>
          <span style="font-size: 18px; font-weight: bold; background: #000; color: #fff; padding: 2px 10px; border-radius: 4px;">
            ${l.packageNumber} / ${l.totalPackages}
          </span>
        </div>
      </div>
      <div style="margin-bottom: 8px;">
        <div style="font-size: 11px; color: #666;">DESTINATARIO</div>
        <div style="font-size: 16px; font-weight: bold;">${l.recipientName || "—"}</div>
      </div>
      <div style="margin-bottom: 8px;">
        <div style="font-size: 11px; color: #666;">DESTINO</div>
        <div style="font-size: 13px;">${l.destination || "—"}</div>
      </div>
      <div style="display: flex; gap: 16px; margin-bottom: 8px;">
        <div style="flex: 1;">
          <div style="font-size: 11px; color: #666;">TELÉFONO</div>
          <div style="font-size: 13px; font-weight: bold;">${l.contactPhone || "—"}</div>
        </div>
      </div>
      <div style="border-top: 1px solid #ccc; padding-top: 8px; display: flex; gap: 16px;">
        ${l.transferReference ? `<div><span style="font-size: 11px; color: #666;">TRANSF: </span><span style="font-size: 12px; font-weight: bold;">${l.transferReference}</span></div>` : ""}
        ${l.invoiceReference ? `<div><span style="font-size: 11px; color: #666;">FACT: </span><span style="font-size: 12px; font-weight: bold;">${l.invoiceReference}</span></div>` : ""}
      </div>
    </div>
  `).join("");

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Etiquetas SANSEI</title>
      <style>
        @media print {
          body { margin: 0; padding: 8px; }
          .no-print { display: none !important; }
        }
        body { font-family: Arial, sans-serif; padding: 16px; display: flex; flex-direction: column; align-items: center; }
      </style>
    </head>
    <body>
      ${labelCards}
    </body>
    </html>
  `;
}

export function PrintLabelsButton({ packages }: { packages: any[] }) {
  const handlePrint = () => {
    if (!packages.length) {
      toast.error("No hay etiquetas para imprimir");
      return;
    }

    const labels: LabelData[] = packages.map((p) => ({
      packageNumber: p.package_number,
      totalPackages: packages.length,
      recipientName: p.recipient_name || "",
      destination: p.destination_description || "",
      contactPhone: p.contact_phone || "",
      sendingBranchCode: p.sending_branch_code || "",
      transferReference: p.transfer_reference || "",
      invoiceReference: p.invoice_reference || "",
    }));

    const html = generateLabelHTML(labels);
    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.onload = () => {
        printWindow.print();
      };
    } else {
      toast.error("Habilitá ventanas emergentes para imprimir");
    }
  };

  return (
    <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handlePrint}>
      <Printer className="h-3 w-3" /> Imprimir ({packages.length})
    </Button>
  );
}
