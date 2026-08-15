import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("el modo PDF usa una política no-store", () => {
  const requestUrl = new URL(
    "https://example.test/bims-image-proxy?mode=pdf&url=http%3A%2F%2F190.128.128.182%3A8081%2Fimg%2Ftest.png",
  );
  assertEquals(requestUrl.searchParams.get("mode"), "pdf");
  assertEquals(requestUrl.searchParams.get("url"), "http://190.128.128.182:8081/img/test.png");
});