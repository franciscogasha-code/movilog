import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: false,
      includeAssets: ["favicon.ico", "icon-192.png", "icon-512.png"],
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/functions\//],
        runtimeCaching: [
          {
            // Fotos de producto (proxy BIMS y storage)
            urlPattern: ({ url }) =>
              url.pathname.includes("/bims-image-proxy") ||
              url.pathname.includes("/storage/v1/object"),
            handler: "CacheFirst",
            options: {
              cacheName: "movilog-product-images",
              expiration: { maxEntries: 2000, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
              fetchOptions: { mode: "cors", credentials: "omit" },
            },

          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
