import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSupplyResolution } from "./use-supply-resolution";

const item = { id: "item-1", product_id: "product-1", quantity_requested: 50 };

describe("useSupplyResolution", () => {
  it("allows partial supply and ignores empty draft external rows", () => {
    const { result } = renderHook(() => useSupplyResolution([item]));

    act(() => {
      result.current.setExternals(item.id, [
        { branchId: "branch-1", qty: 39 },
        { branchId: "", qty: 0 },
      ]);
    });

    expect(result.current.itemSum(item.id)).toBe(39);
    expect(result.current.isItemFullyCovered(item.id, item.quantity_requested)).toBe(false);
    expect(result.current.isItemValid(item.id, item.quantity_requested)).toBe(true);
    expect(result.current.allValid).toBe(true);
    expect(result.current.buildPayload()).toEqual({
      items: [
        {
          request_item_id: item.id,
          local_qty: 0,
          externals: [{ source_branch_id: "branch-1", qty: 39 }],
        },
      ],
    });
  });

  it("blocks oversupply and positive quantities without source branch", () => {
    const { result } = renderHook(() => useSupplyResolution([item]));

    act(() => {
      result.current.setExternals(item.id, [{ branchId: "", qty: 11 }]);
    });
    expect(result.current.isItemValid(item.id, item.quantity_requested)).toBe(false);

    act(() => {
      result.current.setExternals(item.id, [{ branchId: "branch-1", qty: 51 }]);
    });
    expect(result.current.isItemValid(item.id, item.quantity_requested)).toBe(false);
  });
});