import * as XLSX from "xlsx";

export function downloadExcelTemplate() {
  const headers = ["codigo", "codigo_secundario", "descripcion", "cantidad"];
  const examples = [
    ["ABC-001", "7890001234567", "Ejemplo producto 1", 10],
    ["XYZ-002", "", "Ejemplo producto 2", 5],
  ];

  const ws = XLSX.utils.aoa_to_sheet([headers, ...examples]);
  ws["!cols"] = [{ wch: 18 }, { wch: 22 }, { wch: 30 }, { wch: 12 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Reposición");
  XLSX.writeFile(wb, "plantilla_reposicion.xlsx");
}
