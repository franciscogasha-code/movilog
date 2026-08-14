import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const store = new Map<string, unknown>();

vi.mock("@/lib/offline-store", () => ({
  idbGet: vi.fn(async (key: string) => store.get(key)),
  idbSet: vi.fn(async (key: string, value: unknown) => {
    store.set(key, value);
  }),
}));

import { useIdbState } from "./use-idb-state";

describe("useIdbState", () => {
  beforeEach(() => store.clear());

  it("persiste y rehidrata el valor", async () => {
    const { result, unmount } = renderHook(() => useIdbState<number[]>("k", []));
    await waitFor(() => expect(result.current[2]).toBe(true));
    act(() => result.current[1]([1, 2, 3]));
    await waitFor(() => expect(store.get("k")).toEqual([1, 2, 3]));
    unmount();

    const again = renderHook(() => useIdbState<number[]>("k", []));
    await waitFor(() => expect(again.result.current[0]).toEqual([1, 2, 3]));
  });

  it("no pisa el guardado cuando cambia la clave (sesión que carga tarde)", async () => {
    store.set("sales-cart-user1", [{ productId: "p1" }]);

    const { result, rerender } = renderHook(({ k }) => useIdbState<any[]>(k, []), {
      initialProps: { k: "sales-cart" },
    });
    await waitFor(() => expect(result.current[2]).toBe(true));

    // la sesión se resuelve y la clave pasa a incluir el usuario
    rerender({ k: "sales-cart-user1" });
    await waitFor(() => expect(result.current[0]).toEqual([{ productId: "p1" }]));
    expect(store.get("sales-cart-user1")).toEqual([{ productId: "p1" }]);
  });
});
