import { useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Upload, Download, FileSpreadsheet, CheckCircle2, AlertTriangle, XCircle, Loader2 } from "lucide-react";
import { downloadExcelTemplate } from "./ExcelTemplate";
import type { ProductResult } from "@/components/shared/ProductSearch";

type RowStatus = "ok" | "duplicate_merged" | "not_found" | "invalid_qty";

interface ParsedRow {
  rowNum: number;
  codigo: string;
  codigoSecundario: string;
  descripcion: string;
  cantidad: number;
  status: RowStatus;
  product: ProductResult | null;
}

interface ExcelImportProps {
  onConfirm: (items: { product: ProductResult; quantity: number }[]) => void;
  onFileSelected?: (file: File | null) => void;
}

const MAX_ROWS = 500;
const MAX_SIZE_MB = 5;

const STATUS_CONFIG: Record<RowStatus, { label: string; icon: React.ReactNode; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  ok: { label: "Correcto", icon: <CheckCircle2 className="h-3.5 w-3.5" />, variant: "default" },
  duplicate_merged: { label: "Duplicado agrupado", icon: <AlertTriangle className="h-3.5 w-3.5" />, variant: "secondary" },
  not_found: { label: "No encontrado", icon: <XCircle className="h-3.5 w-3.5" />, variant: "destructive" },
  invalid_qty: { label: "Cantidad inválida", icon: <XCircle className="h-3.5 w-3.5" />, variant: "destructive" },
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[áàä]/g, "a").replace(/[éèë]/g, "e").replace(/[íìï]/g, "i").replace(/[óòö]/g, "o").replace(/[úùü]/g, "u");
}

