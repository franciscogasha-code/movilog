import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CatalogImageQualityError,
  getCatalogImageReport,
  prefetchCatalogImages,
  resetCatalogImageFailures,
} from "@/lib/catalogo-pdf";
import type { ProductRow } from "@/lib/ventas";

const baseProduct = (overrides: Partial<ProductRow>): ProductRow => ({
  id: "product-1",
  bims_code: "302027",
  name: "Producto de prueba",
  description: null,
  barcode: null,
  category: null,
  brand: null,
  unit: "UN",
  image_url: null,
  sell_price: 1,
  price_scales: null,
  price_lists: null,
  stock_by_warehouse: null,
  total_stock: 0,
  bims_label_id: null,
  bims_warehouse_id: null,
  buy_price: null,
  created_at: "2026-08-15T00:00:00Z",
  is_active: true,
  sku: null,
  updated_at: "2026-08-15T00:00:00Z",
  volume_cm3: null,
  weight_kg: null,
  ...overrides,
});

describe("pipeline de fotos del catálogo", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetCatalogImageFailures();
  });

  it("distingue producto sin foto de una falla técnica", async () => {
    const report = await prefetchCatalogImages([baseProduct({ image_url: null })]);
    expect(report).toEqual({ ready: 0, missingSource: 1, failed: [] });
  });

  it("registra la etapa MIME después de dos intentos", async () => {
    const canvasContext = {
      fillStyle: "",
      font: "",
      textAlign: "center",
      textBaseline: "middle",
      fillRect: vi.fn(),
      fillText: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(canvasContext as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,placeholder");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob(["no es una imagen"], { type: "text/plain" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const report = await prefetchCatalogImages([
      baseProduct({ image_url: "http://190.128.128.182:8081/img/test.png" }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]).toMatchObject({ productId: "product-1", stage: "mime" });
    expect(getCatalogImageReport().failed).toHaveLength(1);
  });

  it("expone un error específico para bloquear la descarga", () => {
    const report = {
      ready: 0,
      missingSource: 0,
      failed: [{ productId: "product-1", code: "302027", stage: "fetch" as const, detail: "AbortError" }],
    };
    expect(new CatalogImageQualityError(report)).toMatchObject({
      name: "CatalogImageQualityError",
      report,
    });
  });
});