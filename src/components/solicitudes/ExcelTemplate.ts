import * as XLSX from "xlsx";

export function downloadExcelTemplate() {
  const headers = ["id", "codigo", "codigo_secundario", "descripcion", "cantidad"];
  const examples = [
    ["88", "", "", "Ejemplo con ID BIMS", 10],
    ["", "7890001234567", "", "Ejemplo con código/barcode", 5],
    ["", "ABC-001", "7890001234567", "Ejemplo con código secundario", 3],
  ];

  const ws = XLSX.utils.aoa_to_sheet([headers, ...examples]);
  ws["!cols"] = [{ wch: 10 }, { wch: 18 }, { wch: 22 }, { wch: 30 }, { wch: 12 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Reposición");
  XLSX.writeFile(wb, "plantilla_reposicion.xlsx");
}