export function ExcelImport({ onConfirm, onFileSelected }: ExcelImportProps) {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const processFile = useCallback(async (file: File) => {
    setError(null);
    setRows([]);
    setFileName(file.name);
    onFileSelected?.(null);

    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      setError(`El archivo excede ${MAX_SIZE_MB}MB`);
      return;
    }

    const validTypes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
    ];
    if (!validTypes.includes(file.type) && !file.name.match(/\.(xlsx|xls|csv)$/i)) {
      setError("Formato no soportado. Use .xlsx o .csv");
      return;
    }

    setLoading(true);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

      if (rawData.length === 0) {
        setError("El archivo está vacío");
        setLoading(false);
        return;
      }
      if (rawData.length > MAX_ROWS) {
        setError(`Máximo ${MAX_ROWS} filas permitidas (archivo tiene ${rawData.length})`);
        setLoading(false);
        return;
      }

      // Map headers
      const firstRow = rawData[0];
      const headerMap: Record<string, string> = {};
      Object.keys(firstRow).forEach((k) => {
        const norm = normalizeHeader(k);
        if (norm === "id" || norm === "id_bims" || norm === "idbims") headerMap.idBims = k;
        else if (norm.includes("codigo") && !norm.includes("secundario")) headerMap.codigo = k;
        else if (norm.includes("secundario") || norm === "codigo_secundario") headerMap.codigoSecundario = k;
        else if (norm.includes("descripcion")) headerMap.descripcion = k;
        else if (norm.includes("cantidad")) headerMap.cantidad = k;
      });

      if (!headerMap.idBims && !headerMap.codigo && !headerMap.codigoSecundario) {
        setError("No se encontró columna 'id', 'codigo' ni 'codigo_secundario' en el archivo");
        setLoading(false);
        return;
      }

      // Extract raw rows
      const rawRows = rawData.map((row, i) => ({
        rowNum: i + 2,
        idBims: String(row[headerMap.idBims] || "").trim(),
        codigo: String(row[headerMap.codigo] || "").trim(),
        codigoSecundario: String(row[headerMap.codigoSecundario] || "").trim(),
        descripcion: String(row[headerMap.descripcion] || "").trim(),
        cantidadRaw: row[headerMap.cantidad],
      }));

      // Collect all codes for batch query
      const allBimsCodes = new Set<string>();
      const allCodes = new Set<string>();
      const allBarcodes = new Set<string>();
      rawRows.forEach((r) => {
        if (r.idBims) allBimsCodes.add(r.idBims);
        if (r.codigo) allCodes.add(r.codigo);
        if (r.codigoSecundario) allBarcodes.add(r.codigoSecundario);
      });

      // Batch query products
      let products: ProductResult[] = [];
      if (allBimsCodes.size > 0 || allCodes.size > 0 || allBarcodes.size > 0) {
        const orFilters: string[] = [];
        if (allBimsCodes.size > 0) {
          orFilters.push(`bims_code.in.(${Array.from(allBimsCodes).join(",")})`);
        }
        if (allCodes.size > 0) {
          const codeArr = Array.from(allCodes);
          orFilters.push(`barcode.in.(${codeArr.join(",")})`);
          orFilters.push(`bims_code.in.(${codeArr.join(",")})`);
          orFilters.push(`sku.in.(${codeArr.join(",")})`);
        }
        if (allBarcodes.size > 0) {
          orFilters.push(`barcode.in.(${Array.from(allBarcodes).join(",")})`);
        }

        const { data } = await supabase
          .from("products")
          .select("id, name, sku, bims_code, barcode, category, unit, description, image_url, sell_price, price_scales, price_lists, stock_by_warehouse, total_stock")
          .eq("is_active", true)
          .or(orFilters.join(","))
          .limit(1000);
        products = (data || []) as unknown as ProductResult[];
      }

      // Build lookup maps
      const byBimsCode = new Map<string, ProductResult>();
      const bySku = new Map<string, ProductResult>();
      const byBarcode = new Map<string, ProductResult>();
      products.forEach((p) => {
        if (p.bims_code) byBimsCode.set(p.bims_code.toLowerCase(), p);
        if (p.sku) bySku.set(p.sku.toLowerCase(), p);
        if (p.barcode) byBarcode.set(p.barcode.toLowerCase(), p);
      });

      // Match each row
      const parsed: ParsedRow[] = rawRows.map((r) => {
        const qty = Number(r.cantidadRaw);
        if (!r.cantidadRaw || isNaN(qty) || qty <= 0 || !Number.isFinite(qty)) {
          return { rowNum: r.rowNum, codigo: r.idBims || r.codigo, codigoSecundario: r.codigoSecundario, descripcion: r.descripcion, cantidad: 0, status: "invalid_qty" as RowStatus, product: null };
        }

        // Match by confidence levels:
        // 1. id column → bims_code (highest confidence)
        // 2. codigo → barcode
        // 3. codigo → bims_code
        // 4. codigo_secundario → barcode
        // 5. codigo → sku (fallback only)
        let found: ProductResult | null = null;
        if (r.idBims) {
          found = byBimsCode.get(r.idBims.toLowerCase()) || null;
        }
        if (!found && r.codigo) {
          found = byBarcode.get(r.codigo.toLowerCase())
            || byBimsCode.get(r.codigo.toLowerCase())
            || null;
        }
        if (!found && r.codigoSecundario) {
          found = byBarcode.get(r.codigoSecundario.toLowerCase()) || null;
        }
        if (!found && r.codigo) {
          found = bySku.get(r.codigo.toLowerCase()) || null;
        }

        const displayCode = r.idBims || r.codigo;
        if (!found) {
          return { rowNum: r.rowNum, codigo: displayCode, codigoSecundario: r.codigoSecundario, descripcion: r.descripcion, cantidad: qty, status: "not_found" as RowStatus, product: null };
        }

        return { rowNum: r.rowNum, codigo: displayCode, codigoSecundario: r.codigoSecundario, descripcion: r.descripcion, cantidad: qty, status: "ok" as RowStatus, product: found };
      });

      // Group duplicates
      const grouped = new Map<string, ParsedRow>();
      const finalRows: ParsedRow[] = [];
      parsed.forEach((row) => {
        if (row.status !== "ok" || !row.product) {
          finalRows.push(row);
          return;
        }
        const key = row.product.id;
        if (grouped.has(key)) {
          const existing = grouped.get(key)!;
          existing.cantidad += row.cantidad;
          existing.status = "duplicate_merged";
        } else {
          const clone = { ...row };
          grouped.set(key, clone);
          finalRows.push(clone);
        }
      });

      setRows(finalRows);
      // Expose file to parent if parsing succeeded with valid rows
      const hasValidRows = finalRows.some((r) => r.status === "ok" || r.status === "duplicate_merged");
      if (hasValidRows) {
        onFileSelected?.(file);
      }
    } catch (err) {
      console.error("Excel parse error:", err);
      setError("Error al procesar el archivo. Verifique el formato.");
    } finally {
      setLoading(false);
    }
  }, []);

  const errorCount = rows.filter((r) => r.status === "not_found" || r.status === "invalid_qty").length;
  const okCount = rows.filter((r) => r.status === "ok" || r.status === "duplicate_merged").length;
  const dupCount = rows.filter((r) => r.status === "duplicate_merged").length;
  const canConfirm = rows.length > 0 && errorCount === 0;

  const handleConfirm = () => {
    const items = rows
      .filter((r) => r.product && (r.status === "ok" || r.status === "duplicate_merged"))
      .map((r) => ({ product: r.product!, quantity: r.cantidad }));
    onConfirm(items);
  };

  return (
    <div className="space-y-4">
      {/* Help + template */}
      <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <FileSpreadsheet className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          <div className="text-sm space-y-1">
            <p className="font-medium">Formato del archivo</p>
            <p className="text-muted-foreground">
              Columnas soportadas: <code className="text-xs bg-muted px-1 rounded">id</code> (ID BIMS, máxima confianza),{" "}
              <code className="text-xs bg-muted px-1 rounded">codigo</code>,{" "}
              <code className="text-xs bg-muted px-1 rounded">codigo_secundario</code> (opcional),{" "}
              <code className="text-xs bg-muted px-1 rounded">descripcion</code> (informativa),{" "}
              <code className="text-xs bg-muted px-1 rounded">cantidad</code>
            </p>
            <p className="text-muted-foreground text-xs">
              Máximo {MAX_ROWS} filas · Formatos: .xlsx, .csv · Tamaño máximo: {MAX_SIZE_MB}MB
            </p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={downloadExcelTemplate}>
          <Download className="h-4 w-4 mr-2" /> Descargar plantilla
        </Button>
      </div>

      {/* Upload */}
      <div className="flex items-center gap-3">
        <label className="flex-1 cursor-pointer">
          <div className="flex items-center gap-2 rounded-md border border-dashed border-border p-4 hover:bg-muted/20 transition-colors">
            <Upload className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              {fileName ? fileName : "Seleccionar archivo Excel o CSV..."}
            </span>
          </div>
          <Input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) processFile(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Procesando archivo...
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Results */}
      {rows.length > 0 && (
        <>
          {/* Summary */}
          <div className="flex gap-3 flex-wrap text-sm">
            <Badge variant="outline">{rows.length} filas</Badge>
            <Badge variant="default" className="bg-green-600">{okCount} correctas</Badge>
            {dupCount > 0 && <Badge variant="secondary">{dupCount} agrupadas</Badge>}
            {errorCount > 0 && <Badge variant="destructive">{errorCount} con error</Badge>}
          </div>

          {/* Validation table */}
          <div className="border border-border rounded-md overflow-x-auto max-h-[350px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left p-2 font-medium text-muted-foreground">#</th>
                  <th className="text-left p-2 font-medium text-muted-foreground">Código leído</th>
                  <th className="text-left p-2 font-medium text-muted-foreground">Descripción leída</th>
                  <th className="text-right p-2 font-medium text-muted-foreground">Cant.</th>
                  <th className="text-left p-2 font-medium text-muted-foreground">Producto encontrado</th>
                  <th className="text-left p-2 font-medium text-muted-foreground">Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const cfg = STATUS_CONFIG[r.status];
                  return (
                    <tr key={i} className="border-b border-border/50 hover:bg-muted/10">
                      <td className="p-2 text-xs text-muted-foreground">{r.rowNum}</td>
                      <td className="p-2 font-mono text-xs">
                        {r.codigo}
                        {r.codigoSecundario && (
                          <span className="text-muted-foreground ml-1">/ {r.codigoSecundario}</span>
                        )}
                      </td>
                      <td className="p-2 text-xs max-w-[180px] truncate">{r.descripcion}</td>
                      <td className="p-2 text-right tabular-nums">{r.cantidad || "—"}</td>
                      <td className="p-2 text-xs">
                        {r.product ? (
                          <span className="font-medium">{r.product.name}</span>
                        ) : (
                          <span className="text-muted-foreground italic">—</span>
                        )}
                      </td>
                      <td className="p-2">
                        <Badge variant={cfg.variant} className="gap-1 text-xs">
                          {cfg.icon} {cfg.label}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Confirm */}
          <div className="flex justify-end">
            <Button type="button" onClick={handleConfirm} disabled={!canConfirm}>
              Confirmar {okCount} productos
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
